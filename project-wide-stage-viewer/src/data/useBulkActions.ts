import type { Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_BULK_ITEMS } from '../constants';
import type { RecordRow } from '../lib/records';
import {
  availableMoveDestinationIds,
  evaluateSelection,
  getMoveSelectionContext,
  potentialMoveDestinationIds,
} from '../operations/candidates';
import { executeBulkOperation } from '../operations/execute';
import { bulkErrorMessage, selectionGoneMessage } from '../operations/results';
import type {
  BulkOperationProgress,
  BulkOperationRequest,
  BulkOperationResult,
  PermissionContext,
  SelectionAction,
  SelectionEvaluation,
  SelectionInput,
} from '../operations/types';
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

/** The bulk action that runs now */
export type BusyAction = SelectionAction | 'move';

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

/** The action, when at least one selected record allows it */
function whenEligible(
  evaluation: SelectionEvaluation,
  run: () => Promise<void>,
): (() => Promise<void>) | undefined {
  return evaluation.eligibleCount > 0 ? run : undefined;
}

const PROGRESS_VERB: Record<BusyAction, string> = {
  delete: 'Deleting',
  publish: 'Publishing',
  unpublish: 'Unpublishing',
  move: 'Moving',
};

// "Publishing 200 of 452…", with the failures only when there are some. The
// numbers have the separators of the locale of the user ("1,234"), as the
// count of the title bar.
function progressLabel(
  locale: string,
  action: BusyAction | null,
  progress: BulkOperationProgress | null,
) {
  if (!action || !progress) return undefined;
  const numbers = new Intl.NumberFormat(locale);
  const n = (value: number) => numbers.format(value);
  const verb = PROGRESS_VERB[action];
  if (progress.completed === 0)
    return `${verb} ${n(progress.requested)} records…`;
  const failed = progress.failed > 0 ? `, ${n(progress.failed)} failed` : '';
  return `${verb} ${n(progress.completed)} of ${n(progress.requested)}${failed}…`;
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
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
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
  // Publish applies while a selected record has something to publish, and
  // Unpublish while one is published
  const statuses = useMemo(
    () => new Set(selectedItems.map((item) => item.meta.status ?? 'published')),
    [selectedItems],
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

  // The page shows the action as running (busyAction) only once the user
  // has confirmed it
  function begin(): AbortController | null {
    if (controllerRef.current) return null;
    const controller = new AbortController();
    controllerRef.current = controller;
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
    destination: string | undefined,
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
        // Progress and "Stop" when the records take more than one job of
        // the API, not for a few records split by model.
        onProgress:
          request.itemIds.length > MAX_BULK_ITEMS ? setProgress : undefined,
      },
    );
    if (controllerRef.current !== controller) return;
    reportBulkResult(ctx, result, destination);
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
    action: BusyAction,
    prepare: Prepare,
    operation: SelectionAction | 'move_to_stage',
    destination: string | undefined,
  ) {
    const selectedCount = selectedItems.length;
    const selection = await currentSelection(client, controller);
    if (!isActive(controller)) return;
    if (selection.items.length === 0) {
      void ctx.alert(
        selectionGoneMessage(operation, selectedCount, destination),
      );
      args.reload();
      return;
    }
    const request = await prepare(selection, client, controller.signal);
    if (!request || !isActive(controller)) return;
    setBusyAction(action);
    await execute(client, controller, selection, request, destination);
  }

  async function run(
    action: BusyAction,
    prepare: Prepare,
    operation: SelectionAction | 'move_to_stage',
    destination?: string,
  ) {
    const client = args.getClient();
    if (!client) {
      void ctx.alert(
        'This action requires the current user access token permission.',
      );
      return;
    }
    const controller = begin();
    if (!controller) return;
    try {
      await perform(
        client,
        controller,
        action,
        prepare,
        operation,
        destination,
      );
    } catch (error) {
      if (isActive(controller)) {
        void ctx.alert(bulkErrorMessage(operation, error));
        args.reload();
      }
    } finally {
      finish(controller);
    }
  }

  // The promise ends with the action: the button of the bar shows a spinner
  function runSelectionAction(action: SelectionAction) {
    return run(
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

  /** Moves the selection to the stage picked in the menu of the bar. */
  function moveToStage(destination: WorkflowStageOption) {
    return run(
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
          destination,
          stages: workflow.stages.map(({ id, name }) => ({ id, name })),
          selectionInput: selection,
        });
      },
      'move_to_stage',
      destination.name,
    );
  }

  const actions: Partial<Record<SelectionAction, () => Promise<void>>> = {
    delete: whenEligible(evaluations.delete, () =>
      runSelectionAction('delete'),
    ),
    publish:
      statuses.has('draft') || statuses.has('updated')
        ? whenEligible(evaluations.publish, () => runSelectionAction('publish'))
        : undefined,
    unpublish:
      statuses.has('published') || statuses.has('updated')
        ? whenEligible(evaluations.unpublish, () =>
            runSelectionAction('unpublish'),
          )
        : undefined,
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
    /** Move to stage applies: the selection may go to another stage. */
    canMove: evaluations.move,
    /** The selection, for the stages that the move menu offers */
    selectionInput,
    moveToStage,
    progressText: progressLabel(ctx.ui.locale, busyAction, progress),
    /** Stops the jobs that did not start yet */
    onCancel: () => controllerRef.current?.abort(),
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
