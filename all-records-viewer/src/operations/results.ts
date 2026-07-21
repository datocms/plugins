import type {
  BulkJobResult,
  BulkOperation,
  BulkOperationResult,
} from './types';

const pastTense: Record<BulkOperation, string> = {
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

export function bulkResultMessage(result: BulkOperationResult): string {
  const record = result.successful === 1 ? 'record' : 'records';

  if (result.failed === 0) {
    return `${result.successful} ${record} ${pastTense[result.operation]}.`;
  }

  if (result.successful === 0) {
    const failedRecord = result.failed === 1 ? 'record' : 'records';
    return `No records were ${pastTense[result.operation]}; ${result.failed} ${failedRecord} failed.`;
  }

  const failedRecord = result.failed === 1 ? 'record' : 'records';
  return `${result.successful} ${record} ${pastTense[result.operation]}; ${result.failed} ${failedRecord} failed.`;
}

function errorDetail(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return null;
}

export function bulkErrorMessage(
  operation: BulkOperation,
  error: unknown,
): string {
  const prefix = `Could not ${infinitive[operation]} the selected records`;
  const detail = errorDetail(error);

  return detail ? `${prefix}: ${detail}` : `${prefix}.`;
}
