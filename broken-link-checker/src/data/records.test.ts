import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import type { ContentModel } from '../types';
import { buildCmaClient, readRecords, toRecordInput } from './records';

function record(id: string) {
  return {
    id,
    type: 'item',
    attributes: { title: id },
    relationships: {
      item_type: { data: { id: 'article', type: 'item_type' } },
    },
  };
}

function mockClient(rawList = vi.fn()) {
  return { items: { rawList } } as unknown as Pick<Client, 'items'>;
}

async function collect(client: Pick<Client, 'items'>, signal?: AbortSignal) {
  const records = [];
  for await (const item of readRecords(client, 'article', signal))
    records.push(item);
  return records;
}

/** Zero-padded, so the IDs sort as the API orders them. */
function ids(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    String(from + i).padStart(5, '0'),
  );
}

/**
 * Serves `initial` in ID order like the CMA. `change` runs before each request
 * and may add or delete records, as editors do during a scan.
 */
function fakeCma(
  initial: string[],
  change?: (records: string[], request: number) => void,
) {
  const records = [...initial];
  const offsets: number[] = [];
  const rawList = vi.fn(
    async (query: { page: { offset: number; limit: number } }) => {
      change?.(records, offsets.length);
      records.sort();
      const { offset, limit } = query.page;
      offsets.push(offset);
      return {
        data: records.slice(offset, offset + limit).map(record),
        meta: { total_count: records.length },
      };
    },
  );
  return { client: mockClient(rawList), rawList, offsets, records };
}

function remove(records: string[], ...removed: string[]) {
  for (const id of removed) records.splice(records.indexOf(id), 1);
}

async function collectIds(client: Pick<Client, 'items'>) {
  return (await collect(client)).map((item) => item.id);
}

/** Every record there from start to end was read, and no record twice. */
function expectComplete(read: string[], kept: string[]) {
  expect(new Set(read).size).toBe(read.length);
  expect(kept.filter((id) => !read.includes(id))).toEqual([]);
}

describe('readRecords', () => {
  it('streams all 200,000 synthetic records without retaining a project fixture or payloads', async () => {
    const total = 200_000;
    let expected = 0;
    let requests = 0;
    const rawList = vi.fn(
      async (query: { page: { offset: number; limit: number } }) => {
        requests += 1;
        const { offset, limit } = query.page;
        expect(limit).toBe(30);
        return {
          data: Array.from(
            { length: Math.min(limit, total - offset) },
            (_, index) => record(String(offset + index)),
          ),
          meta: { total_count: total },
        };
      },
    );
    for await (const item of readRecords(mockClient(rawList), 'article')) {
      if (item.id !== String(expected))
        throw new Error(`Expected record ${expected}, received ${item.id}`);
      expected += 1;
    }
    expect(expected).toBe(total);
    expect(requests).toBe(Math.ceil((total - 1) / 29));
  });

  it('rejects a server that repeats the same page instead of silently skipping records', async () => {
    const rawList = vi.fn().mockResolvedValue({
      data: ids(0, 30).map(record),
      meta: { total_count: 200_000 },
    });
    await expect(collect(mockClient(rawList))).rejects.toThrow(
      'inconsistent record pagination',
    );
    expect(rawList).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate IDs inside a page', async () => {
    const rawList = vi.fn().mockResolvedValue({
      data: [record('a'), record('a')],
      meta: { total_count: 2 },
    });
    await expect(collect(mockClient(rawList))).rejects.toThrow(
      'inconsistent record pagination',
    );
  });
  it('loads overlapping bounded pages with nested current values, including invalid records', async () => {
    const { client, rawList } = fakeCma(ids(0, 32));
    expect(await collectIds(client)).toEqual(ids(0, 32));
    expect(rawList.mock.calls.map(([query]) => query)).toEqual(
      [0, 29].map((offset) => ({
        nested: true,
        version: 'current',
        filter: { type: 'article' },
        order_by: 'id_ASC',
        page: { offset, limit: 30 },
      })),
    );
  });

  it('reads a page that ends the collection exactly once', async () => {
    const { client, offsets } = fakeCma(ids(0, 30));
    expect(await collectIds(client)).toEqual(ids(0, 30));
    expect(offsets).toEqual([0]);
  });

  it('stops after an empty collection', async () => {
    const rawList = vi
      .fn()
      .mockResolvedValue({ data: [], meta: { total_count: 0 } });
    expect(await collect(mockClient(rawList))).toEqual([]);
    expect(rawList).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'a record deleted before the page',
      change: (records: string[]) => remove(records, '00003'),
      kept: ids(0, 100).filter((id) => id !== '00003'),
    },
    {
      name: 'a few records deleted before the page',
      change: (records: string[]) => remove(records, '00003', '00007', '00011'),
      kept: ids(0, 100).filter(
        (id) => !['00003', '00007', '00011'].includes(id),
      ),
    },
    {
      name: 'the record the next page starts with deleted',
      change: (records: string[]) => remove(records, '00029'),
      kept: ids(0, 100).filter((id) => id !== '00029'),
    },
    {
      name: 'more records deleted before the page than a page holds',
      change: (records: string[]) => remove(records, ...ids(5, 45)),
      kept: [...ids(0, 5), ...ids(50, 50)],
    },
    {
      name: 'every record already read deleted',
      change: (records: string[]) => remove(records, ...ids(0, 30)),
      kept: ids(30, 70),
    },
    {
      name: 'a record added before the page',
      change: (records: string[]) => records.push('00003a'),
      kept: ids(0, 100),
    },
    {
      name: 'more records added before the page than a page holds',
      change: (records: string[]) =>
        records.push(...ids(0, 40).map((id) => `00010-${id}`)),
      kept: ids(0, 100),
    },
    {
      name: 'records added and deleted before the page in equal numbers',
      change: (records: string[]) => {
        remove(records, '00002', '00004');
        records.push('00005a', '00006a');
      },
      kept: ids(0, 100).filter((id) => id !== '00002' && id !== '00004'),
    },
  ])('reads every remaining record after $name', async ({ change, kept }) => {
    const { client } = fakeCma(ids(0, 100), (records, request) => {
      if (request === 1) change(records);
    });
    expectComplete(await collectIds(client), kept);
  });

  it('steps back when deletions leave the next page past the end', async () => {
    const { client } = fakeCma(ids(0, 31), (records, request) => {
      if (request === 1) remove(records, '00002', '00005', '00008');
    });
    expectComplete(
      await collectIds(client),
      ids(0, 31).filter((id) => !['00002', '00005', '00008'].includes(id)),
    );
  });

  it('steps back over a large deletion of records already read', async () => {
    const { client } = fakeCma(ids(0, 600), (records, request) => {
      if (request === 12) remove(records, ...ids(0, 349));
    });
    expectComplete(await collectIds(client), ids(349, 251));
  });

  it('keeps up when a record already read is deleted before every page', async () => {
    const deleted: string[] = [];
    const { client, rawList } = fakeCma(ids(0, 1000), (records, request) => {
      if (request > 0) deleted.push(...records.splice(0, 1));
    });
    expectComplete(
      await collectIds(client),
      ids(0, 1000).filter((id) => !deleted.includes(id)),
    );
    // Twice the requests of an unchanged collection at most: no false warning.
    expect(rawList.mock.calls.length).toBeLessThan(2 * Math.ceil(1000 / 29));
  });

  it('reads records added past the page', async () => {
    const { client } = fakeCma(ids(0, 40), (records, request) => {
      if (request === 1) records.push('00039a', '99999');
    });
    expect(await collectIds(client)).toEqual([
      ...ids(0, 40),
      '00039a',
      '99999',
    ]);
  });

  it.each(
    Array.from({ length: 20 }, (_, i) => i + 1),
  )('reads every record that stays while records keep being added and deleted (seed %i)', async (seed) => {
    let state = seed;
    // Mulberry32: deterministic, so a failure can be replayed from its seed.
    const random = (below: number) => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * below);
    };
    const initial = ids(0, 600);
    const deleted = new Set<string>();
    let added = 0;
    const { client } = fakeCma(initial, (records) => {
      for (let n = random(6); n > 0 && records.length > 0; n -= 1) {
        const [id] = records.splice(random(records.length), 1);
        deleted.add(id);
      }
      for (let n = random(4); n > 0; n -= 1) {
        added += 1;
        records.push(`${String(random(600)).padStart(5, '0')}-new-${added}`);
      }
    });
    expectComplete(
      await collectIds(client),
      initial.filter((id) => !deleted.has(id)),
    );
  });

  it('reads to the end and then says records may be missing when they change too often to keep up with', async () => {
    let request = 0;
    // Every response holds records never seen before, so no page follows on.
    const rawList = vi.fn(
      async (query: { page: { offset: number; limit: number } }) => {
        request += 1;
        const { offset, limit } = query.page;
        return {
          data: ids(offset, Math.min(limit, 100 - offset)).map((id) =>
            record(`${request}-${id}`),
          ),
          meta: { total_count: 100 },
        };
      },
    );
    const read: string[] = [];
    await expect(async () => {
      for await (const item of readRecords(mockClient(rawList), 'article'))
        read.push(item.id);
    }).rejects.toThrow(/some may be missing/);
    expect(read.some((id) => id.endsWith('00099'))).toBe(true);
    expect(rawList.mock.calls.length).toBeLessThan(100);
  });

  it.each([
    { data: [], meta: { total_count: 2 } },
    { data: [record('b')], meta: { total_count: 3 } },
    {
      data: Array.from({ length: 31 }, (_, i) => record(String(i))),
      meta: { total_count: 40 },
    },
    { data: [{ ...record('c'), id: '' }], meta: { total_count: 3 } },
  ])('rejects an inconsistent page %# instead of reporting completion', async (second) => {
    const rawList = vi
      .fn()
      .mockResolvedValueOnce({
        data: [record('a'), record('b')],
        meta: { total_count: 3 },
      })
      .mockResolvedValueOnce(second);
    await expect(collect(mockClient(rawList))).rejects.toThrow(
      /scan again|pagination/i,
    );
    expect(rawList).toHaveBeenCalledTimes(2);
  });

  it('rejects missing pagination metadata', async () => {
    const rawList = vi.fn().mockResolvedValue({ data: [record('a')] });
    await expect(collect(mockClient(rawList))).rejects.toThrow(
      'incomplete record page',
    );
  });

  it('surfaces permission/API errors unchanged', async () => {
    const error = new Error('Permission denied');
    await expect(
      collect(mockClient(vi.fn().mockRejectedValue(error))),
    ).rejects.toBe(error);
  });

  it('does not request a page when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const rawList = vi.fn();
    await expect(
      collect(mockClient(rawList), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawList).not.toHaveBeenCalled();
  });

  it('cancels while a page is pending and observes a late failure', async () => {
    const controller = new AbortController();
    let rejectRequest: ((error: Error) => void) | undefined;
    const rawList = vi.fn().mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const result = collect(mockClient(rawList), controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    rejectRequest?.(new Error('Late network error'));
    await Promise.resolve();
    expect(rawList).toHaveBeenCalledTimes(1);
  });

  it('stops yielding records after cancellation', async () => {
    const controller = new AbortController();
    const rawList = vi.fn().mockResolvedValue({
      data: [record('a'), record('b')],
      meta: { total_count: 2 },
    });
    const iterator = readRecords(
      mockClient(rawList),
      'article',
      controller.signal,
    );
    expect((await iterator.next()).value?.id).toBe('a');
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawList).toHaveBeenCalledTimes(1);
  });
});

describe('record conversion', () => {
  const model: ContentModel = {
    id: 'article',
    name: 'Article',
    isBlock: false,
    titleFieldId: 'title-field',
    fields: [
      {
        id: 'title-field',
        apiKey: 'title',
        label: 'Title',
        type: 'string',
        localized: true,
        editor: 'single_line',
      },
    ],
  };

  it('preserves all locale and nested content while choosing the current locale title', () => {
    const attributes = {
      title: { en: 'Hello', it: 'Ciao' },
      content: [record('block')],
    };
    expect(toRecordInput({ id: 'a', attributes }, model, 'it')).toEqual({
      id: 'a',
      modelId: 'article',
      title: 'Ciao',
      values: attributes,
    });
    expect(toRecordInput({ attributes }, model, 'fr').title).toBe('Hello');
  });

  it('accepts unsaved SDK serialized values without id/meta', () => {
    expect(toRecordInput({ attributes: {} }, model)).toEqual({
      id: undefined,
      modelId: 'article',
      title: 'New Article',
      values: {},
    });
    expect(toRecordInput({ id: '123', attributes: {} }, model).title).toBe(
      'Article 123',
    );
  });

  it('does not confuse an unlocalized object value with locale data', () => {
    const unlocalized = {
      ...model,
      fields: model.fields.map((field) => ({ ...field, localized: false })),
    };
    expect(
      toRecordInput(
        { attributes: { title: { en: 'Not a title' } } },
        unlocalized,
      ).title,
    ).toBe('New Article');
  });
});

describe('buildCmaClient', () => {
  it('requires the current user token', () => {
    expect(() => buildCmaClient({ environment: 'sandbox' })).toThrow(
      'requires API access',
    );
  });

  it('uses the current user, environment and host-provided CMA endpoint', () => {
    const client = buildCmaClient({
      currentUserAccessToken: 'test-token',
      environment: 'sandbox',
      cmaBaseUrl: 'https://cma.example.test',
    });
    expect(client.config).toMatchObject({
      apiToken: 'test-token',
      environment: 'sandbox',
      baseUrl: 'https://cma.example.test',
    });
  });
});
