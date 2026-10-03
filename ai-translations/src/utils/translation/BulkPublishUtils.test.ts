import type { RawApiTypes } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import type { ProgressUpdate } from './ItemsDropdownUtils';
import {
  BULK_PUBLISH_BATCH_SIZE,
  BulkPublishPartialError,
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

    expect(getPublishableTranslatedRecordIds(updates, ['model-draft'])).toEqual(
      ['record-1', 'record-with-copied-link'],
    );
  });

  it('deduplicates record IDs while preserving their first-seen order', () => {
    const updates = [
      completedUpdate({ recordId: 'record-2' }),
      completedUpdate({ recordIndex: 1, recordId: 'record-1' }),
      completedUpdate({ recordIndex: 2, recordId: 'record-2' }),
    ];

    expect(getPublishableTranslatedRecordIds(updates, ['model-draft'])).toEqual(
      ['record-2', 'record-1'],
    );
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

  it('limits concurrent schema lookups for many models and preserves selection order', async () => {
    let active = 0;
    let maximumActive = 0;
    const modelIds = Array.from(
      { length: 1000 },
      (_, index) => `model-${index}`,
    );
    const getItemType = vi.fn(async () => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active--;
      return { draft_mode_active: true };
    });
    await expect(
      getDraftModeItemTypeIds(modelIds, getItemType),
    ).resolves.toEqual(modelIds);
    expect(maximumActive).toBe(4);
  });

  it('does not load models after cancellation', async () => {
    const getItemType = vi.fn().mockResolvedValue({ draft_mode_active: true });
    await expect(
      getDraftModeItemTypeIds(['m1'], getItemType, {
        checkCancellation: () => true,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(getItemType).not.toHaveBeenCalled();
  });
});

function success(body: RawApiTypes.ItemBulkPublishSchema) {
  return {
    data: [],
    meta: { successful: body.data.relationships.items.data.length, failed: 0 },
  };
}

type PublishClient = Parameters<typeof bulkPublishTranslatedRecords>[0];
function createPublishClient(items: object): PublishClient {
  return { items } as PublishClient;
}

describe('bulkPublishTranslatedRecords', () => {
  it('publishes unique records sequentially in batches of at most 200', async () => {
    const callOrder: number[] = [];
    const rawBulkPublish = vi.fn(
      async (body: RawApiTypes.ItemBulkPublishSchema) => {
        callOrder.push(body.data.relationships.items.data.length);
        return success(body);
      },
    );
    const recordIds = Array.from(
      { length: BULK_PUBLISH_BATCH_SIZE * 2 + 1 },
      (_, index) => `record-${index}`,
    );

    await expect(
      bulkPublishTranslatedRecords(
        createPublishClient({ rawBulkPublish, list: vi.fn() }),
        [...recordIds, recordIds[0]],
      ),
    ).resolves.toBe(401);

    expect(callOrder).toEqual([200, 200, 1]);
    expect(rawBulkPublish).toHaveBeenNthCalledWith(1, {
      data: {
        type: 'item_bulk_publish_operation',
        relationships: {
          items: {
            data: recordIds.slice(0, 200).map((id) => ({ type: 'item', id })),
          },
        },
      },
    });
  });

  it('reports progress only after each successful batch', async () => {
    const rawBulkPublish = vi
      .fn()
      .mockResolvedValueOnce({ data: [], meta: { successful: 200, failed: 0 } })
      .mockRejectedValueOnce(new Error('Publish failed'));
    const onBatchPublished = vi.fn();
    const recordIds = Array.from(
      { length: 201 },
      (_, index) => `record-${index}`,
    );

    await expect(
      bulkPublishTranslatedRecords(
        createPublishClient({ rawBulkPublish, list: vi.fn() }),
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
    expect(rawBulkPublish).toHaveBeenCalledTimes(2);
  });

  it('does nothing for an empty record list', async () => {
    const rawBulkPublish = vi.fn();

    await expect(
      bulkPublishTranslatedRecords(
        createPublishClient({ rawBulkPublish, list: vi.fn() }),
        [],
      ),
    ).resolves.toBe(0);
    expect(rawBulkPublish).not.toHaveBeenCalled();
  });

  it('confirms only published IDs from a partial result and continues later batches', async () => {
    const ids = Array.from({ length: 201 }, (_, index) => `r${index}`);
    const rawBulkPublish = vi
      .fn()
      .mockResolvedValueOnce({ data: [], meta: { successful: 199, failed: 1 } })
      .mockImplementationOnce(success);
    const list = vi.fn(async (query: { filter: { ids: string } }) =>
      query.filter.ids.split(',').map((id) => ({
        id,
        meta: { status: id === 'r1' ? 'updated' : 'published' },
      })),
    );
    const onBatchPublished = vi.fn();
    const result = await bulkPublishTranslatedRecords(
      createPublishClient({ rawBulkPublish, list }),
      ids,
      onBatchPublished,
    ).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(BulkPublishPartialError);
    expect(result).toMatchObject({
      failedRecordIds: ['r1'],
      publishedCount: 200,
    });
    expect(onBatchPublished).toHaveBeenCalledTimes(2);
    expect(onBatchPublished.mock.calls[0][0]).not.toContain('r1');
    expect(onBatchPublished.mock.calls[1]).toEqual([['r200'], 200, 201]);
    expect(rawBulkPublish).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(7);
    for (const [query] of list.mock.calls)
      expect(query.filter.ids.split(',').length).toBeLessThanOrEqual(30);
  });

  it('requires status confirmation if counts do not account for the complete batch', async () => {
    const rawBulkPublish = vi
      .fn()
      .mockResolvedValue({ data: [], meta: { successful: 1, failed: 0 } });
    const list = vi
      .fn()
      .mockResolvedValue([{ id: 'r1', meta: { status: 'published' } }]);
    const onBatchPublished = vi.fn();
    await expect(
      bulkPublishTranslatedRecords(
        createPublishClient({ rawBulkPublish, list }),
        ['r1', 'r2'],
        onBatchPublished,
      ),
    ).rejects.toMatchObject({ failedRecordIds: ['r2'], publishedCount: 1 });
    expect(onBatchPublished).toHaveBeenCalledWith(['r1'], 1, 2);
  });

  it('preserves confirmed progress when cancelled while the current batch is publishing', async () => {
    let cancelled = false;
    const rawBulkPublish = vi.fn(
      async (body: RawApiTypes.ItemBulkPublishSchema) => {
        cancelled = true;
        return success(body);
      },
    );
    const onBatchPublished = vi.fn();
    await expect(
      bulkPublishTranslatedRecords(
        createPublishClient({ rawBulkPublish, list: vi.fn() }),
        Array.from({ length: 201 }, (_, index) => `r${index}`),
        onBatchPublished,
        { checkCancellation: () => cancelled },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawBulkPublish).toHaveBeenCalledTimes(1);
    expect(onBatchPublished.mock.calls[0][1]).toBe(200);
  });

  it('processes a synthetic 200,000-ID selection without parallel mutations', async () => {
    let batches = 0;
    let active = 0;
    let maximumActive = 0;
    const rawBulkPublish = async (body: RawApiTypes.ItemBulkPublishSchema) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      batches++;
      expect(body.data.relationships.items.data.length).toBeLessThanOrEqual(
        200,
      );
      await Promise.resolve();
      active--;
      return success(body);
    };
    function* ids() {
      for (let index = 0; index < 200_000; index++) yield `r${index}`;
    }
    await expect(
      bulkPublishTranslatedRecords(
        createPublishClient({ rawBulkPublish, list: vi.fn() }),
        ids(),
      ),
    ).resolves.toBe(200_000);
    expect(batches).toBe(1000);
    expect(maximumActive).toBe(1);
  });

  it('acknowledges a partial mutation before observing cancellation', async () => {
    let cancelled = false;
    const rawBulkPublish = vi.fn(async () => {
      cancelled = true;
      return { data: [], meta: { successful: 1, failed: 1 } };
    });
    const list = vi.fn().mockResolvedValue([
      { id: 'r1', meta: { status: 'published' } },
      { id: 'r2', meta: { status: 'updated' } },
    ]);
    const onBatchPublished = vi.fn();
    await expect(
      bulkPublishTranslatedRecords(
        createPublishClient({ rawBulkPublish, list }),
        ['r1', 'r2'],
        onBatchPublished,
        { checkCancellation: () => cancelled },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(list).toHaveBeenCalledTimes(1);
    expect(onBatchPublished).toHaveBeenCalledWith(['r1'], 1, 2);
    expect(rawBulkPublish).toHaveBeenCalledTimes(1);
  });

  it('skips records edited after translation while publishing unchanged versions', async () => {
    const rawBulkPublish = vi.fn(success);
    const list = vi.fn().mockResolvedValue([
      { id: 'r1', meta: { current_version: 'translated-r1' } },
      { id: 'r2', meta: { current_version: 'later-edit-r2' } },
    ]);
    const onBatchPublished = vi.fn();
    await expect(
      bulkPublishTranslatedRecords(
        createPublishClient({ rawBulkPublish, list }),
        ['r1', 'r2'],
        onBatchPublished,
        {
          expectedVersions: new Map([
            ['r1', 'translated-r1'],
            ['r2', 'translated-r2'],
          ]),
        },
      ),
    ).rejects.toMatchObject({ failedRecordIds: ['r2'], publishedCount: 1 });
    expect(rawBulkPublish).toHaveBeenCalledWith({
      data: {
        type: 'item_bulk_publish_operation',
        relationships: { items: { data: [{ type: 'item', id: 'r1' }] } },
      },
    });
    expect(onBatchPublished).toHaveBeenCalledWith(['r1'], 1, 2);
  });

  it('does not publish when version preflight cannot be read safely', async () => {
    const rawBulkPublish = vi.fn(success);
    const list = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      bulkPublishTranslatedRecords(
        createPublishClient({ rawBulkPublish, list }),
        ['r1'],
        undefined,
        { expectedVersions: new Map([['r1', 'translated-r1']]) },
      ),
    ).rejects.toThrow('Failed to fetch');
    expect(rawBulkPublish).not.toHaveBeenCalled();
  });
});
