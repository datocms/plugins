import type { buildClient } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import {
  BULK_RECORD_BATCH_SIZE,
  collectRecordIds,
  loadRecordBatches,
  type RecordDiscoveryProgress,
  type RecordLoadingProgress,
} from './BulkRecordLoader';
import type { DatoCMSRecordFromAPI } from './ItemsDropdownUtils';
import { normalizeProviderError } from './ProviderErrors';

type Client = ReturnType<typeof buildClient>;
type ListQuery = {
  filter: { ids: string };
  nested: boolean;
  version: string;
  page: { offset: number; limit: number };
};
type DiscoveryQuery = {
  filter: { type: string };
  version: string;
  order_by?: string;
  page: { offset: number; limit: number };
};

const createRecord = (id: string): DatoCMSRecordFromAPI => ({
  id,
  item_type: { id: 'model-1' },
  title: { en: `Title ${id}` },
});
const createClient = (items: object): Client => ({ items }) as Client;
const createIds = (count: number) =>
  Array.from({ length: count }, (_, i) => String(i + 1).padStart(22, 'A'));

describe('loadRecordBatches', () => {
  it('loads 2882 selected records in bounded requests and keeps global progress', async () => {
    const ids = createIds(2882);
    const list = vi.fn(async (query: ListQuery) =>
      query.filter.ids.split(',').map(createRecord).reverse(),
    );
    const progress: RecordLoadingProgress[] = [];
    const seenIds: string[] = [];

    for await (const batch of loadRecordBatches(createClient({ list }), ids, {
      onProgress: (update) => progress.push(update),
    })) {
      expect(batch.records.length).toBeLessThanOrEqual(BULK_RECORD_BATCH_SIZE);
      expect(batch.missingItemIds).toEqual([]);
      seenIds.push(...batch.records.map((record) => record.id));
    }

    expect(seenIds).toEqual(ids);
    expect(list).toHaveBeenCalledTimes(97);
    for (const [query] of list.mock.calls) {
      expect(query.filter.ids.split(',').length).toBeLessThanOrEqual(30);
      expect(query.page).toEqual({ offset: 0, limit: 30 });
      expect(query.nested).toBe(true);
      expect(query.version).toBe('current');
      const encodedQuery = new URLSearchParams({
        'filter[ids]': query.filter.ids,
        nested: 'true',
        version: 'current',
        'page[limit]': '30',
        'page[offset]': '0',
      }).toString();
      expect(encodedQuery.length).toBeLessThan(2000);
    }
    expect(progress[0]).toEqual({ loaded: 0, total: 2882 });
    expect(progress.at(-1)).toEqual({ loaded: 2882, total: 2882 });
  });

  it('waits for the consumer before fetching the next batch', async () => {
    const list = vi.fn(async (query: ListQuery) =>
      query.filter.ids.split(',').map(createRecord),
    );
    const iterator = loadRecordBatches(createClient({ list }), createIds(61));
    const first = await iterator.next();
    expect(first.value?.records).toHaveLength(30);
    expect(list).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(list).toHaveBeenCalledTimes(1);
    await iterator.next();
    expect(list).toHaveBeenCalledTimes(2);
    await iterator.return(undefined);
  });

  it('reports missing records while preserving selection order', async () => {
    const list = vi
      .fn()
      .mockResolvedValue([createRecord('r3'), createRecord('r1')]);
    const iterator = loadRecordBatches(createClient({ list }), [
      'r1',
      'r2',
      'r3',
      'r1',
    ]);
    const result = await iterator.next();
    expect(result.value).toEqual({
      records: [createRecord('r1'), createRecord('r3')],
      requestedItemIds: ['r1', 'r2', 'r3'],
      missingItemIds: ['r2'],
    });
    expect((await iterator.next()).done).toBe(true);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('does not request records after cancellation between batches', async () => {
    const list = vi.fn(async (query: ListQuery) =>
      query.filter.ids.split(',').map(createRecord),
    );
    const controller = new AbortController();
    const iterator = loadRecordBatches(createClient({ list }), createIds(61), {
      abortSignal: controller.signal,
    });
    await iterator.next();
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('discards a pending response when cancellation was requested', async () => {
    let cancelled = false;
    const list = vi.fn(async () => {
      cancelled = true;
      return [createRecord('r1')];
    });
    const iterator = loadRecordBatches(createClient({ list }), ['r1'], {
      checkCancellation: () => cancelled,
    });
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('classifies a loading network failure as a DatoCMS error', async () => {
    const list = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const iterator = loadRecordBatches(createClient({ list }), ['r1']);
    const error = await iterator.next().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(normalizeProviderError(error, 'openai').source).toBe('datocms');
    expect(normalizeProviderError(error, 'openai').message).toContain(
      'Could not load records: Failed to fetch',
    );
  });

  it('makes no CMA request for an empty selection', async () => {
    const list = vi.fn();
    const iterator = loadRecordBatches(createClient({ list }), []);
    expect((await iterator.next()).done).toBe(true);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('collectRecordIds', () => {
  it('discovers 2882 records in six non-nested pages with known progress', async () => {
    const ids = createIds(2882);
    const rawList = vi.fn(async (query: DiscoveryQuery) => ({
      data: ids
        .slice(query.page.offset, query.page.offset + query.page.limit)
        .map((id) => ({ id, attributes: { title: 'Content is discarded' } })),
      meta: { total_count: ids.length },
    }));
    const progress: RecordDiscoveryProgress[] = [];
    const result = await collectRecordIds(createClient({ rawList }), ['m1'], {
      onProgress: (update) => progress.push(update),
    });

    expect(result).toEqual(ids);
    expect(rawList).toHaveBeenCalledTimes(6);
    for (const [query] of rawList.mock.calls) {
      expect(query.page.limit).toBe(500);
      expect(query.order_by).toBe('id_ASC');
      expect(query.version).toBe('current');
      expect(query).not.toHaveProperty('nested', true);
      expect(query).not.toHaveProperty('only_fields');
    }
    expect(progress.at(-1)).toEqual({
      loaded: 2882,
      total: 2882,
      modelId: 'm1',
    });
    expect(progress[1]).toEqual({ loaded: 500, total: 2882, modelId: 'm1' });
  });

  it('counts all models before draining pages and reports the combined total', async () => {
    const idsByModel: Record<string, string[]> = {
      m1: createIds(501),
      m2: createIds(1200).map((id) => `B${id}`),
    };
    const rawList = vi.fn(async (query: DiscoveryQuery) => {
      const ids = idsByModel[query.filter.type];
      return {
        data: ids
          .slice(query.page.offset, query.page.offset + query.page.limit)
          .map((id) => ({ id })),
        meta: { total_count: ids.length },
      };
    });
    const progress: RecordDiscoveryProgress[] = [];
    const result = await collectRecordIds(
      createClient({ rawList }),
      ['m1', 'm2'],
      {
        onProgress: (update) => progress.push(update),
      },
    );

    expect(result).toHaveLength(1701);
    expect(
      rawList.mock.calls.slice(0, 2).map(([query]) => query.page.limit),
    ).toEqual([1, 1]);
    const knownProgress = progress.filter(
      (update) => update.total !== undefined,
    );
    expect(knownProgress[0]).toEqual({ loaded: 0, total: 1701, modelId: 'm1' });
    expect(knownProgress.every((update) => update.total === 1701)).toBe(true);
    expect(progress.at(-1)).toEqual({
      loaded: 1701,
      total: 1701,
      modelId: 'm2',
    });
  });

  it('stops discovery on cancellation without requesting another page or model', async () => {
    const controller = new AbortController();
    const rawList = vi.fn(async () => {
      controller.abort();
      return { data: [{ id: 'r1' }], meta: { total_count: 1000 } };
    });
    await expect(
      collectRecordIds(createClient({ rawList }), ['m1', 'm2'], {
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawList).toHaveBeenCalledTimes(1);
  });

  it('makes no CMA request when discovery is cancelled before it starts', async () => {
    const rawList = vi.fn();
    await expect(
      collectRecordIds(createClient({ rawList }), ['m1'], {
        checkCancellation: () => true,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawList).not.toHaveBeenCalled();
  });
});
