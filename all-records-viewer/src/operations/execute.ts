import { MAX_BULK_ITEMS } from '../constants';
import {
  buildBulkDestroyPayload,
  buildBulkMoveToStagePayload,
  buildBulkPublishPayload,
  buildBulkUnpublishPayload,
} from './payloads';
import { normalizeBulkOperationResult } from './results';
import type {
  BulkClient,
  BulkExecutionOptions,
  BulkJobResult,
  BulkOperationRequest,
  BulkOperationResult,
} from './types';

async function executeBatch(
  client: BulkClient,
  request: BulkOperationRequest,
  itemIds: readonly string[],
): Promise<BulkJobResult> {
  switch (request.operation) {
    case 'publish':
      return client.items.rawBulkPublish(buildBulkPublishPayload(itemIds));
    case 'unpublish':
      return client.items.rawBulkUnpublish(buildBulkUnpublishPayload(itemIds));
    case 'delete':
      return client.items.rawBulkDestroy(buildBulkDestroyPayload(itemIds));
    case 'move_to_stage':
      return client.items.rawBulkMoveToStage(
        buildBulkMoveToStagePayload(itemIds, request.stage),
      );
  }
}

function responseStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = error.response;
  return typeof response === 'object' &&
    response !== null &&
    'status' in response &&
    typeof response.status === 'number'
    ? response.status
    : undefined;
}

type BatchOutcome = {
  successful: number;
  failed: number;
  stop: boolean;
  error?: string;
};

async function runBatch(
  client: BulkClient,
  request: BulkOperationRequest,
  batch: readonly string[],
): Promise<BatchOutcome> {
  try {
    const job = await executeBatch(client, request, batch);
    const counts = normalizeBulkOperationResult(
      request.operation,
      batch.length,
      job,
    );
    return {
      successful: counts.successful,
      failed: counts.failed,
      stop: false,
    };
  } catch (error) {
    const status = responseStatus(error);
    return {
      successful: 0,
      failed: batch.length,
      // Rejected records (for example, already deleted) do not affect other
      // batches. Any other failure stops the remaining submissions.
      stop:
        status === undefined ||
        status < 400 ||
        status >= 500 ||
        [401, 403, 429].includes(status),
      error: error instanceof Error ? error.message : 'The request failed.',
    };
  }
}

function validateRequest(
  request: BulkOperationRequest,
  itemIds: readonly string[],
): void {
  const batch = itemIds.slice(0, MAX_BULK_ITEMS);
  if (request.operation === 'move_to_stage') {
    buildBulkMoveToStagePayload(batch, request.stage);
  } else {
    buildBulkDestroyPayload(batch);
  }
}

/**
 * Await each job before submitting the next batch. Cancellation stops future
 * submissions and lets an accepted job finish.
 */
export async function executeBulkOperation(
  client: BulkClient,
  request: BulkOperationRequest,
  options: BulkExecutionOptions = {},
): Promise<BulkOperationResult> {
  const itemIds = [...new Set(request.itemIds)];
  validateRequest(request, itemIds);
  const remaining = new Set(itemIds);
  const result: BulkOperationResult = {
    operation: request.operation,
    requested: itemIds.length,
    successful: 0,
    failed: 0,
  };
  let completed = 0;
  const report = () =>
    options.onProgress?.({
      requested: result.requested,
      completed,
      successful: result.successful,
      failed: result.failed,
    });
  report();

  for (let offset = 0; offset < itemIds.length; offset += MAX_BULK_ITEMS) {
    if (options.signal?.aborted) {
      result.cancelled = true;
      break;
    }
    const batch = itemIds.slice(offset, offset + MAX_BULK_ITEMS);
    // biome-ignore lint/performance/noAwaitInLoops: At most one mutation job may be in flight.
    const outcome = await runBatch(client, request, batch);
    result.successful += outcome.successful;
    result.failed += outcome.failed;
    completed += outcome.successful + outcome.failed;
    result.error = result.error ?? outcome.error;
    // The API guarantees counts rather than a per-record success map. Retain
    // a partially failed batch instead of guessing which IDs succeeded.
    if (outcome.successful === batch.length) {
      for (const id of batch) remaining.delete(id);
    }
    report();
    if (outcome.stop) break;
  }
  result.unprocessed = itemIds.length - completed;
  result.remainingItemIds = [...remaining];
  return result;
}
