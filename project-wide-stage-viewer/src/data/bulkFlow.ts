// Prompts and API reads around a bulk action, ported from the all-records-viewer
// page. They take everything they need as arguments so the hook stays small.
import type { Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import {
  availableMoveDestinationIds,
  evaluateMoveSelection,
} from '../operations/candidates';
import { identityKey } from '../operations/permissions';
import { bulkResultMessage, PAST_TENSE } from '../operations/results';
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

/**
 * The question of a confirm: "Delete 2 records?", or "Delete the record?"
 * when the user selected one record. A part of a larger selection keeps its
 * number: "Publish 1 record?"
 */
function confirmationTitle(
  label: string,
  { selectedCount, eligibleCount }: SelectionEvaluation,
  ending = '',
): string {
  if (selectedCount === 1) return `${label} the record${ending}?`;
  const records = eligibleCount === 1 ? 'record' : 'records';
  return `${label} ${eligibleCount} ${records}${ending}?`;
}

/**
 * What the title does not say: the selected records that the action leaves
 * as they are, else what changes for them, and that a delete can't be undone.
 */
export function confirmationContent(
  action: SelectionAction | 'move_to_stage',
  evaluation: SelectionEvaluation,
): string {
  const { eligibleCount, excludedCount, selectedCount } = evaluation;
  const one = eligibleCount === 1;
  const parts: string[] = [];
  if (excludedCount > 0) {
    parts.push(
      `Only ${eligibleCount} of the ${selectedCount} selected records can be ${PAST_TENSE[action]}.`,
      excludedCount === 1
        ? 'The other stays as it is.'
        : `The other ${excludedCount} stay as they are.`,
    );
  } else if (action === 'publish') {
    parts.push(
      one ? 'Its latest changes go live.' : 'Their latest changes go live.',
    );
  } else if (action === 'unpublish') {
    parts.push(one ? 'It goes back to draft.' : 'They go back to draft.');
  }
  if (action === 'delete') parts.push("You can't undo this.");
  return parts.join(' ');
}

export async function confirmSelectionAction(
  ctx: RenderPageCtx,
  action: SelectionAction,
  evaluation: SelectionEvaluation,
): Promise<boolean> {
  const label = OPERATION_LABEL[action];
  return Boolean(
    await ctx.openConfirm({
      title: confirmationTitle(label, evaluation),
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

/**
 * The toast of the result: a notice when everything was done, a warning
 * when the user stopped the action, and an alert when records failed.
 */
export function reportBulkResult(
  ctx: RenderPageCtx,
  result: BulkOperationResult,
  destination?: string,
): void {
  const message = bulkResultMessage(result, destination);
  if (result.cancelled) {
    void ctx.customToast({
      type: 'warning',
      message,
      dismissAfterTimeout: true,
    });
  } else if (result.successful < result.requested) {
    void ctx.alert(message);
  } else {
    void ctx.notice(message);
  }
}

/**
 * Checks the stage picked in the menu against the stages read again. Only
 * stages that at least one selected record may move to are allowed. A move
 * is easy to undo, so it asks only when some selected records can't move.
 */
export async function prepareMoveOperation(args: {
  ctx: RenderPageCtx;
  destination: WorkflowStageOption;
  stages: readonly WorkflowStageOption[];
  selectionInput: SelectionInput;
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

  const destination = stages.find((stage) => stage.id === args.destination.id);
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

  const request: BulkOperationRequest = {
    operation: 'move_to_stage',
    itemIds: evaluation.itemIds,
    stage: destination.id,
  };
  if (evaluation.excludedCount === 0) return request;

  const confirmed = await args.ctx.openConfirm({
    title: confirmationTitle('Move', evaluation, ` to ${destination.name}`),
    content: confirmationContent('move_to_stage', evaluation),
    choices: [{ label: 'Move', value: true, intent: 'positive' }],
    cancel: { label: 'Cancel', value: false },
  });
  return confirmed ? request : null;
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
