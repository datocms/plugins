import type { RawApiTypes } from '@datocms/cma-client-browser';
import { MAX_BULK_ITEMS } from '../constants';

function normalizedItemIds(itemIds: readonly string[]): string[] {
  return [...new Set(itemIds)];
}

function validateItemIds(itemIds: readonly string[]): string[] {
  const normalized = normalizedItemIds(itemIds);

  if (normalized.length === 0) {
    throw new RangeError('A bulk operation requires at least one record.');
  }

  if (normalized.length > MAX_BULK_ITEMS) {
    throw new RangeError(
      `A bulk operation cannot contain more than ${MAX_BULK_ITEMS} records.`,
    );
  }

  return normalized;
}

function itemData(itemIds: readonly string[]) {
  return validateItemIds(itemIds).map((id) => ({
    id,
    type: 'item' as const,
  }));
}

export function buildBulkPublishPayload(
  itemIds: readonly string[],
): RawApiTypes.ItemBulkPublishSchema {
  return {
    data: {
      type: 'item_bulk_publish_operation',
      relationships: { items: { data: itemData(itemIds) } },
    },
  };
}

export function buildBulkUnpublishPayload(
  itemIds: readonly string[],
): RawApiTypes.ItemBulkUnpublishSchema {
  return {
    data: {
      type: 'item_bulk_unpublish_operation',
      relationships: { items: { data: itemData(itemIds) } },
    },
  };
}

export function buildBulkDestroyPayload(
  itemIds: readonly string[],
): RawApiTypes.ItemBulkDestroySchema {
  return {
    data: {
      type: 'item_bulk_destroy_operation',
      relationships: { items: { data: itemData(itemIds) } },
    },
  };
}

export function buildBulkMoveToStagePayload(
  itemIds: readonly string[],
  stage: string,
): RawApiTypes.ItemBulkMoveToStageSchema {
  if (!stage.trim()) {
    throw new RangeError('A destination stage is required.');
  }

  return {
    data: {
      type: 'item_bulk_move_to_stage_operation',
      attributes: { stage },
      relationships: { items: { data: itemData(itemIds) } },
    },
  };
}
