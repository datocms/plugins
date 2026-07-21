import {
  buildBulkDestroyPayload,
  buildBulkMoveToStagePayload,
  buildBulkPublishPayload,
  buildBulkUnpublishPayload,
} from './payloads';
import { normalizeBulkOperationResult } from './results';
import type {
  BulkClient,
  BulkJobResult,
  BulkOperationRequest,
  BulkOperationResult,
} from './types';

export async function executeBulkOperation(
  client: BulkClient,
  request: BulkOperationRequest,
): Promise<BulkOperationResult> {
  let result: BulkJobResult;

  switch (request.operation) {
    case 'publish':
      result = await client.items.rawBulkPublish(
        buildBulkPublishPayload(request.itemIds),
      );
      break;
    case 'unpublish':
      result = await client.items.rawBulkUnpublish(
        buildBulkUnpublishPayload(request.itemIds),
      );
      break;
    case 'delete':
      result = await client.items.rawBulkDestroy(
        buildBulkDestroyPayload(request.itemIds),
      );
      break;
    case 'move_to_stage':
      result = await client.items.rawBulkMoveToStage(
        buildBulkMoveToStagePayload(request.itemIds, request.stage),
      );
      break;
  }

  return normalizeBulkOperationResult(
    request.operation,
    new Set(request.itemIds).size,
    result,
  );
}
