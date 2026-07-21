import type { Client, RawApiTypes } from '@datocms/cma-client-browser';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QueryState, RawItem } from '../types';
import { useItemsPage } from './useItemsPage';

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function item(id: string): RawItem {
  return {
    id,
    type: 'item',
    attributes: {},
    relationships: {
      item_type: { data: { id: 'model-1', type: 'item_type' } },
    },
    meta: {
      status: 'published',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  } as unknown as RawItem;
}

const DEFAULT_STATE: QueryState = {
  page: 0,
  perPage: 50,
  query: '',
  model: null,
  status: null,
  orderBy: null,
};

describe('useItemsPage', () => {
  it('ignores a stale response after the query changes', async () => {
    type Response = RawApiTypes.ItemInstancesTargetSchema;
    const first = deferred<Response>();
    const second = deferred<Response>();
    const rawList = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const client = { items: { rawList } } as unknown as Client;

    const { result, rerender } = renderHook(
      ({ queryState }) =>
        useItemsPage({
          client,
          queryState,
          enabled: true,
          refreshVersion: 0,
        }),
      { initialProps: { queryState: DEFAULT_STATE } },
    );

    rerender({ queryState: { ...DEFAULT_STATE, page: 1 } });

    await act(async () => {
      second.resolve({
        data: [item('new-page')],
        meta: { total_count: 1 },
      } as Response);
    });
    await waitFor(() => expect(result.current.items[0]?.id).toBe('new-page'));

    await act(async () => {
      first.resolve({
        data: [item('stale-page')],
        meta: { total_count: 1 },
      } as Response);
    });

    expect(result.current.items[0]?.id).toBe('new-page');
  });

  it('refetches after the set of available models changes', async () => {
    const rawList = vi
      .fn()
      .mockResolvedValueOnce({
        data: [item('before-schema-change')],
        meta: { total_count: 1 },
      })
      .mockResolvedValueOnce({
        data: [item('after-schema-change')],
        meta: { total_count: 1 },
      });
    const client = { items: { rawList } } as unknown as Client;

    const { result, rerender } = renderHook(
      ({ schemaVersion }) =>
        useItemsPage({
          client,
          queryState: DEFAULT_STATE,
          enabled: true,
          refreshVersion: 0,
          schemaVersion,
        }),
      { initialProps: { schemaVersion: 'model-1' } },
    );

    await waitFor(() =>
      expect(result.current.items[0]?.id).toBe('before-schema-change'),
    );
    rerender({ schemaVersion: 'model-1,model-2' });

    await waitFor(() =>
      expect(result.current.items[0]?.id).toBe('after-schema-change'),
    );
    expect(rawList).toHaveBeenCalledTimes(2);
  });
});
