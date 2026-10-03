import { describe, expect, it, vi } from 'vitest';
import {
  type CleanupClient,
  type CleanupProgress,
  collectAssets,
  deleteCollectedAssets,
  waitForRecordDeletion,
} from './assetCleanup';
import type { UploadFieldDescriptor } from './collectUploadIds';

type ListQuery = {
  filter: { ids: string };
  nested?: boolean;
  version?: string;
  page: { limit: number; offset?: number };
};
type Row = Record<string, unknown> & { id: string };
type Page = { data: Row[]; meta: { total_count: number } };
type DestroyRequest = {
  data: { relationships: { uploads: { data: { id: string }[] } } };
};
type Receipt = { meta: { successful: number; failed: number } };
type Ports = {
  records?: (query: ListQuery) => Promise<Page>;
  fields?: (modelId: string) => Promise<readonly UploadFieldDescriptor[]>;
  uploads?: (query: ListQuery) => Promise<Page>;
  destroy?: (request: DestroyRequest) => Promise<Receipt>;
};

const fields: UploadFieldDescriptor[] = [
  { api_key: 'image', field_type: 'file', localized: false },
  { api_key: 'seo', field_type: 'seo', localized: false },
];

function page(data: Row[], total = data.length): Page {
  return { data, meta: { total_count: total } };
}

function item(id: string, attributes: Record<string, unknown>): Row {
  return {
    id,
    type: 'item',
    attributes,
    relationships: { item_type: { data: { type: 'item_type', id: 'model' } } },
  };
}

function makeClient(ports: Ports = {}): CleanupClient {
  return {
    items: { rawList: ports.records ?? (async () => page([])) },
    fields: { list: ports.fields ?? (async () => fields) },
    uploads: {
      rawList: ports.uploads ?? (async () => page([])),
      rawBulkDestroy:
        ports.destroy ?? (async () => ({ meta: { successful: 0, failed: 0 } })),
    },
  } as unknown as CleanupClient;
}

function uploadServer(
  ids: readonly string[],
  protectedIds: readonly string[] = [],
) {
  const existing = new Set(ids);
  const protectedAssets = new Set(protectedIds);
  const mutationSizes: number[] = [];
  let reads = 0;
  const uploads = async (query: ListQuery): Promise<Page> => {
    reads += 1;
    const requested = query.filter.ids.split(',');
    return page(
      requested.filter((id) => existing.has(id)).map((id) => ({ id })),
    );
  };
  const destroy = async (request: DestroyRequest): Promise<Receipt> => {
    const requested = request.data.relationships.uploads.data;
    mutationSizes.push(requested.length);
    let successful = 0;
    for (const upload of requested) {
      if (!protectedAssets.has(upload.id) && existing.delete(upload.id)) {
        successful += 1;
      }
    }
    return { meta: { successful, failed: requested.length - successful } };
  };
  return {
    existing,
    uploads,
    destroy,
    mutationSizes,
    get reads() {
      return reads;
    },
  };
}

describe('collectAssets', () => {
  it('streams 200,000 logical records in both versions with bounded reads and 10,000 unique assets', async () => {
    const recordIds = Array.from(
      { length: 200_000 },
      (_, index) => `record-${index}`,
    );
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    let maxBatch = 0;
    let maxPage = 0;
    let invalidOptions = false;
    const totals: Record<string, number> = { current: 0, published: 0 };
    const lastProgress: CleanupProgress[] = [];
    const loadFields = vi.fn(async () => fields);
    const client = makeClient({
      fields: loadFields,
      records: async (query) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls += 1;
        const ids = query.filter.ids.split(',');
        maxBatch = Math.max(maxBatch, ids.length);
        maxPage = Math.max(maxPage, query.page.limit);
        invalidOptions ||= query.nested !== true || !query.version;
        await Promise.resolve();
        active -= 1;
        const selected = ids.slice(
          query.page.offset ?? 0,
          (query.page.offset ?? 0) + query.page.limit,
        );
        totals[query.version ?? ''] += selected.length;
        return page(
          selected.map((id) => {
            const index = Number(id.slice('record-'.length));
            return item(id, {
              image: { upload_id: `asset-${index % 10_000}` },
              seo: { image: `asset-${(index + 5_000) % 10_000}` },
            });
          }),
          ids.length,
        );
      },
    });

    const result = await collectAssets(client, recordIds, {
      onProgress: (progress) => {
        lastProgress[0] = progress;
      },
    });

    expect(result).toHaveLength(10_000);
    expect(new Set(result)).toEqual(
      new Set(Array.from({ length: 10_000 }, (_, index) => `asset-${index}`)),
    );
    expect(totals).toEqual({ current: 200_000, published: 200_000 });
    expect(calls).toBe(16_000);
    expect(maxBatch).toBe(100);
    expect(maxPage).toBe(30);
    expect(maxActive).toBe(4);
    expect(invalidOptions).toBe(false);
    expect(loadFields).toHaveBeenCalledTimes(1);
    expect(lastProgress[0]).toEqual({
      phase: 'collecting',
      completed: 200_000,
      total: 200_000,
      assets: 10_000,
    });
  }, 20_000);

  it('includes old published assets and completes a partially published final page', async () => {
    const ids = Array.from({ length: 65 }, (_, index) => `record-${index}`);
    const calls: ListQuery[] = [];
    const client = makeClient({
      records: async (query) => {
        calls.push(query);
        const selected = query.version === 'published' ? ids.slice(0, 44) : ids;
        return page(
          selected
            .slice(
              query.page.offset ?? 0,
              (query.page.offset ?? 0) + query.page.limit,
            )
            .map((id) =>
              item(id, {
                image: {
                  upload_id: query.version === 'published' ? 'old' : 'new',
                },
                seo: { image: 'seo' },
              }),
            ),
          selected.length,
        );
      },
    });

    expect(new Set(await collectAssets(client, ids))).toEqual(
      new Set(['new', 'old', 'seo']),
    );
    expect(
      calls
        .filter((query) => query.version === 'current')
        .map((query) => query.page.offset),
    ).toEqual([0, 30, 60]);
    expect(
      calls
        .filter((query) => query.version === 'published')
        .map((query) => query.page.offset),
    ).toEqual([0, 30]);
  });

  it('fails closed when a selected current record is unreadable', async () => {
    const client = makeClient({
      records: async () => page([item('a', {})], 1),
    });
    await expect(collectAssets(client, ['a', 'b'])).rejects.toThrow(
      'could not be read',
    );
  });

  it('rejects incomplete published pagination', async () => {
    const client = makeClient({
      records: async (query) =>
        query.version === 'current' ? page([item('a', {})]) : page([], 1),
    });
    await expect(collectAssets(client, ['a'])).rejects.toThrow(
      'incomplete record page',
    );
  });

  it('rejects a count change between record pages', async () => {
    const ids = Array.from({ length: 31 }, (_, index) => `record-${index}`);
    const client = makeClient({
      records: async (query) =>
        page(
          ids
            .slice(query.page.offset ?? 0, (query.page.offset ?? 0) + 30)
            .map((id) => item(id, {})),
          query.page.offset === 0 ? 31 : 30,
        ),
    });
    await expect(collectAssets(client, ids)).rejects.toThrow(
      'changed while collecting',
    );
  });

  it('rejects a published page containing more records than its total_count', async () => {
    const rows = ['a', 'b'].map((id) => item(id, {}));
    const client = makeClient({
      records: async (query) =>
        page(rows, query.version === 'published' ? 1 : 2),
    });
    await expect(collectAssets(client, ['a', 'b'])).rejects.toThrow();
  });

  it.each([
    ['unexpected IDs', ['a', 'unexpected']],
    ['duplicate IDs', ['a', 'a']],
  ])('rejects record pages containing %s even if total_count matches', async (_label, returned) => {
    const client = makeClient({
      records: async () => page(returned.map((id) => item(id, {}))),
    });
    await expect(collectAssets(client, ['a', 'b'])).rejects.toThrow();
  });

  it('does not make requests for an empty selection or a cancelled scan', async () => {
    const records = vi.fn(async () => page([]));
    const controller = new AbortController();
    controller.abort();
    const client = makeClient({ records });
    expect(await collectAssets(client, [])).toEqual([]);
    await expect(
      collectAssets(client, ['a'], { signal: controller.signal }),
    ).rejects.toThrow();
    expect(records).not.toHaveBeenCalled();
  });
});

describe('cancellation of the last submitted asset batch', () => {
  it('reconciles accepted deletions and reports cancellation with no next batch', async () => {
    const controller = new AbortController();
    const server = uploadServer(['one', 'two']);
    const client = makeClient({
      uploads: server.uploads,
      destroy: async (request) => {
        const receipt = await server.destroy(request);
        controller.abort();
        return receipt;
      },
    });
    const result = await deleteCollectedAssets(client, ['one', 'two'], {
      signal: controller.signal,
    });
    expect(result).toEqual({
      deleted: 2,
      kept: 0,
      unavailable: 0,
      unconfirmed: 0,
      cancelled: true,
    });
    expect(server.mutationSizes).toEqual([2]);
  });
});

describe('progress within a record with many assets', () => {
  it('reports massive asset volume before finishing the whole record', async () => {
    const updates: CleanupProgress[] = [];
    const gallery = Array.from({ length: 1_000 }, (_, index) => ({
      upload_id: `asset-${index}`,
    }));
    const client = makeClient({
      fields: async () => [
        { api_key: 'gallery', field_type: 'gallery', localized: false },
      ],
      records: async () => page([item('record', { gallery })]),
    });
    const result = await collectAssets(client, ['record'], {
      onProgress: (progress) => updates.push(progress),
    });
    expect(result).toHaveLength(1_000);
    expect(updates).toContainEqual({
      phase: 'collecting',
      completed: 0,
      total: 1,
      assets: 500,
    });
    expect(updates[updates.length - 1]).toEqual({
      phase: 'collecting',
      completed: 1,
      total: 1,
      assets: 1_000,
    });
  });
});

describe('waitForRecordDeletion', () => {
  it('polls counts only and stops polling groups already deleted', async () => {
    const ids = Array.from({ length: 207 }, (_, index) => `record-${index}`);
    const polls = new Map<string, number>();
    const limits: number[] = [];
    const progress: number[] = [];
    let clock = 0;
    const client = makeClient({
      records: async (query) => {
        limits.push(query.page.limit);
        const group = query.filter.ids.split(',')[0];
        const poll = polls.get(group) ?? 0;
        polls.set(group, poll + 1);
        const remaining =
          group === 'record-0'
            ? [100, 50, 0]
            : group === 'record-100'
              ? [100, 0]
              : [7, 7, 0];
        return page([], remaining[poll] ?? 0);
      },
    });
    await waitForRecordDeletion(client, ids, {
      now: () => clock,
      wait: async (milliseconds) => {
        clock += milliseconds;
      },
      onProgress: (value) => {
        progress.push(value.completed);
      },
    });
    expect([...polls.values()]).toEqual([3, 2, 3]);
    expect(limits).toEqual(Array(8).fill(0));
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(207);
    expect(progress).toContain(150);
    expect(progress).toEqual([...progress].sort((left, right) => left - right));
  });

  it('continues waiting when deletion takes more than five seconds', async () => {
    let clock = 0;
    const delays: number[] = [];
    const client = makeClient({
      records: async () => page([], clock < 7_000 ? 1 : 0),
    });
    await waitForRecordDeletion(client, ['a'], {
      now: () => clock,
      wait: async (milliseconds) => {
        delays.push(milliseconds);
        clock += milliseconds;
      },
    });
    expect(clock).toBe(7_000);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
  });

  it('caps automatic polling backoff at fifteen seconds', async () => {
    let clock = 0;
    const delays: number[] = [];
    const client = makeClient({
      records: async () => page([], clock < 60_000 ? 1 : 0),
    });
    await waitForRecordDeletion(client, ['a'], {
      now: () => clock,
      wait: async (milliseconds) => {
        delays.push(milliseconds);
        clock += milliseconds;
      },
    });
    expect(delays).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000,
    ]);
  });

  it('stops on permission errors instead of interpreting them as deleted records', async () => {
    const wait = vi.fn(async () => undefined);
    const client = makeClient({
      records: async () => {
        throw new Error('403 forbidden');
      },
    });
    await expect(
      waitForRecordDeletion(client, ['a'], { wait }),
    ).rejects.toThrow('403');
    expect(wait).not.toHaveBeenCalled();
  });

  it('measures inactivity since the last progress, using injected time', async () => {
    let clock = 0;
    const counts = [3, 2, 1, 1];
    let calls = 0;
    const client = makeClient({
      records: async () => page([], counts[calls++] ?? 1),
    });
    await expect(
      waitForRecordDeletion(client, ['a', 'b', 'c'], {
        now: () => clock,
        wait: async (milliseconds) => {
          clock += milliseconds;
        },
        deletionTimeout: 4_000,
      }),
    ).rejects.toThrow('stopped making progress');
    expect(clock).toBe(7_000);
    expect(calls).toBe(4);
  });

  it.each([
    -1,
    Number.NaN,
    2,
  ])('rejects invalid remaining counts (%s)', async (count) => {
    const client = makeClient({ records: async () => page([], count) });
    await expect(waitForRecordDeletion(client, ['a'])).rejects.toThrow();
  });

  it('cancels polling safely during the automatic wait', async () => {
    const controller = new AbortController();
    const records = vi.fn(async () => page([], 1));
    await expect(
      waitForRecordDeletion(makeClient({ records }), ['a'], {
        signal: controller.signal,
        wait: async () => {
          controller.abort();
        },
      }),
    ).rejects.toThrow();
    expect(records).toHaveBeenCalledTimes(1);
  });
});

describe('deleteCollectedAssets', () => {
  it('deletes 10,000 candidates in sequential batches of at most 100 while preserving shared assets', async () => {
    const ids = Array.from({ length: 10_000 }, (_, index) => `asset-${index}`);
    const protectedIds = ids.filter((_id, index) => index % 100 === 0);
    const server = uploadServer(ids, protectedIds);
    const result = await deleteCollectedAssets(makeClient(server), [
      ...ids,
      ...ids.slice(0, 500),
    ]);
    expect(result).toEqual({
      deleted: 9_900,
      kept: 100,
      unavailable: 0,
      unconfirmed: 0,
      cancelled: false,
    });
    expect(server.mutationSizes).toEqual(Array(100).fill(100));
    expect(server.reads).toBe(200);
    expect(server.existing).toEqual(new Set(protectedIds));
  });

  it('deduplicates candidates and reports missing uploads separately from shared assets', async () => {
    const server = uploadServer(['a', 'shared'], ['shared']);
    expect(
      await deleteCollectedAssets(makeClient(server), [
        'a',
        'a',
        'shared',
        'missing',
      ]),
    ).toEqual({
      deleted: 1,
      kept: 1,
      unavailable: 1,
      unconfirmed: 0,
      cancelled: false,
    });
    expect(server.mutationSizes).toEqual([2]);
  });

  it('requires both raw bulk metadata and readback disappearance to confirm deletion', async () => {
    const server = uploadServer(['a', 'b']);
    const client = makeClient({
      uploads: server.uploads,
      destroy: async (request) => {
        await server.destroy(request);
        return { meta: { successful: 1, failed: 1 } };
      },
    });
    expect(await deleteCollectedAssets(client, ['a', 'b'])).toEqual({
      deleted: 1,
      kept: 0,
      unavailable: 0,
      unconfirmed: 1,
      cancelled: false,
    });
  });

  it('does not claim bulk successes when readback still contains a referenced asset', async () => {
    const server = uploadServer(['a', 'shared'], ['shared']);
    const client = makeClient({
      uploads: server.uploads,
      destroy: async (request) => {
        await server.destroy(request);
        return { meta: { successful: 2, failed: 0 } };
      },
    });
    expect(await deleteCollectedAssets(client, ['a', 'shared'])).toEqual({
      deleted: 1,
      kept: 1,
      unavailable: 0,
      unconfirmed: 0,
      cancelled: false,
    });
  });

  it.each([
    -1,
    Number.NaN,
    3,
  ])('does not trust invalid bulk success counts (%s)', async (successful) => {
    const server = uploadServer(['a', 'b']);
    const client = makeClient({
      uploads: server.uploads,
      destroy: async () => ({ meta: { successful, failed: 0 } }),
    });
    expect(await deleteCollectedAssets(client, ['a', 'b'])).toEqual({
      deleted: 0,
      kept: 0,
      unavailable: 0,
      unconfirmed: 2,
      cancelled: false,
    });
    expect(server.reads).toBe(1);
  });

  it('does not retry an ambiguous mutation that may already have deleted assets', async () => {
    const server = uploadServer(['a']);
    const destroy = vi.fn(async (request: DestroyRequest) => {
      await server.destroy(request);
      throw new Error('network lost after job submission');
    });
    expect(
      await deleteCollectedAssets(
        makeClient({ uploads: server.uploads, destroy }),
        ['a'],
      ),
    ).toEqual({
      deleted: 0,
      kept: 0,
      unavailable: 0,
      unconfirmed: 1,
      cancelled: false,
    });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(server.reads).toBe(1);
    expect(server.existing.size).toBe(0);
  });

  it.each([
    'before',
    'after',
  ])('marks failures %s mutation as unconfirmed', async (phase) => {
    const server = uploadServer(['a', 'b']);
    let calls = 0;
    const uploads = async (query: ListQuery) => {
      calls += 1;
      if (calls === (phase === 'before' ? 1 : 2))
        throw new Error('read failed');
      return server.uploads(query);
    };
    const destroy = vi.fn(server.destroy);
    expect(
      await deleteCollectedAssets(makeClient({ uploads, destroy }), ['a', 'b']),
    ).toEqual({
      deleted: 0,
      kept: 0,
      unavailable: 0,
      unconfirmed: 2,
      cancelled: false,
    });
    expect(destroy).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
  });

  it('does not count missing uploads twice when the remaining mutation fails', async () => {
    const server = uploadServer(['a']);
    const client = makeClient({
      uploads: server.uploads,
      destroy: async () => {
        throw new Error('failed');
      },
    });
    expect(await deleteCollectedAssets(client, ['a', 'missing'])).toEqual({
      deleted: 0,
      kept: 0,
      unavailable: 1,
      unconfirmed: 1,
      cancelled: false,
    });
  });

  it.each([
    ['incomplete', page([{ id: 'a' }], 2)],
    ['unexpected', page([{ id: 'unexpected' }])],
    ['duplicate', page([{ id: 'a' }, { id: 'a' }])],
  ])('rejects %s upload pages before submitting a mutation', async (_label, response) => {
    const destroy = vi.fn(async () => ({ meta: { successful: 2, failed: 0 } }));
    const result = await deleteCollectedAssets(
      makeClient({
        uploads: async () => response,
        destroy,
      }),
      ['a', 'b'],
    );
    expect(result.unconfirmed).toBe(2);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('cancels before the first batch without any request', async () => {
    const controller = new AbortController();
    controller.abort();
    const server = uploadServer(['a', 'b']);
    expect(
      await deleteCollectedAssets(makeClient(server), ['a', 'a', 'b'], {
        signal: controller.signal,
      }),
    ).toEqual({
      deleted: 0,
      kept: 0,
      unavailable: 0,
      unconfirmed: 2,
      cancelled: true,
    });
    expect(server.reads).toBe(0);
    expect(server.mutationSizes).toEqual([]);
  });

  it('reports cancellation during the final pre-deletion read and does not mutate', async () => {
    const controller = new AbortController();
    const server = uploadServer(['a']);
    const client = makeClient({
      uploads: async (query) => {
        const response = await server.uploads(query);
        controller.abort();
        return response;
      },
      destroy: server.destroy,
    });
    expect(
      await deleteCollectedAssets(client, ['a'], { signal: controller.signal }),
    ).toEqual({
      deleted: 0,
      kept: 0,
      unavailable: 0,
      unconfirmed: 1,
      cancelled: true,
    });
    expect(server.mutationSizes).toEqual([]);
  });

  it.each([
    'during mutation',
    'after batch',
  ])('reconciles the completed batch when cancellation occurs %s', async (phase) => {
    const controller = new AbortController();
    const ids = Array.from({ length: 101 }, (_, index) => `asset-${index}`);
    const server = uploadServer(ids);
    const client = makeClient({
      uploads: server.uploads,
      destroy: async (request) => {
        const result = await server.destroy(request);
        if (phase === 'during mutation') controller.abort();
        return result;
      },
    });
    const result = await deleteCollectedAssets(client, ids, {
      signal: controller.signal,
      onProgress: () => {
        if (phase === 'after batch') controller.abort();
      },
    });
    expect(result).toEqual({
      deleted: 100,
      kept: 0,
      unavailable: 0,
      unconfirmed: 1,
      cancelled: true,
    });
    expect(server.mutationSizes).toEqual([100]);
    expect(server.reads).toBe(2);
  });
});
