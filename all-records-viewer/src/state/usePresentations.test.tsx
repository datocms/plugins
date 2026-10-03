import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createPresentationResolver,
  type ItemPresentation,
} from '../presentation/resolver';
import type { RawItem } from '../types';
import { usePresentations } from './usePresentations';

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
      is_current_version_valid: true,
      is_published_version_valid: true,
    },
  } as unknown as RawItem;
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe('usePresentations', () => {
  it('aborts old pages and ignores their presentation results', async () => {
    const first = deferred<ItemPresentation[]>();
    const second = deferred<ItemPresentation[]>();
    const base = createPresentationResolver({ locales: ['en'] });
    const resolveMany = vi
      .fn(base.resolveMany)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const resolver = { ...base, resolveMany };
    const firstItems = [item('first')];
    const secondItems = [item('second')];
    const { result, rerender, unmount } = renderHook(
      ({ items }) => usePresentations(resolver, items),
      { initialProps: { items: firstItems } },
    );
    const firstSignal = resolveMany.mock.calls[0][1]?.signal;

    rerender({ items: secondItems });
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => {
      second.resolve(await base.resolveMany(secondItems));
    });
    expect([...result.current.byItemId.keys()]).toEqual(['second']);

    await act(async () => {
      first.resolve(await base.resolveMany(firstItems));
    });
    expect([...result.current.byItemId.keys()]).toEqual(['second']);
    const secondSignal = resolveMany.mock.calls[1][1]?.signal;
    unmount();
    expect(secondSignal?.aborted).toBe(true);
  });

  it('retains only the current page while the next presentation request loads', async () => {
    const base = createPresentationResolver({ locales: ['en'] });
    const pending = deferred<ItemPresentation[]>();
    const resolveMany = vi
      .fn(base.resolveMany)
      .mockImplementationOnce(base.resolveMany)
      .mockImplementationOnce(() => pending.promise);
    const resolver = { ...base, resolveMany };
    const firstItems = [item('first'), item('shared')];
    const secondItems = [item('shared'), item('next')];
    const { result, rerender } = renderHook(
      ({ items }) => usePresentations(resolver, items),
      { initialProps: { items: firstItems } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect([...result.current.byItemId.keys()]).toEqual(['first', 'shared']);

    rerender({ items: secondItems });
    expect(result.current.loading).toBe(true);
    expect([...result.current.byItemId.keys()]).toEqual(['shared']);
    await act(async () => {
      pending.resolve(await base.resolveMany(secondItems));
    });
    expect([...result.current.byItemId.keys()]).toEqual(['shared', 'next']);
  });

  it('clears the page and cancels pending work when no records remain', async () => {
    const base = createPresentationResolver({ locales: ['en'] });
    const pending = deferred<ItemPresentation[]>();
    const resolveMany = vi
      .fn(base.resolveMany)
      .mockReturnValue(pending.promise);
    const resolver = { ...base, resolveMany };
    const { result, rerender } = renderHook(
      ({ items }) => usePresentations(resolver, items),
      { initialProps: { items: [item('first')] } },
    );
    const signal = resolveMany.mock.calls[0][1]?.signal;

    rerender({ items: [] });
    expect(signal?.aborted).toBe(true);
    expect(result.current.byItemId.size).toBe(0);
    expect(result.current.loading).toBe(false);
    await act(async () => pending.resolve([]));
    expect(result.current.byItemId.size).toBe(0);
  });
});
