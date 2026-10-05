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
  uncertain: number;
  stop: boolean;
  error?: string;
};

function validCounts(
  successful: number,
  failed: number,
  count: number,
): boolean {
  return (
    Number.isInteger(successful) &&
    Number.isInteger(failed) &&
    successful >= 0 &&
    failed >= 0 &&
    successful + failed === count
  );
}

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
    if (!validCounts(counts.successful, counts.failed, batch.length)) {
      throw new Error('The API returned inconsistent bulk result counts.');
    }
    return {
      successful: counts.successful,
      failed: counts.failed,
      uncertain: 0,
      stop: false,
    };
  } catch (error) {
    const status = responseStatus(error);
    const detail =
      error instanceof Error ? error.message : 'The request failed.';
    if (status !== undefined && status >= 400 && status < 500) {
      return {
        successful: 0,
        failed: batch.length,
        uncertain: 0,
        stop: [401, 403, 429].includes(status),
        error: detail,
      };
    }
    return {
      successful: 0,
      failed: 0,
      uncertain: batch.length,
      stop: true,
      error: detail,
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
 * Splits IDs into API batches: one group per key (in first-seen order), each
 * cut into chunks of at most MAX_BULK_ITEMS.
 */
export function buildBatches(
  itemIds: readonly string[],
  batchKey?: (itemId: string) => string,
): string[][] {
  const groups = new Map<string, string[]>();
  for (const id of itemIds) {
    const key = batchKey?.(id) ?? '';
    const group = groups.get(key);
    if (group) group.push(id);
    else groups.set(key, [id]);
  }

  const batches: string[][] = [];
  for (const group of groups.values()) {
    for (let offset = 0; offset < group.length; offset += MAX_BULK_ITEMS) {
      batches.push(group.slice(offset, offset + MAX_BULK_ITEMS));
    }
  }
  return batches;
}

/**
 * Await each job before submitting the next batch. Cancellation stops future
 * submissions and lets an accepted job finish. An ambiguous outcome is never
 * retried: doing so could delete or publish a newer version of a record.
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

  for (const batch of buildBatches(itemIds, options.batchKey)) {
    if (options.signal?.aborted) {
      result.cancelled = true;
      break;
    }
    // biome-ignore lint/performance/noAwaitInLoops: At most one mutation job may be in flight.
    const outcome = await runBatch(client, request, batch);
    result.successful += outcome.successful;
    result.failed += outcome.failed;
    completed += outcome.successful + outcome.failed;
    result.error = result.error ?? outcome.error;
    result.uncertain = outcome.uncertain;
    // The API guarantees counts rather than a per-record success map. Retain
    // a partially failed batch instead of guessing which IDs succeeded.
    if (outcome.successful === batch.length) {
      for (const id of batch) remaining.delete(id);
    }
    report();
    if (outcome.stop) break;
  }
  result.unprocessed = itemIds.length - completed - (result.uncertain ?? 0);
  result.remainingItemIds = [...remaining];
  return result;
}
