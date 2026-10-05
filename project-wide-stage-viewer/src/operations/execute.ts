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

type BatchOutcome = { successful: number; failed: number; error?: string };

async function runBatch(
  client: BulkClient,
  request: BulkOperationRequest,
  batch: readonly string[],
): Promise<BatchOutcome> {
  try {
    const job = await executeBatch(client, request, batch);
    const { successful, failed } = normalizeBulkOperationResult(
      request.operation,
      batch.length,
      job,
    );
    return { successful, failed };
  } catch (error) {
    return {
      successful: 0,
      failed: batch.length,
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
 * submissions and lets an accepted job finish. A failed request stops the run.
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
    completed += batch.length;
    // The API guarantees counts rather than a per-record success map. Retain
    // a partially failed batch instead of guessing which IDs succeeded.
    if (outcome.successful === batch.length) {
      for (const id of batch) remaining.delete(id);
    }
    report();
    if (outcome.error) {
      result.error = outcome.error;
      break;
    }
  }
  result.unprocessed = itemIds.length - completed;
  result.remainingItemIds = [...remaining];
  return result;
}
