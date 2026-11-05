import { apiErrorCode, retryAdvice } from '../lib/cma';
import type {
  BulkJobResult,
  BulkOperation,
  BulkOperationResult,
} from './types';

export const PAST_TENSE: Record<BulkOperation, string> = {
  delete: 'deleted',
  publish: 'published',
  unpublish: 'unpublished',
  move_to_stage: 'moved',
};

const infinitive: Record<BulkOperation, string> = {
  delete: 'delete',
  publish: 'publish',
  unpublish: 'unpublish',
  move_to_stage: 'move',
};

export function normalizeBulkOperationResult(
  operation: BulkOperation,
  requested: number,
  result: BulkJobResult,
): BulkOperationResult {
  return {
    operation,
    requested,
    successful: result.meta.successful,
    failed: result.meta.failed,
  };
}

export function isPartialBulkResult(result: BulkOperationResult): boolean {
  return result.successful > 0 && result.failed > 0;
}

function records(count: number): string {
  return `${count} ${count === 1 ? 'record' : 'records'}`;
}

/** "published", or "moved to Approved" for a move to a named stage */
function doneVerb(operation: BulkOperation, destination?: string): string {
  return operation === 'move_to_stage' && destination
    ? `moved to ${destination}`
    : PAST_TENSE[operation];
}

/**
 * Why `count` records were not changed, in plain words after the sentence
 * that says so: a reason the API gave, else what to do next. Never the raw
 * error.
 */
function failureEnding(
  operation: BulkOperation,
  count: number,
  cause: unknown,
): string {
  const code = apiErrorCode(cause);
  const them = count === 1 ? 'it' : 'them';
  if (code === 'INSUFFICIENT_PERMISSIONS') {
    return `: you don't have permission to ${infinitive[operation]} ${them}.`;
  }
  if (code === 'INVALID_FIELD' || code?.startsWith('VALIDATION_')) {
    return `: ${count === 1 ? 'it has' : 'some have'} fields to fix.`;
  }
  return `. ${cause === undefined ? 'Try again in a moment.' : retryAdvice(cause)}`;
}

/** The toast after a bulk action: what changed and, if needed, what didn't. */
export function bulkResultMessage(
  result: BulkOperationResult,
  destination?: string,
): string {
  const done = doneVerb(result.operation, destination);
  const notDone = result.requested - result.successful;

  if (result.cancelled) {
    if (result.successful === 0) return `Stopped. No records were ${done}.`;
    const others =
      notDone === 1
        ? 'the other record was left as it was'
        : `the other ${notDone} were left as they were`;
    return `Stopped. ${records(result.successful)} ${done}; ${others}.`;
  }

  if (notDone <= 0) return `${records(result.successful)} ${done}.`;

  const ending = failureEnding(result.operation, notDone, result.cause);
  if (result.successful === 0) {
    return result.requested === 1
      ? `The record wasn't ${done}${ending}`
      : `No records were ${done}${ending}`;
  }
  const others = notDone === 1 ? 'The other' : `The other ${notDone}`;
  return `${records(result.successful)} ${done}. ${others} couldn't be ${PAST_TENSE[result.operation]}${ending}`;
}

/** The toast when none of the selected records is still in the stage. */
export function selectionGoneMessage(
  operation: BulkOperation,
  selectedCount: number,
  destination?: string,
): string {
  const done = doneVerb(operation, destination);
  return selectedCount === 1
    ? `The record wasn't ${done}: it's no longer in this stage.`
    : `No records were ${done}: they are no longer in this stage.`;
}

/** The toast when an action stops before its jobs: never the raw error. */
export function bulkErrorMessage(
  operation: BulkOperation,
  error: unknown,
): string {
  if (apiErrorCode(error) === 'INSUFFICIENT_PERMISSIONS') {
    return `You don't have permission to ${infinitive[operation]} the selected records.`;
  }
  return `Couldn't ${infinitive[operation]} the selected records. ${retryAdvice(error)}`;
}
