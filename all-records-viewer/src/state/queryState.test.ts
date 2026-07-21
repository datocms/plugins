import { describe, expect, it } from 'vitest';
import {
  buildPluginPageUrl,
  clampPage,
  DEFAULT_QUERY_STATE,
  parseQueryState,
  serializeQueryState,
  updateQueryState,
} from './queryState';

describe('query state', () => {
  it('parses and validates page state', () => {
    expect(
      parseQueryState(
        '?page=2&perPage=100&model=article&status=updated&orderBy=id_ASC',
      ),
    ).toEqual({
      page: 2,
      perPage: 100,
      query: '',
      model: 'article',
      status: 'updated',
      orderBy: 'id_ASC',
    });

    expect(parseQueryState('?page=-2&perPage=23&status=nope')).toEqual(
      DEFAULT_QUERY_STATE,
    );
  });

  it('uses relevance and omits explicit sorting while searching', () => {
    expect(parseQueryState('?query=news&orderBy=id_DESC').orderBy).toBeNull();
    expect(
      serializeQueryState({
        ...DEFAULT_QUERY_STATE,
        query: 'news',
        orderBy: '_created_at_ASC',
      }),
    ).toBe('?query=news');
  });

  it('keeps Preview ordering scoped to one model and allows global buckets', () => {
    expect(parseQueryState('?model=article&orderBy=_preview_ASC').orderBy).toBe(
      '_preview_ASC',
    );
    expect(parseQueryState('?orderBy=_preview_ASC').orderBy).toBeNull();
    expect(parseQueryState('?orderBy=_status_DESC').orderBy).toBe(
      '_status_DESC',
    );
    expect(parseQueryState('?orderBy=_model_ASC').orderBy).toBe('_model_ASC');
    expect(
      parseQueryState('?model=article&orderBy=_model_ASC').orderBy,
    ).toBeNull();
    expect(
      parseQueryState('?status=published&orderBy=_status_ASC').orderBy,
    ).toBeNull();

    expect(
      updateQueryState(
        {
          ...DEFAULT_QUERY_STATE,
          model: 'article',
          orderBy: '_status_ASC',
        },
        { model: null },
      ).orderBy,
    ).toBe('_status_ASC');

    expect(
      updateQueryState(
        { ...DEFAULT_QUERY_STATE, orderBy: '_status_ASC' },
        { status: 'published' },
      ).orderBy,
    ).toBeNull();
  });

  it('resets the page when controls change', () => {
    expect(
      updateQueryState(
        { ...DEFAULT_QUERY_STATE, page: 4, orderBy: 'id_ASC' },
        { status: 'draft' },
      ),
    ).toMatchObject({ page: 0, status: 'draft', orderBy: 'id_ASC' });

    expect(
      updateQueryState(
        { ...DEFAULT_QUERY_STATE, page: 4, orderBy: 'id_ASC' },
        { query: 'hello' },
      ),
    ).toMatchObject({ page: 0, query: 'hello', orderBy: null });

    expect(
      updateQueryState(
        { ...DEFAULT_QUERY_STATE, page: 4, orderBy: 'id_DESC' },
        { orderBy: null },
      ),
    ).toMatchObject({ page: 0, orderBy: null });
  });

  it('builds environment-aware page URLs', () => {
    expect(
      buildPluginPageUrl({
        environment: 'sandbox',
        isEnvironmentPrimary: false,
        pluginId: 'plugin-1',
        state: { ...DEFAULT_QUERY_STATE, page: 1 },
      }),
    ).toBe('/environments/sandbox/editor/p/plugin-1/pages/all-records?page=1');
  });

  it('clamps pages after totals change', () => {
    expect(clampPage(4, 51, 50)).toBe(1);
    expect(clampPage(3, 0, 50)).toBe(0);
  });
});
