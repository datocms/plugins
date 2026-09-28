import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import {
  buildModelItemsQuery,
  type DiscoveryModel,
  FLAT_PAGE_SIZE,
  fetchBrowseRecordsPage,
  fetchModelRecords,
  fetchRecordsByIds,
  fetchRecordTotal,
  HYDRATION_PAGE_SIZE,
  type RecordQueryScope,
} from './query';
import { RequestPool } from './requestPool';

const model: DiscoveryModel = {
  id: 'model-1',
  apiKey: 'article',
  name: 'Article',
};

const scope: RecordQueryScope = {
  publicationStatuses: ['draft', 'published'],
  locales: ['en', 'it'],
};

function makeItem(id: string, modelId = model.id) {
  return {
    id,
    type: 'item',
    attributes: {},
    relationships: { item_type: { data: { id: modelId, type: 'item_type' } } },
    meta: {
      status: 'draft',
      current_version: `${id}-version`,
      created_at: '',
      updated_at: '',
      published_at: null,
      first_published_at: null,
      publication_scheduled_at: null,
      unpublishing_scheduled_at: null,
      is_valid: true,
      is_current_version_valid: true,
      is_published_version_valid: null,
      stage: null,
      has_children: null,
    },
  };
}

function pageOf(query: Record<string, unknown>): {
  offset: number;
  limit: number;
} {
  return query.page as { offset: number; limit: number };
}

describe('selection query planning', () => {
  it('uses valid status-in semantics and deterministic model ordering', () => {
    const query = buildModelItemsQuery({
      model,
      scope,
      offset: 30,
      limit: HYDRATION_PAGE_SIZE,
      nested: true,
    });

    expect(query).toMatchObject({
      nested: true,
      version: 'current',
      order_by: 'id_ASC',
      page: { offset: 30, limit: 30 },
      filter: {
        type: 'model-1',
        fields: { _status: { in: ['draft', 'published'] } },
      },
    });
    expect(query).not.toHaveProperty('locale');
  });

  it('hydrates authoritative candidates in 30-record ID batches', async () => {
    const ids = Array.from({ length: 35 }, (_, index) => `record-${index}`);
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const filter = query.filter as { ids: string };
      const pageIds = filter.ids.split(',');
      return {
        data: [...pageIds].reverse().map((id) => ({
          id,
          type: 'item',
          attributes: {},
          relationships: {
            item_type: { data: { id: model.id, type: 'item_type' } },
          },
          meta: {
            status: 'draft',
            current_version: `${id}-version`,
            created_at: '',
            updated_at: '',
            published_at: null,
            first_published_at: null,
            publication_scheduled_at: null,
            unpublishing_scheduled_at: null,
            is_valid: true,
            is_current_version_valid: true,
            is_published_version_valid: null,
            stage: null,
            has_children: null,
          },
        })),
        meta: { total_count: pageIds.length },
      };
    });
    const client = { items: { rawList } } as unknown as Client;

    const records = await fetchModelRecords(client, model, {
      ...scope,
      recordIds: ids,
    });

    expect(rawList).toHaveBeenCalledTimes(2);
    expect(
      rawList.mock.calls.map(
        ([query]) => (query.filter as { ids: string }).ids.split(',').length,
      ),
    ).toEqual([30, 5]);
    expect(records.map((record) => record.id)).toEqual(
      [...ids].sort((left, right) => left.localeCompare(right)),
    );
  });

  it('streams hydrated records without retaining the full model', async () => {
    const ids = Array.from({ length: 35 }, (_, index) => `record-${index}`);
    const delivered: string[] = [];
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const pageIds = (query.filter as { ids: string }).ids.split(',');
      return {
        data: pageIds.map((id) => ({
          id,
          type: 'item',
          attributes: {},
          relationships: {
            item_type: { data: { id: model.id, type: 'item_type' } },
          },
          meta: {
            status: 'draft',
            current_version: `${id}-version`,
            created_at: '',
            updated_at: '',
            published_at: null,
            first_published_at: null,
            publication_scheduled_at: null,
            unpublishing_scheduled_at: null,
            is_valid: true,
            is_current_version_valid: true,
            is_published_version_valid: null,
            stage: null,
            has_children: null,
          },
        })),
        meta: { total_count: pageIds.length },
      };
    });

    const records = await fetchModelRecords(
      { items: { rawList } } as unknown as Client,
      model,
      { ...scope, recordIds: ids },
      {
        collect: false,
        onRecord: (record) => {
          delivered.push(record.id);
        },
      },
    );

    expect(records).toEqual([]);
    expect(delivered).toHaveLength(35);
    expect(rawList).toHaveBeenCalledTimes(2);
  });

  it('unions Browse title matches across locales and ignores invalid ID fallback', async () => {
    const makeRecord = (id: string) => ({
      id,
      type: 'item',
      attributes: {},
      relationships: {
        item_type: { data: { id: model.id, type: 'item_type' } },
      },
      meta: {
        status: 'draft',
        current_version: `${id}-version`,
        created_at: '',
        updated_at: '',
        published_at: null,
        first_published_at: null,
        publication_scheduled_at: null,
        unpublishing_scheduled_at: null,
        is_valid: true,
        is_current_version_valid: true,
        is_published_version_valid: null,
        stage: null,
        has_children: null,
      },
    });
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const filter = query.filter as { ids?: string; query?: string };
      if (filter.ids === 'hello') {
        throw new Error('not a valid record ID');
      }
      if (filter.ids) {
        return {
          data: filter.ids.split(',').reverse().map(makeRecord),
          meta: { total_count: 2 },
        };
      }
      return {
        data: [makeRecord(query.locale === 'it' ? 'record-a' : 'record-z')],
        meta: { total_count: 1 },
      };
    });

    const result = await fetchBrowseRecordsPage({
      client: { items: { rawList } } as unknown as Client,
      model,
      scope: {
        ...scope,
        recordQuery: 'hello',
      },
      page: 1,
    });

    expect(result).toMatchObject({
      totalRecords: 2,
      totalPages: 1,
    });
    expect(result.records.map((record) => record.id)).toEqual([
      'record-a',
      'record-z',
    ]);
    expect(rawList).toHaveBeenCalledTimes(4);
  });

  it('sends no publication-status filter when no status is given', () => {
    const query = buildModelItemsQuery({
      model,
      scope: { publicationStatuses: [], locales: ['en', 'it'] },
      offset: 0,
      limit: HYDRATION_PAGE_SIZE,
      nested: true,
    });

    expect(query).toMatchObject({
      nested: true,
      version: 'current',
      filter: { type: 'model-1' },
    });
    expect(query.filter).not.toHaveProperty('fields');
  });

  it('requests later pages ahead, and hands them over in order however they arrive', async () => {
    const held = new Map<number, () => void>();
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const { offset } = query.page as { offset: number };
      if (offset > 0) {
        await new Promise<void>((resolve) => held.set(offset, resolve));
      }
      const size = Math.min(HYDRATION_PAGE_SIZE, 100 - offset);
      return {
        data: Array.from({ length: size }, (_, index) =>
          makeItem(`record-${offset + index}`),
        ),
        meta: { total_count: 100 },
      };
    });
    const pages: number[] = [];

    const done = fetchModelRecords(
      { items: { rawList } } as unknown as Client,
      model,
      { publicationStatuses: [], locales: ['en'] },
      {
        collect: false,
        onRecords: async (records) => {
          pages.push(Number(records[0]?.id.split('-')[1]));
        },
      },
    );
    await vi.waitFor(() => expect(held.size).toBe(3));
    // Every later page was asked for while the first one was handed over.
    expect(rawList.mock.calls.map(([query]) => pageOf(query).offset)).toEqual([
      0, 30, 60, 90,
    ]);
    held.get(90)?.();
    held.get(30)?.();
    await vi.waitFor(() => expect(pages).toEqual([0, 30]));
    held.get(60)?.();
    await done;

    expect(pages).toEqual([0, 30, 60, 90]);
    expect(rawList).toHaveBeenCalledTimes(4);
  });

  it('reads a model without block fields 500 records at a time, without nested', async () => {
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const { offset, limit } = query.page as { offset: number; limit: number };
      const size = Math.max(0, Math.min(limit, 1200 - offset));
      return {
        data: Array.from({ length: size }, (_, index) =>
          makeItem(`record-${offset + index}`),
        ),
        meta: { total_count: 1200 },
      };
    });

    const records = await fetchModelRecords(
      { items: { rawList } } as unknown as Client,
      { ...model, nested: false },
      { publicationStatuses: [], locales: ['en'] },
    );

    expect(records).toHaveLength(1200);
    expect(
      rawList.mock.calls.map(([query]) => [
        query.nested,
        pageOf(query).offset,
        pageOf(query).limit,
      ]),
    ).toEqual([
      [false, 0, FLAT_PAGE_SIZE],
      [false, 500, FLAT_PAGE_SIZE],
      [false, 1000, FLAT_PAGE_SIZE],
    ]);
  });

  it('starts at `startOffset`', async () => {
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const { offset } = query.page as { offset: number };
      const size = Math.max(0, Math.min(HYDRATION_PAGE_SIZE, 50 - offset));
      return {
        data: Array.from({ length: size }, (_, index) =>
          makeItem(`record-${offset + index}`),
        ),
        meta: { total_count: 50 },
      };
    });

    const records = await fetchModelRecords(
      { items: { rawList } } as unknown as Client,
      model,
      { publicationStatuses: [], locales: ['en'] },
      { startOffset: 35 },
    );

    expect(records.map((record) => record.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => `record-${35 + index}`),
    );
    expect(rawList.mock.calls.map(([query]) => pageOf(query).offset)).toEqual([
      35,
    ]);
  });

  it('goes on one page at a time from where a short page stopped, skipping nothing', async () => {
    // A server that answers at most 7 records per request.
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const { offset } = query.page as { offset: number };
      const size = Math.max(0, Math.min(7, 20 - offset));
      return {
        data: Array.from({ length: size }, (_, index) =>
          makeItem(`record-${offset + index}`),
        ),
        meta: { total_count: 20 },
      };
    });

    const records = await fetchModelRecords(
      { items: { rawList } } as unknown as Client,
      model,
      { publicationStatuses: [], locales: ['en'] },
    );

    expect(records.map((record) => record.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `record-${index}`),
    );
    expect(rawList.mock.calls.map(([query]) => pageOf(query).offset)).toEqual([
      0, 7, 14,
    ]);
  });

  it('keeps asking for pages while the total grows during the scan', async () => {
    // 10 records are created while the scan runs: later pages report 70.
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const { offset } = query.page as { offset: number };
      const total = offset === 0 ? 60 : 70;
      const size = Math.max(0, Math.min(HYDRATION_PAGE_SIZE, total - offset));
      return {
        data: Array.from({ length: size }, (_, index) =>
          makeItem(`record-${offset + index}`),
        ),
        meta: { total_count: total },
      };
    });

    const records = await fetchModelRecords(
      { items: { rawList } } as unknown as Client,
      model,
      { publicationStatuses: [], locales: ['en'] },
    );

    expect(records).toHaveLength(70);
    expect(rawList.mock.calls.map(([query]) => pageOf(query).offset)).toEqual([
      0, 30, 60,
    ]);
  });

  it('shares the pool: never more requests in flight than it allows', async () => {
    let inFlight = 0;
    let most = 0;
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      const { offset } = query.page as { offset: number };
      const size = Math.max(0, Math.min(HYDRATION_PAGE_SIZE, 300 - offset));
      return {
        data: Array.from({ length: size }, (_, index) =>
          makeItem(`record-${offset + index}`),
        ),
        meta: { total_count: 300 },
      };
    });
    const pool = new RequestPool({
      concurrency: 2,
      perWindow: 1000,
      windowMs: 1000,
      timers: {
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        clearTimeout: (handle) =>
          clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    });

    const records = await fetchModelRecords(
      { items: { rawList } } as unknown as Client,
      model,
      { publicationStatuses: [], locales: ['en'] },
      { pool },
    );

    expect(records).toHaveLength(300);
    expect(most).toBe(2);
  });

  it('re-reads with their blocks the records of a flat model that still hold block ids', async () => {
    const withBlock = {
      ...makeItem('record-1'),
      attributes: {
        body: {
          schema: 'dast',
          document: {
            type: 'root',
            children: [{ type: 'block', item: 'block-1' }],
          },
        },
      },
    };
    const nestedCopy = {
      ...withBlock,
      attributes: {
        body: {
          schema: 'dast',
          document: {
            type: 'root',
            children: [
              {
                type: 'block',
                item: { ...makeItem('block-1'), attributes: { text: 'Hi' } },
              },
            ],
          },
        },
      },
    };
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      if ((query.filter as { ids?: string }).ids) {
        expect(query).toMatchObject({ nested: true });
        return { data: [nestedCopy], meta: { total_count: 1 } };
      }
      return {
        data: [makeItem('record-0'), withBlock],
        meta: { total_count: 2 },
      };
    });

    const records = await fetchModelRecords(
      { items: { rawList } } as unknown as Client,
      { ...model, nested: false },
      { publicationStatuses: [], locales: ['en'] },
    );

    expect(records.map((record) => record.id)).toEqual([
      'record-0',
      'record-1',
    ]);
    expect(records[1]).toBe(nestedCopy);
    expect(rawList).toHaveBeenCalledTimes(2);
  });

  it('counts the records of several models in one request per 50 models', async () => {
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const types = (query.filter as { type: string }).type.split(',');
      return { data: [], meta: { total_count: types.length * 100 } };
    });
    const ids = Array.from({ length: 60 }, (_, index) => `model-${index}`);

    const total = await fetchRecordTotal(
      { items: { rawList } } as unknown as Client,
      ids,
    );

    expect(total).toBe(6000);
    expect(rawList).toHaveBeenCalledTimes(2);
    expect(rawList.mock.calls[0]?.[0]).toMatchObject({
      page: { offset: 0, limit: 1 },
    });
  });

  it('re-reads records by ID, nested and current, skipping missing ones', async () => {
    const ids = Array.from({ length: 32 }, (_, index) => `record-${index}`);
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const requested = (query.filter as { ids: string }).ids.split(',');
      return {
        data: requested
          .filter((id) => id !== 'record-3')
          .map((id) =>
            makeItem(id, id === 'record-4' ? 'other-model' : model.id),
          )
          .reverse(),
        meta: { total_count: requested.length },
      };
    });

    const records = await fetchRecordsByIds(
      { items: { rawList } } as unknown as Client,
      model,
      [...ids, 'record-0'],
    );

    expect(records.map((record) => record.id)).toEqual(
      ids.filter((id) => id !== 'record-3' && id !== 'record-4'),
    );
    expect(rawList).toHaveBeenCalledTimes(2);
    for (const [query] of rawList.mock.calls) {
      expect(query).toMatchObject({ nested: true, version: 'current' });
      expect(query.filter).not.toHaveProperty('fields');
      expect(query).not.toHaveProperty('order_by');
    }
  });

  it('re-reads nothing without IDs', async () => {
    const rawList = vi.fn();
    await expect(
      fetchRecordsByIds({ items: { rawList } } as unknown as Client, model, []),
    ).resolves.toEqual([]);
    expect(rawList).not.toHaveBeenCalled();
  });
});
