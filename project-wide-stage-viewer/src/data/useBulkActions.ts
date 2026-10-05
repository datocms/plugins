import type { Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  SelectionAction as BarAction,
  SelectionActionId,
} from '../components/types';
import {
  availableMoveDestinationIds,
  evaluateSelection,
  getMoveSelectionContext,
  potentialMoveDestinationIds,
} from '../operations/candidates';
import { buildBatches, executeBulkOperation } from '../operations/execute';
import { bulkErrorMessage } from '../operations/results';
import type {
  BulkOperationProgress,
  BulkOperationRequest,
  BulkOperationResult,
  PermissionContext,
  SelectionAction,
  SelectionEvaluation,
  SelectionInput,
} from '../operations/types';
import type { RecordRow } from '../lib/records';
import type { ModelSummary, RawItem, WorkflowStageOption } from '../types';
import {
  confirmSelectionAction,
  creatorRoleMap,
  loadCurrentSelection,
  prepareMoveOperation,
  reportBulkResult,
} from './bulkFlow';
import { invertPageSelection, setPageSelection } from './selection';

type Selection = ReadonlyMap<string, RawItem>;

/** The selected records and whether only they are listed. Owned by the page. */
export function useSelectionState() {
  const [selectedById, setSelectedById] = useState<Selection>(new Map());
  const [showingSelected, setShowingSelected] = useState(false);
  const selectedIds = useMemo(
    () => new Set(selectedById.keys()),
    [selectedById],
  );
  return {
    selectedById,
    setSelectedById,
    selectedIds,
    showingSelected,
    setShowingSelected,
  };
}

export type SelectionState = ReturnType<typeof useSelectionState>;

type Args = {
  ctx: RenderPageCtx;
  selection: SelectionState;
  /** Every record in the stage, or null while (re)loading or after an error. */
  rows: readonly RecordRow[] | null;
  /** The rows on the current page. */
  pageRows: readonly RecordRow[];
  /** Every row matching the current search and filters. */
  matchingRows: readonly RecordRow[];
  models: readonly ModelSummary[];
  /** The page's stage: actions only touch records that are still in it. */
  stageId: string;
  /** The page's workflow: "Move to stage" reads its stages when it runs. */
  workflowId: string;
  /** The workflow's stages as of the last load, or null if they couldn't be read. */
  stages: readonly WorkflowStageOption[] | null;
  getClient: () => Client | null;
  reload: () => void;
};

/** Keeps selected records that are still in the stage, with their latest meta. */
function syncSelection(current: Selection, rows: readonly RecordRow[]) {
  if (current.size === 0) return current;
  const next = new Map<string, RawItem>();
  for (const row of rows) {
    if (current.has(row.id)) next.set(row.id, row.item);
  }
  return next;
}

function barAction(
  evaluation: SelectionEvaluation,
  onClick: () => void,
): BarAction | undefined {
  if (evaluation.eligibleCount === 0) return undefined;
  return { disabledReason: evaluation.disabledReason ?? undefined, onClick };
}

function progressLabel(progress: BulkOperationProgress | null) {
  return progress
    ? `${progress.completed} of ${progress.requested} processed; ${progress.successful} succeeded; ${progress.failed} failed`
    : undefined;
}

/**
 * Record selection and the bulk actions of the selection bar: delete,
 * publish, unpublish, and move to stage. Ported from the all-records-viewer.
 */
export function useBulkActions(args: Args) {
  const { ctx, rows } = args;
  const {
    selectedById,
    setSelectedById,
    selectedIds,
    showingSelected,
    setShowingSelected,
  } = args.selection;
  const [busyAction, setBusyAction] = useState<SelectionActionId | null>(null);
  const [progress, setProgress] = useState<BulkOperationProgress | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (rows) setSelectedById((current) => syncSelection(current, rows));
  }, [rows, setSelectedById]);

  // Leaving the page cancels a running action and stops its prompts.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  const selectedItems = useMemo(
    () => [...selectedById.values()],
    [selectedById],
  );
  useEffect(() => {
    if (selectedItems.length === 0) setShowingSelected(false);
  }, [selectedItems.length, setShowingSelected]);

  const modelsById = useMemo(
    () => new Map(args.models.map((model) => [model.id, model])),
    [args.models],
  );
  const creatorRoles = useMemo(
    () => creatorRoleMap(ctx.users, ctx.ssoUsers, ctx.owner),
    [ctx.users, ctx.ssoUsers, ctx.owner],
  );
  const permissions = useMemo<PermissionContext>(
    () => ({
      role: ctx.currentRole,
      environment: ctx.environment,
      currentUser: { id: ctx.currentUser.id, type: ctx.currentUser.type },
      creatorRoleByIdentity: creatorRoles,
    }),
    [
      creatorRoles,
      ctx.currentRole,
      ctx.currentUser.id,
      ctx.currentUser.type,
      ctx.environment,
    ],
  );
  const selectionInput = useMemo<SelectionInput>(
    () => ({ items: selectedItems, modelsById, permissions }),
    [modelsById, permissions, selectedItems],
  );
  const evaluations = useMemo(
    () => ({
      delete: evaluateSelection({ ...selectionInput, action: 'delete' }),
      publish: evaluateSelection({ ...selectionInput, action: 'publish' }),
      unpublish: evaluateSelection({ ...selectionInput, action: 'unpublish' }),
      // Offered when at least one selected record may go to another stage.
      // Without known stages, the role's move rules decide; the stages are
      // read again when it runs anyway.
      move:
        getMoveSelectionContext(selectionInput).enabled &&
        availableMoveDestinationIds({
          ...selectionInput,
          destinationStageIds:
            args.stages?.map((stage) => stage.id) ??
            potentialMoveDestinationIds(permissions),
        }).length > 0,
    }),
    [selectionInput, args.stages, permissions],
  );

  function begin(action: SelectionActionId): AbortController | null {
    if (controllerRef.current) return null;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusyAction(action);
    return controller;
  }

  function isActive(controller: AbortController): boolean {
    return controllerRef.current === controller && !controller.signal.aborted;
  }

  function finish(controller: AbortController) {
    if (controllerRef.current !== controller) return;
    controllerRef.current = null;
    setBusyAction(null);
    setProgress(null);
  }

  async function currentSelection(
    client: Client,
    controller: AbortController,
  ): Promise<SelectionInput> {
    // Records deleted, or moved out of this stage, since they were selected
    // drop out: the action only applies to what the page still lists.
    const items = (
      await loadCurrentSelection(client, selectedItems, {
        omitMissing: true,
        signal: controller.signal,
      })
    ).filter((item) => item.meta.stage === args.stageId);
    setSelectedById(new Map(items.map((item) => [item.id, item])));
    return { items, modelsById, permissions };
  }

  async function execute(
    client: Client,
    controller: AbortController,
    selection: SelectionInput,
    request: BulkOperationRequest,
  ) {
    setShowingSelected(false);
    const modelOf = new Map(
      selection.items.map((item) => [
        item.id,
        item.relationships.item_type.data.id,
      ]),
    );
    // The API moves one model per request; other actions mix models freely.
    const batchKey =
      request.operation === 'move_to_stage'
        ? (id: string) => modelOf.get(id) ?? ''
        : undefined;
    const result: BulkOperationResult = await executeBulkOperation(
      client,
      request,
      {
        signal: controller.signal,
        batchKey,
        // Progress and "Cancel remaining" whenever there's more than one job.
        onProgress:
          buildBatches(request.itemIds, batchKey).length > 1
            ? setProgress
            : undefined,
      },
    );
    if (controllerRef.current !== controller) return;
    reportBulkResult(ctx, result);
    // Keep what wasn't submitted, or was in a batch that didn't fully succeed.
    const retained = new Set(result.remainingItemIds);
    const submitted = new Set(request.itemIds);
    setSelectedById(
      new Map(
        selection.items
          .filter((item) => !submitted.has(item.id) || retained.has(item.id))
          .map((item) => [item.id, item]),
      ),
    );
    args.reload();
  }

  type Prepare = (
    selection: SelectionInput,
    client: Client,
    signal: AbortSignal,
  ) => Promise<BulkOperationRequest | null>;

  /** Re-reads the selection, asks the user, then runs the request. */
  async function perform(
    client: Client,
    controller: AbortController,
    prepare: Prepare,
  ) {
    const selection = await currentSelection(client, controller);
    if (!isActive(controller)) return;
    if (selection.items.length === 0) {
      void ctx.alert('The selected records are no longer in this stage.');
      args.reload();
      return;
    }
    const request = await prepare(selection, client, controller.signal);
    if (!request || !isActive(controller)) return;
    await execute(client, controller, selection, request);
  }

  async function run(
    action: SelectionActionId,
    prepare: Prepare,
    operation: SelectionAction | 'move_to_stage',
  ) {
    const client = args.getClient();
    if (!client) {
      void ctx.alert(
        'This action requires the current user access token permission.',
      );
      return;
    }
    const controller = begin(action);
    if (!controller) return;
    try {
      await perform(client, controller, prepare);
    } catch (error) {
      if (isActive(controller)) {
        void ctx.alert(bulkErrorMessage(operation, error));
        args.reload();
      }
    } finally {
      finish(controller);
    }
  }

  function runSelectionAction(action: SelectionAction) {
    void run(
      action,
      async (selection) => {
        const evaluation = evaluateSelection({ ...selection, action });
        if (evaluation.disabledReason) {
          void ctx.alert(evaluation.disabledReason);
          return null;
        }
        const confirmed = await confirmSelectionAction(ctx, action, evaluation);
        return confirmed
          ? { operation: action, itemIds: evaluation.itemIds }
          : null;
      },
      action,
    );
  }

  function runMoveToStage() {
    void run(
      'move',
      async (selection, client, signal) => {
        const context = getMoveSelectionContext(selection);
        if (!context.enabled) {
          void ctx.alert(context.disabledReason);
          return null;
        }
        // Read the stages now: some may have been added or removed since load.
        const workflow = await client.workflows.find(args.workflowId);
        if (signal.aborted) return null;
        return prepareMoveOperation({
          ctx,
          stages: workflow.stages.map(({ id, name }) => ({ id, name })),
          selectionInput: selection,
          signal,
        });
      },
      'move_to_stage',
    );
  }

  const actions: Partial<Record<SelectionActionId, BarAction>> = {
    delete: barAction(evaluations.delete, () => runSelectionAction('delete')),
    publish: barAction(evaluations.publish, () =>
      runSelectionAction('publish'),
    ),
    unpublish: barAction(evaluations.unpublish, () =>
      runSelectionAction('unpublish'),
    ),
    move: evaluations.move ? { onClick: runMoveToStage } : undefined,
  };

  // The selection is exactly the matching records already.
  const selectionIsMatching =
    selectedById.size === args.matchingRows.length &&
    args.matchingRows.every((row) => selectedById.has(row.id));

  return {
    selectedById,
    selectedIds,
    selectedCount: selectedById.size,
    showingSelected,
    busyAction,
    actions,
    progressText: progressLabel(progress),
    onCancel: progress ? () => controllerRef.current?.abort() : undefined,
    toggleRow: (row: RecordRow) =>
      setSelectedById((current) => {
        const next = new Map(current);
        if (next.has(row.id)) next.delete(row.id);
        else next.set(row.id, row.item);
        return next;
      }),
    togglePage: (selected: boolean) =>
      setSelectedById((current) =>
        setPageSelection(
          current,
          args.pageRows.map((row) => row.item),
          selected,
        ),
      ),
    invertPage: () =>
      setSelectedById((current) =>
        invertPageSelection(
          current,
          args.pageRows.map((row) => row.item),
        ),
      ),
    /**
     * Replaces the selection with every record matching the search and
     * filters, across pages. Offered when they span more than one page.
     */
    selectAllMatching:
      !showingSelected &&
      args.matchingRows.length > args.pageRows.length &&
      !selectionIsMatching
        ? () =>
            setSelectedById(
              new Map(args.matchingRows.map((row) => [row.id, row.item])),
            )
        : undefined,
    toggleShowingSelected: () => setShowingSelected((current) => !current),
    clear: () => {
      setSelectedById(new Map());
      setShowingSelected(false);
    },
  };
}

export type BulkActions = ReturnType<typeof useBulkActions>;
