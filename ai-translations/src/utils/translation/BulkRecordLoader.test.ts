import type { buildClient } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import {
  collectRecordIds,
  loadRecordBatches,
  type RecordDiscoveryProgress,
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
  filter: { type: string; fields: { _created_at: { lte: string } } };
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
  it('automatically reconciles offset shifts after a deletion without retaining deleted IDs', async () => {
    const ids = createIds(1001);
    let calls = 0;
    const rawList = vi.fn(async (query: DiscoveryQuery) => {
      calls++;
      if (calls === 2) ids.shift();
      return {
        data: ids
          .slice(query.page.offset, query.page.offset + query.page.limit)
          .map((id) => ({ id })),
        meta: { total_count: ids.length },
      };
    });
    const result = await collectRecordIds(createClient({ rawList }), ['m1']);
    expect(result).toEqual(ids);
    expect(rawList).toHaveBeenCalledTimes(6);
    expect(rawList.mock.calls.map(([query]) => query.page.offset)).toEqual([
      0, 30, 530, 0, 30, 530,
    ]);
  });

  it('shrinks discovery pages for content-heavy localized records', async () => {
    const text = 'X'.repeat(150_000);
    const rawList = vi.fn(async (query: DiscoveryQuery) => ({
      data: Array.from(
        { length: Math.min(query.page.limit, 75 - query.page.offset) },
        (_, index) => ({
          id: `r${query.page.offset + index}`,
          attributes: { title: { en: text } },
        }),
      ),
      meta: { total_count: 75 },
    }));
    await expect(
      collectRecordIds(createClient({ rawList }), ['m1']),
    ).resolves.toHaveLength(75);
    expect(rawList.mock.calls[0][0].page.limit).toBe(30);
    for (const [query] of rawList.mock.calls.slice(1)) {
      expect(query.page.limit).toBeLessThanOrEqual(13);
    }
  });

  it('does not skip a model that changed after its initial count', async () => {
    const rawList = vi.fn(async (query: DiscoveryQuery) => ({
      data:
        query.page.limit === 1 ? [] : [{ id: `record-${query.filter.type}` }],
      meta: { total_count: query.page.limit === 1 ? 0 : 1 },
    }));
    await expect(
      collectRecordIds(createClient({ rawList }), ['m1', 'm2']),
    ).resolves.toEqual(['record-m1', 'record-m2']);
    expect(rawList).toHaveBeenCalledTimes(6);
  });

  it('does not silently omit records when an endpoint returns short pages', async () => {
    const rawList = vi.fn(async (query: DiscoveryQuery) => ({
      data: [{ id: `record-${query.page.offset}` }],
      meta: { total_count: 4 },
    }));
    await expect(
      collectRecordIds(createClient({ rawList }), ['m1']),
    ).resolves.toEqual(['record-0', 'record-1', 'record-2', 'record-3']);
    expect(rawList.mock.calls.map(([query]) => query.page.offset)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it('fails clearly after bounded automatic reconciliation for an inconsistent listing', async () => {
    const rawList = vi.fn(async (query: DiscoveryQuery) => ({
      data: query.page.offset === 0 ? [{ id: 'r1' }] : [],
      meta: { total_count: 2 },
    }));
    await expect(
      collectRecordIds(createClient({ rawList }), ['m1']),
    ).rejects.toThrow('No translation was started');
    expect(rawList).toHaveBeenCalledTimes(6);
  });

  it('rejects invalid total counts instead of making an unbounded page loop', async () => {
    const rawList = vi.fn().mockResolvedValue({
      data: [{ id: 'r1' }],
      meta: { total_count: Number.NaN },
    });
    await expect(
      collectRecordIds(createClient({ rawList }), ['m1']),
    ).rejects.toThrow('Invalid record count');
    expect(rawList).toHaveBeenCalledTimes(1);
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
