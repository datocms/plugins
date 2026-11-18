import { act, renderHook, waitFor } from '@testing-library/react';
import type { ResolvedItemPresentationInfo } from 'datocms-plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { RawItem } from '../types';
import { type LoadPresentations, usePresentations } from './usePresentations';

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

function presentationsOf(
  items: readonly RawItem[],
): ResolvedItemPresentationInfo[] {
  return items.map((entry) => ({
    id: entry.id,
    title: `Title of ${entry.id}`,
    image: null,
    itemTypeId: 'model-1',
    status: 'published',
    currentVersionValid: true,
    publishedVersionValid: true,
    editPath: null,
  }));
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

const loadAll: LoadPresentations = async (items) => presentationsOf(items);

describe('usePresentations', () => {
  it('loads the page in one call and ignores the results of old pages', async () => {
    const first = deferred<ResolvedItemPresentationInfo[]>();
    const second = deferred<ResolvedItemPresentationInfo[]>();
    const load = vi
      .fn<LoadPresentations>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const firstItems = [item('first')];
    const secondItems = [item('second'), item('third')];
    const { result, rerender } = renderHook(
      ({ items }) => usePresentations(load, items),
      { initialProps: { items: firstItems } },
    );

    rerender({ items: secondItems });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith(secondItems);
    await act(async () => second.resolve(presentationsOf(secondItems)));
    expect([...result.current.byItemId.keys()]).toEqual(['second', 'third']);

    await act(async () => first.resolve(presentationsOf(firstItems)));
    expect([...result.current.byItemId.keys()]).toEqual(['second', 'third']);
  });

  it('retains only the current page while the next presentation request loads', async () => {
    const pending = deferred<ResolvedItemPresentationInfo[]>();
    const load = vi
      .fn<LoadPresentations>(loadAll)
      .mockImplementationOnce(loadAll)
      .mockImplementationOnce(() => pending.promise);
    const firstItems = [item('first'), item('shared')];
    const secondItems = [item('shared'), item('next')];
    const { result, rerender } = renderHook(
      ({ items }) => usePresentations(load, items),
      { initialProps: { items: firstItems } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect([...result.current.byItemId.keys()]).toEqual(['first', 'shared']);

    rerender({ items: secondItems });
    expect(result.current.loading).toBe(true);
    expect([...result.current.byItemId.keys()]).toEqual(['shared']);
    await act(async () => pending.resolve(presentationsOf(secondItems)));
    expect([...result.current.byItemId.keys()]).toEqual(['shared', 'next']);
  });

  it('leaves out the records that DatoCMS could not present', async () => {
    const load = vi.fn<LoadPresentations>(async (items) => [
      ...presentationsOf(items.slice(0, 1)),
      null,
    ]);
    const items = [item('first'), item('gone')];
    const { result } = renderHook(() => usePresentations(load, items));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect([...result.current.byItemId.keys()]).toEqual(['first']);
  });

  it('clears the page and ignores pending work when no records remain', async () => {
    const pending = deferred<ResolvedItemPresentationInfo[]>();
    const load = vi.fn<LoadPresentations>().mockReturnValue(pending.promise);
    const firstItems = [item('first')];
    const { result, rerender } = renderHook(
      ({ items }) => usePresentations(load, items),
      { initialProps: { items: firstItems } },
    );

    rerender({ items: [] });
    expect(result.current.byItemId.size).toBe(0);
    expect(result.current.loading).toBe(false);
    await act(async () => pending.resolve(presentationsOf(firstItems)));
    expect(result.current.byItemId.size).toBe(0);
  });
});
