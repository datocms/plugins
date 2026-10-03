import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import type { RawItem } from '../types';
import {
  buildItemsListQuery,
  fetchItemsPage,
  normalizeQueryState,
} from './query';

describe('record query', () => {
  it('builds the safe all-model query with current versions', () => {
    expect(buildItemsListQuery({})).toEqual({
      nested: false,
      version: 'current',
      page: { offset: 0, limit: 50 },
      filter: {
        fields: { _created_at: { exists: true } },
      },
      order_by: '_updated_at_DESC,id_ASC',
    });
  });

  it('combines pagination, model, status, and safe sorting', () => {
    expect(
      buildItemsListQuery({
        page: 2,
        perPage: 100,
        model: 'article-model',
        status: 'updated',
        orderBy: 'id_ASC',
      }),
    ).toEqual({
      nested: false,
      version: 'current',
      page: { offset: 200, limit: 100 },
      filter: {
        type: 'article-model',
        fields: {
          _created_at: { exists: true },
          _status: { eq: 'updated' },
        },
      },
      order_by: 'id_ASC',
    });
  });

  it('trims text and leaves search results in relevance order', () => {
    const query = buildItemsListQuery({
      query: '  launch update  ',
      orderBy: '_created_at_ASC',
    });

    expect(query.filter).toMatchObject({ query: 'launch update' });
    expect(query).not.toHaveProperty('order_by');
  });

  it('uses a resolved presentation field for model-scoped preview sorting', () => {
    expect(
      buildItemsListQuery(
        {
          model: 'article-model',
          orderBy: '_preview_ASC',
        },
        'title_ASC',
      ),
    ).toMatchObject({
      filter: { type: 'article-model' },
      order_by: 'title_ASC,id_ASC',
    });
  });

  it('never sends synthetic global bucket columns as CMA order fields', () => {
    expect(buildItemsListQuery({ orderBy: '_model_ASC' }).order_by).toBe(
      '_updated_at_DESC,id_ASC',
    );
    expect(buildItemsListQuery({ orderBy: '_status_DESC' }).order_by).toBe(
      '_updated_at_DESC,id_ASC',
    );
  });

  it('normalizes untrusted query values', () => {
    expect(
      normalizeQueryState({
        page: -12,
        perPage: 77,
        query: '  hello ',
        model: ' ',
        status: 'archived' as never,
        orderBy: 'title_ASC' as never,
      }),
    ).toEqual({
      page: 0,
      perPage: 50,
      query: 'hello',
      model: null,
      status: null,
      orderBy: null,
    });
  });

  it('returns raw items and the server total count', async () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      id: `item-${index}`,
    })) as RawItem[];
    const rawList = vi.fn().mockResolvedValue({
      data: items,
      meta: { total_count: 128 },
    });
    const client = {
      items: { rawList },
    } as unknown as Pick<Client, 'items'>;

    await expect(fetchItemsPage(client, {})).resolves.toEqual({
      items,
      totalCount: 128,
    });
    expect(rawList).toHaveBeenCalledWith(
      expect.objectContaining({ nested: false, version: 'current' }),
    );
  });

  it('keeps single-model timestamp and status pages stable at ties', () => {
    expect(
      buildItemsListQuery({ model: 'm', orderBy: '_updated_at_DESC' }).order_by,
    ).toBe('_updated_at_DESC,id_ASC');
    expect(
      buildItemsListQuery({ model: 'm', orderBy: '_status_ASC' }).order_by,
    ).toBe('_status_ASC,id_ASC');
  });

  it('bounds unsafe page values and always sends at most 200 records', () => {
    expect(
      buildItemsListQuery({ page: '9'.repeat(400) as unknown as number }).page,
    ).toEqual({ offset: 0, limit: 50 });
    const query = buildItemsListQuery({
      page: Number.MAX_SAFE_INTEGER,
      perPage: 200,
    });
    expect(Number.isSafeInteger(query.page.offset)).toBe(true);
    expect(query.page.limit).toBe(200);
  });

  it('completes short API responses from the actual received offset', async () => {
    const rawList = vi.fn(
      async (query: ReturnType<typeof buildItemsListQuery>) => ({
        data: Array.from(
          {
            length: Math.min(7, query.page.limit, 200_000 - query.page.offset),
          },
          (_, index) =>
            ({ id: `item-${query.page.offset + index}` }) as RawItem,
        ),
        meta: { total_count: 200_000 },
      }),
    );
    const client = { items: { rawList } } as unknown as Pick<Client, 'items'>;
    const result = await fetchItemsPage(client, { page: 999, perPage: 200 });

    expect(result.totalCount).toBe(200_000);
    expect(result.items).toHaveLength(200);
    expect(result.items[0].id).toBe('item-199800');
    expect(result.items[199].id).toBe('item-199999');
    expect(rawList).toHaveBeenCalledTimes(29);
  });

  it('reports missing totals and premature empty pages instead of truncating silently', async () => {
    const rawList = vi
      .fn()
      .mockResolvedValueOnce({ data: [], meta: {} })
      .mockResolvedValueOnce({ data: [], meta: { total_count: 200_000 } });
    const client = { items: { rawList } } as unknown as Pick<Client, 'items'>;

    await expect(fetchItemsPage(client, {})).rejects.toThrow(
      /incomplete record page/,
    );
    await expect(fetchItemsPage(client, {})).rejects.toThrow(/empty page/);
  });

  it('rejects overlapping short pages instead of showing duplicate records', async () => {
    const rawList = vi.fn().mockResolvedValue({
      data: [{ id: 'same-record' }],
      meta: { total_count: 200_000 },
    });
    const client = { items: { rawList } } as unknown as Pick<Client, 'items'>;
    await expect(fetchItemsPage(client, {})).rejects.toThrow(/Records changed/);
    expect(rawList).toHaveBeenCalledTimes(2);
  });

  it('does not send requests after cancellation', async () => {
    const rawList = vi.fn();
    const client = { items: { rawList } } as unknown as Pick<Client, 'items'>;
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchItemsPage(client, {}, undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawList).not.toHaveBeenCalled();
  });
});
