import type { BulkResult, CreatorType } from '../actions/bulkChangeCreator';
import { describeApiError } from '../services/requestErrors';

export const LARGE_SELECTION_THRESHOLD = 500;

export type CreatorSelection = {
  userId: string;
  userType: CreatorType;
};

export function isCreatorSelection(value: unknown): value is CreatorSelection {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const selection = value as Record<string, unknown>;
  return (
    typeof selection.userId === 'string' &&
    selection.userId.trim().length > 0 &&
    (selection.userType === 'user' ||
      selection.userType === 'sso_user' ||
      selection.userType === 'account' ||
      selection.userType === 'organization')
  );
}

export function isBulkResult(value: unknown): value is BulkResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const result = value as Record<string, unknown>;
  const counts = [
    result.total,
    result.succeeded,
    result.failed,
    result.uncertain,
    result.unprocessed,
  ];

  if (
    !counts.every(
      (count) =>
        typeof count === 'number' && Number.isSafeInteger(count) && count >= 0,
    ) ||
    typeof result.stopped !== 'boolean' ||
    (result.stopReason !== undefined &&
      typeof result.stopReason !== 'string') ||
    !Array.isArray(result.failureSamples)
  ) {
    return false;
  }

  if (
    !result.failureSamples.every(
      (sample: unknown) =>
        sample !== null &&
        typeof sample === 'object' &&
        'id' in sample &&
        typeof sample.id === 'string' &&
        'error' in sample &&
        typeof sample.error === 'string',
    )
  ) {
    return false;
  }

  const [total, succeeded, failed, uncertain, unprocessed] = counts as number[];
  return total === succeeded + failed + uncertain + unprocessed;
}

export function resolveExecutionError(error: unknown): string {
  return `The creator change could not be completed. ${describeApiError(error)}`;
}
