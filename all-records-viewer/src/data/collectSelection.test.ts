import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUERY_STATE } from '../state/queryState';
import type { RawItem } from '../types';
import { collectSelection } from './collectSelection';

type PageQuery = {
  page: { offset: number; limit: number };
  filter?: { type?: string; query?: string };
};

function item(index: number, modelId = `model-${index % 31}`): RawItem {
  return {
    id: `record-${index}`,
    type: 'item',
    attributes: { title: { en: 'Localized content', pt: 'Conteúdo' } },
    relationships: {
      item_type: { data: { id: modelId, type: 'item_type' } },
      creator: { data: { id: 'creator-1', type: 'user' } },
    },
    meta: { stage: 'review', status: 'draft', current_version: 'version-1' },
  } as unknown as RawItem;
}

function clientWith(rawList: unknown): Pick<Client, 'items'> {
  return { items: { rawList } } as unknown as Pick<Client, 'items'>;
}

function page(offset: number, count: number, total: number, modelId?: string) {
  return {
    data: Array.from({ length: count }, (_, index) =>
      item(offset + index, modelId),
    ),
    meta: { total_count: total },
  };
}

describe('collectSelection', () => {
  it('collects every matching record using bounded, stable pages and the current filter', async () => {
    const progress = vi.fn();
    const rawList = vi.fn(async ({ page: { offset, limit } }: PageQuery) =>
      page(offset, Math.min(limit, 450 - offset), 450, 'filtered-model'),
    );

    const selected = await collectSelection(
      clientWith(rawList),
      {
        ...DEFAULT_QUERY_STATE,
        page: 9,
        perPage: 25,
        query: '  matching words  ',
        model: 'filtered-model',
        status: 'draft',
        orderBy: '_created_at_DESC',
      },
      { onProgress: progress },
    );

    expect(selected.size).toBe(450);
    expect(rawList.mock.calls.map(([query]) => query.page.offset)).toEqual([
      0, 200, 400,
    ]);
    expect(rawList).toHaveBeenCalledWith({
      nested: false,
      version: 'current',
      order_by: 'id_ASC',
      page: { offset: 0, limit: 200 },
      filter: {
        type: 'filtered-model',
        query: 'matching words',
        fields: { _created_at: { exists: true }, _status: { eq: 'draft' } },
      },
    });
    expect(progress.mock.calls).toEqual([
      [200, 450],
      [400, 450],
      [450, 450],
    ]);
    expect(selected.get('record-449')).toMatchObject({
      attributes: {},
      meta: { stage: 'review', current_version: 'version-1' },
      relationships: { creator: { data: { id: 'creator-1' } } },
    });
  });

  it('partitions all-model text search by unique model IDs with stable ordering and global progress', async () => {
    const onProgress = vi.fn();
    const totals: Record<string, number> = { alpha: 250, beta: 175, gamma: 0 };
    const starts: Record<string, number> = { alpha: 0, beta: 250, gamma: 425 };
    const rawList = vi.fn(
      async ({ filter, page: { offset, limit } }: PageQuery) => {
        if (!filter?.type) return page(0, 0, 425);
        const total = totals[filter.type];
        return page(
          starts[filter.type] + offset,
          Math.min(limit, total - offset),
          total,
          filter.type,
        );
      },
    );

    const selected = await collectSelection(
      clientWith(rawList),
      {
        ...DEFAULT_QUERY_STATE,
        query: ' matching words ',
        status: 'updated',
      },
      { modelIds: ['alpha', 'beta', 'alpha', 'gamma'], onProgress },
    );

    expect(selected.size).toBe(425);
    expect(
      rawList.mock.calls.map(([query]) => ({
        type: query.filter?.type,
        page: query.page,
      })),
    ).toEqual([
      { type: undefined, page: { offset: 0, limit: 0 } },
      { type: 'alpha', page: { offset: 0, limit: 200 } },
      { type: 'alpha', page: { offset: 200, limit: 200 } },
      { type: 'beta', page: { offset: 0, limit: 200 } },
      { type: 'gamma', page: { offset: 0, limit: 200 } },
    ]);
    expect(rawList.mock.calls[0]?.[0]).not.toHaveProperty('order_by');
    for (const [request] of rawList.mock.calls.slice(1)) {
      expect(request).toMatchObject({
        nested: false,
        version: 'current',
        order_by: 'id_ASC',
        filter: {
          query: 'matching words',
          fields: { _created_at: { exists: true }, _status: { eq: 'updated' } },
        },
      });
    }
    expect(onProgress.mock.calls).toEqual([
      [0, 425],
      [200, 425],
      [250, 425],
      [425, 425],
      [425, 425],
    ]);
    expect(selected.get('record-424')?.relationships.item_type.data.id).toBe(
      'beta',
    );
  });

  it('collects short model pages completely during all-model text search', async () => {
    const rawList = vi.fn(async ({ filter, page: { offset } }: PageQuery) => {
      if (!filter?.type) return page(0, 0, 5);
      const total = filter.type === 'alpha' ? 3 : 2;
      const start = filter.type === 'alpha' ? 0 : 3;
      return page(
        start + offset,
        Math.min(1, total - offset),
        total,
        filter.type,
      );
    });
    const selected = await collectSelection(
      clientWith(rawList),
      {
        ...DEFAULT_QUERY_STATE,
        query: 'text',
      },
      { modelIds: ['alpha', 'beta'] },
    );
    expect(selected.size).toBe(5);
    expect(rawList.mock.calls.map(([query]) => query.page.offset)).toEqual([
      0, 0, 1, 2, 0, 1,
    ]);
  });

  it('requires model IDs for all-model text search before issuing a request', async () => {
    const rawList = vi.fn();
    await expect(
      collectSelection(clientWith(rawList), {
        ...DEFAULT_QUERY_STATE,
        query: 'text',
      }),
    ).rejects.toThrow('Models are required');
    expect(rawList).not.toHaveBeenCalled();
  });

  it('rejects a combined model total that differs from the initial global search count', async () => {
    const rawList = vi
      .fn()
      .mockResolvedValueOnce(page(0, 0, 3))
      .mockResolvedValueOnce(page(0, 2, 2, 'alpha'));
    await expect(
      collectSelection(
        clientWith(rawList),
        { ...DEFAULT_QUERY_STATE, query: 'text' },
        {
          modelIds: ['alpha'],
        },
      ),
    ).rejects.toThrow('Records changed');
  });

  it('rejects a growing combined model selection before reporting progress beyond the global total', async () => {
    const onProgress = vi.fn();
    const rawList = vi
      .fn()
      .mockResolvedValueOnce(page(0, 0, 1))
      .mockResolvedValueOnce(page(0, 2, 2, 'alpha'));
    await expect(
      collectSelection(
        clientWith(rawList),
        { ...DEFAULT_QUERY_STATE, query: 'text' },
        {
          modelIds: ['alpha'],
          onProgress,
        },
      ),
    ).rejects.toThrow('Records changed');
    expect(onProgress.mock.calls).toEqual([[0, 1]]);
  });

  it('rejects changing per-model totals during all-model text search', async () => {
    const rawList = vi
      .fn()
      .mockResolvedValueOnce(page(0, 0, 402))
      .mockResolvedValueOnce(page(0, 200, 201, 'alpha'))
      .mockResolvedValueOnce(page(200, 2, 202, 'alpha'));
    await expect(
      collectSelection(
        clientWith(rawList),
        { ...DEFAULT_QUERY_STATE, query: 'text' },
        {
          modelIds: ['alpha', 'beta'],
        },
      ),
    ).rejects.toThrow('Records changed');
    expect(rawList).toHaveBeenCalledTimes(3);
  });

  it('rejects records outside a requested model', async () => {
    const rawList = vi
      .fn()
      .mockResolvedValue(page(0, 1, 1, 'unexpected-model'));
    await expect(
      collectSelection(clientWith(rawList), {
        ...DEFAULT_QUERY_STATE,
        model: 'requested-model',
      }),
    ).rejects.toThrow('Records changed');
  });

  it('finishes a confirmed empty all-model search without fetching model pages', async () => {
    const rawList = vi.fn().mockResolvedValue(page(0, 0, 0));
    const selected = await collectSelection(
      clientWith(rawList),
      { ...DEFAULT_QUERY_STATE, query: 'text' },
      {
        modelIds: ['alpha', 'beta'],
      },
    );
    expect(selected.size).toBe(0);
    expect(rawList).toHaveBeenCalledTimes(1);
  });

  it('cancels all-model search before fetching its first model page', async () => {
    const controller = new AbortController();
    const rawList = vi.fn().mockResolvedValue(page(0, 0, 5));
    await expect(
      collectSelection(
        clientWith(rawList),
        { ...DEFAULT_QUERY_STATE, query: 'text' },
        {
          modelIds: ['alpha', 'beta'],
          signal: controller.signal,
          onProgress: () => controller.abort(),
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawList).toHaveBeenCalledTimes(1);
  });

  it('advances by the actual length of short pages until the declared total', async () => {
    const rawList = vi.fn(async ({ page: { offset } }: PageQuery) =>
      page(offset, Math.min(75, 450 - offset), 450),
    );

    const selected = await collectSelection(
      clientWith(rawList),
      DEFAULT_QUERY_STATE,
    );
    expect(selected.size).toBe(450);
    expect(rawList.mock.calls.map(([query]) => query.page.offset)).toEqual([
      0, 75, 150, 225, 300, 375,
    ]);
  });

  it('returns an empty selection with a confirmed zero total', async () => {
    const onProgress = vi.fn();
    const selected = await collectSelection(
      clientWith(vi.fn().mockResolvedValue(page(0, 0, 0))),
      DEFAULT_QUERY_STATE,
      { onProgress },
    );
    expect(selected.size).toBe(0);
    expect(onProgress).toHaveBeenCalledWith(0, 0);
  });

  it.each([
    undefined,
    null,
    '200',
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects an invalid declared total (%s)', async (total) => {
    const rawList = vi
      .fn()
      .mockResolvedValue({ data: [item(0)], meta: { total_count: total } });
    await expect(
      collectSelection(clientWith(rawList), DEFAULT_QUERY_STATE),
    ).rejects.toThrow('incomplete record page');
    expect(rawList).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing meta object', async () => {
    const rawList = vi.fn().mockResolvedValue({ data: [item(0)] });
    await expect(
      collectSelection(clientWith(rawList), DEFAULT_QUERY_STATE),
    ).rejects.toThrow('incomplete record page');
  });

  it('rejects an oversized page', async () => {
    const rawList = vi.fn().mockResolvedValue(page(0, 201, 201));
    await expect(
      collectSelection(clientWith(rawList), DEFAULT_QUERY_STATE),
    ).rejects.toThrow('incomplete record page');
  });

  it('rejects an empty page before the declared total without returning a partial selection', async () => {
    const rawList = vi
      .fn()
      .mockResolvedValueOnce(page(0, 200, 201))
      .mockResolvedValueOnce(page(200, 0, 201));
    await expect(
      collectSelection(clientWith(rawList), DEFAULT_QUERY_STATE),
    ).rejects.toThrow('empty page');
    expect(rawList).toHaveBeenCalledTimes(2);
  });

  it('rejects changing totals without returning a partial selection', async () => {
    const rawList = vi
      .fn()
      .mockResolvedValueOnce(page(0, 200, 201))
      .mockResolvedValueOnce(page(200, 2, 202));
    await expect(
      collectSelection(clientWith(rawList), DEFAULT_QUERY_STATE),
    ).rejects.toThrow('Records changed');
    expect(rawList).toHaveBeenCalledTimes(2);
  });

  it('rejects records beyond the declared total', async () => {
    const rawList = vi.fn().mockResolvedValue(page(0, 2, 1));
    await expect(
      collectSelection(clientWith(rawList), DEFAULT_QUERY_STATE),
    ).rejects.toThrow('beyond its record total');
  });

  it('rejects duplicate records within a page', async () => {
    const rawList = vi.fn().mockResolvedValue({
      data: [item(0), item(0)],
      meta: { total_count: 2 },
    });
    await expect(
      collectSelection(clientWith(rawList), DEFAULT_QUERY_STATE),
    ).rejects.toThrow('Records changed');
  });

  it('rejects duplicate records between pages even if the total remains stable', async () => {
    const rawList = vi
      .fn()
      .mockResolvedValueOnce(page(0, 200, 201))
      .mockResolvedValueOnce(page(0, 1, 201));
    await expect(
      collectSelection(clientWith(rawList), DEFAULT_QUERY_STATE),
    ).rejects.toThrow('Records changed');
  });

  it('stops before making a request when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const rawList = vi.fn();
    await expect(
      collectSelection(clientWith(rawList), DEFAULT_QUERY_STATE, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawList).not.toHaveBeenCalled();
  });

  it('stops issuing subsequent pages after cancellation from progress', async () => {
    const controller = new AbortController();
    const rawList = vi.fn().mockResolvedValue(page(0, 200, 400));
    await expect(
      collectSelection(clientWith(rawList), DEFAULT_QUERY_STATE, {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawList).toHaveBeenCalledTimes(1);
  });

  it('settles cancellation promptly while a read is in flight', async () => {
    const controller = new AbortController();
    let resolveRequest:
      | ((response: ReturnType<typeof page>) => void)
      | undefined;
    const rawList = vi.fn(
      () =>
        new Promise<ReturnType<typeof page>>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const selection = collectSelection(
      clientWith(rawList),
      DEFAULT_QUERY_STATE,
      { signal: controller.signal },
    );
    controller.abort();
    await expect(selection).rejects.toMatchObject({ name: 'AbortError' });
    resolveRequest?.(page(0, 200, 400));
    await Promise.resolve();
    expect(rawList).toHaveBeenCalledTimes(1);
  });

  it('propagates a failed read instead of silently truncating the selection', async () => {
    const failure = new Error('Read failed');
    const rawList = vi
      .fn()
      .mockResolvedValueOnce(page(0, 200, 400))
      .mockRejectedValueOnce(failure);
    await expect(
      collectSelection(clientWith(rawList), DEFAULT_QUERY_STATE),
    ).rejects.toBe(failure);
    expect(rawList).toHaveBeenCalledTimes(2);
  });
});
