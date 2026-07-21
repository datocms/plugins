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
      order_by: 'title_ASC',
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
    const item = { id: 'item-1' } as unknown as RawItem;
    const rawList = vi.fn().mockResolvedValue({
      data: [item],
      meta: { total_count: 128 },
    });
    const client = {
      items: { rawList },
    } as unknown as Pick<Client, 'items'>;

    await expect(fetchItemsPage(client, {})).resolves.toEqual({
      items: [item],
      totalCount: 128,
    });
    expect(rawList).toHaveBeenCalledWith(
      expect.objectContaining({ nested: false, version: 'current' }),
    );
  });
});
