// Prompts and API reads around a bulk action, ported from the all-records-viewer
// page. They take everything they need as arguments so the hook stays small.
import type { Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { WORKFLOW_STAGE_MODAL_ID } from '../constants';
import {
  availableMoveDestinationIds,
  evaluateMoveSelection,
} from '../operations/candidates';
import { identityKey } from '../operations/permissions';
import { bulkResultMessage } from '../operations/results';
import type {
  BulkOperationRequest,
  BulkOperationResult,
  SelectionAction,
  SelectionEvaluation,
  SelectionInput,
} from '../operations/types';
import type { RawItem, WorkflowStageOption } from '../types';
import { loadItemsById, mapBounded } from './loadById';
import { compactSelectedItem } from './selection';

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** Role IDs of the people who may have created records, for creator-scoped rules. */
export function creatorRoleMap(
  users: RenderPageCtx['users'],
  ssoUsers: RenderPageCtx['ssoUsers'],
  owner: RenderPageCtx['owner'],
): ReadonlyMap<string, string | null> {
  const result = new Map<string, string | null>();
  for (const user of Object.values(users ?? {}).filter(isDefined)) {
    result.set(identityKey(user), user.relationships.role.data.id);
  }
  for (const user of Object.values(ssoUsers ?? {}).filter(isDefined)) {
    result.set(identityKey(user), user.relationships.role.data?.id ?? null);
  }
  if (owner) result.set(identityKey(owner), null);
  return result;
}

const OPERATION_LABEL: Record<SelectionAction, string> = {
  delete: 'Delete',
  publish: 'Publish',
  unpublish: 'Unpublish',
};

function recordsCount(count: number): string {
  return `${count} ${count === 1 ? 'record' : 'records'}`;
}

export function confirmationContent(
  action: SelectionAction | 'move_to_stage',
  evaluation: SelectionEvaluation,
): string {
  const eligible = recordsCount(evaluation.eligibleCount);
  const scope =
    evaluation.excludedCount > 0
      ? `${eligible} of ${evaluation.selectedCount} selected records are eligible.`
      : `${eligible} will be affected.`;
  return action === 'delete' ? `${scope} This action cannot be undone.` : scope;
}

export async function confirmSelectionAction(
  ctx: RenderPageCtx,
  action: SelectionAction,
  evaluation: SelectionEvaluation,
): Promise<boolean> {
  const label = OPERATION_LABEL[action];
  return Boolean(
    await ctx.openConfirm({
      title: `${label} selected records`,
      content: confirmationContent(action, evaluation),
      choices: [
        {
          label,
          value: true,
          intent: action === 'delete' ? 'negative' : 'positive',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    }),
  );
}

export function reportBulkResult(
  ctx: RenderPageCtx,
  result: BulkOperationResult,
): void {
  const message = bulkResultMessage(result);
  if (result.failed > 0 || result.uncertain || result.unprocessed) {
    void ctx.alert(message);
  } else {
    void ctx.notice(message);
  }
}

/**
 * Asks for the destination stage, then confirms the move. Only stages that at
 * least one selected record may move to are offered.
 */
export async function prepareMoveOperation(args: {
  ctx: RenderPageCtx;
  stages: readonly WorkflowStageOption[];
  selectionInput: SelectionInput;
  signal?: AbortSignal;
}): Promise<BulkOperationRequest | null> {
  const allowedIds = new Set(
    availableMoveDestinationIds({
      ...args.selectionInput,
      destinationStageIds: args.stages.map((stage) => stage.id),
    }),
  );
  const stages = args.stages.filter((stage) => allowedIds.has(stage.id));
  if (stages.length === 0) {
    void args.ctx.alert(
      'None of the selected records can be moved to another stage.',
    );
    return null;
  }

  const stageId = await args.ctx.openModal({
    id: WORKFLOW_STAGE_MODAL_ID,
    title: 'Move to stage',
    width: 's',
    initialHeight: 260,
    parameters: {
      count: args.selectionInput.items.length,
      stages: stages.map(({ id, name }) => ({ id, name })),
    },
  });
  const destination = stages.find((stage) => stage.id === stageId);
  if (typeof stageId !== 'string' || args.signal?.aborted) return null;
  if (!destination) {
    void args.ctx.alert('The selected workflow stage is no longer available.');
    return null;
  }

  const evaluation = evaluateMoveSelection({
    ...args.selectionInput,
    destinationStageId: destination.id,
  });
  if (evaluation.disabledReason) {
    void args.ctx.alert(evaluation.disabledReason);
    return null;
  }

  const confirmed = await args.ctx.openConfirm({
    title: `Move selected records to ${destination.name}`,
    content: `${confirmationContent('move_to_stage', evaluation)} Destination: ${destination.name}.`,
    choices: [{ label: 'Move to stage', value: true, intent: 'positive' }],
    cancel: { label: 'Cancel', value: false },
  });
  return confirmed
    ? {
        operation: 'move_to_stage',
        itemIds: evaluation.itemIds,
        stage: destination.id,
      }
    : null;
}

const MISSING_SELECTION =
  'Some selected records no longer exist or cannot be read. Reload the page and select the records again.';

/**
 * Reads the selected records again right before an action, so permissions and
 * eligibility use their current stage, status, and creator.
 */
export async function loadCurrentSelection(
  client: Client,
  selected: readonly RawItem[],
  {
    omitMissing = false,
    signal,
  }: { omitMissing?: boolean; signal?: AbortSignal } = {},
): Promise<RawItem[]> {
  const batches: string[][] = [];
  for (let offset = 0; offset < selected.length; offset += 100) {
    batches.push(selected.slice(offset, offset + 100).map((item) => item.id));
  }
  const loaded = (
    await mapBounded(batches, async (ids) => {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      // Keep only identities and meta, batch by batch.
      return (await loadItemsById(client, ids)).map(compactSelectedItem);
    })
  ).flat();

  const byId = new Map(loaded.map((item) => [item.id, item]));
  if (!omitMissing && byId.size !== selected.length) {
    throw new Error(MISSING_SELECTION);
  }
  return selected.flatMap((item) => {
    const current = byId.get(item.id);
    return current ? [current] : [];
  });
}
