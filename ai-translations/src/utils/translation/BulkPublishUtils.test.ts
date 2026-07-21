import { describe, expect, it, vi } from 'vitest';
import type { ProgressUpdate } from './ItemsDropdownUtils';
import {
  BULK_PUBLISH_BATCH_SIZE,
  bulkPublishTranslatedRecords,
  getDraftModeItemTypeIds,
  getPublishableTranslatedRecordIds,
} from './BulkPublishUtils';

function completedUpdate(
  overrides: Partial<ProgressUpdate> = {},
): ProgressUpdate {
  return {
    recordIndex: 0,
    recordId: 'record-1',
    itemTypeId: 'model-draft',
    status: 'completed',
    translatedFieldApiKeys: ['title'],
    ...overrides,
  };
}

describe('getPublishableTranslatedRecordIds', () => {
  it('returns only successfully updated records from draft-enabled models', () => {
    const updates: ProgressUpdate[] = [
      completedUpdate(),
      completedUpdate({
        recordIndex: 1,
        recordId: 'record-with-copied-link',
        translatedFieldApiKeys: [],
        copiedLinkFieldIds: ['link-field'],
      }),
      completedUpdate({
        recordIndex: 2,
        recordId: 'record-with-no-updates',
        translatedFieldApiKeys: [],
      }),
      completedUpdate({
        recordIndex: 3,
        recordId: 'record-failed',
        status: 'error',
      }),
      completedUpdate({
        recordIndex: 4,
        recordId: 'record-without-draft-mode',
        itemTypeId: 'model-regular',
      }),
      completedUpdate({
        recordIndex: 5,
        recordId: 'record-without-model',
        itemTypeId: undefined,
      }),
    ];

    expect(
      getPublishableTranslatedRecordIds(updates, ['model-draft']),
    ).toEqual(['record-1', 'record-with-copied-link']);
  });

  it('deduplicates record IDs while preserving their first-seen order', () => {
    const updates = [
      completedUpdate({ recordId: 'record-2' }),
      completedUpdate({ recordIndex: 1, recordId: 'record-1' }),
      completedUpdate({ recordIndex: 2, recordId: 'record-2' }),
    ];

    expect(
      getPublishableTranslatedRecordIds(updates, ['model-draft']),
    ).toEqual(['record-2', 'record-1']);
  });
});

describe('getDraftModeItemTypeIds', () => {
  it('deduplicates model lookups and returns only draft-enabled models', async () => {
    const getItemType = vi.fn(async (itemTypeId: string) => ({
      draft_mode_active: itemTypeId === 'model-draft',
    }));

    await expect(
      getDraftModeItemTypeIds(
        ['model-draft', 'model-regular', 'model-draft'],
        getItemType,
      ),
    ).resolves.toEqual(['model-draft']);
    expect(getItemType).toHaveBeenCalledTimes(2);
  });
});

describe('bulkPublishTranslatedRecords', () => {
  it('publishes unique records sequentially in batches of at most 200', async () => {
    const callOrder: number[] = [];
    const bulkPublish = vi.fn(async (body: { items: unknown[] }) => {
      callOrder.push(body.items.length);
    });
    const recordIds = Array.from(
      { length: BULK_PUBLISH_BATCH_SIZE * 2 + 1 },
      (_, index) => `record-${index}`,
    );

    await expect(
      bulkPublishTranslatedRecords(
        { items: { bulkPublish } },
        [...recordIds, recordIds[0]],
      ),
    ).resolves.toBe(401);

    expect(callOrder).toEqual([200, 200, 1]);
    expect(bulkPublish).toHaveBeenNthCalledWith(1, {
      items: recordIds.slice(0, 200).map((id) => ({ type: 'item', id })),
    });
  });

  it('reports progress only after each successful batch', async () => {
    const bulkPublish = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Publish failed'));
    const onBatchPublished = vi.fn();
    const recordIds = Array.from({ length: 201 }, (_, index) => `record-${index}`);

    await expect(
      bulkPublishTranslatedRecords(
        { items: { bulkPublish } },
        recordIds,
        onBatchPublished,
      ),
    ).rejects.toThrow('Publish failed');

    expect(onBatchPublished).toHaveBeenCalledOnce();
    expect(onBatchPublished).toHaveBeenCalledWith(
      recordIds.slice(0, 200),
      200,
      201,
    );
    expect(bulkPublish).toHaveBeenCalledTimes(2);
  });

  it('does nothing for an empty record list', async () => {
    const bulkPublish = vi.fn();

    await expect(
      bulkPublishTranslatedRecords({ items: { bulkPublish } }, []),
    ).resolves.toBe(0);
    expect(bulkPublish).not.toHaveBeenCalled();
  });
});
