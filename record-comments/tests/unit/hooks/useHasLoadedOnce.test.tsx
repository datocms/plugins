// @vitest-environment jsdom

import { useChangeCount, useHasLoadedOnce } from '@hooks/useHasLoadedOnce';
import { describe, expect, it } from 'vitest';
import { renderHook } from '../testUtils/react';

describe('useHasLoadedOnce', () => {
  it('stays loaded through the later loads of the same record', () => {
    const state = { scope: 'record-1', settled: false };
    const { result, rerender, unmount } = renderHook(() =>
      useHasLoadedOnce(state.scope, state.settled),
    );
    expect(result.current).toBe(false);

    state.settled = true;
    rerender();
    expect(result.current).toBe(true);

    // A refetch after a save, a reconnection
    state.settled = false;
    rerender();
    expect(result.current).toBe(true);
    unmount();
  });

  it('starts again for another record, ignoring the values of the previous one', () => {
    const state = { scope: 'record-1', settled: true };
    const { result, rerender, unmount } = renderHook(() =>
      useHasLoadedOnce(state.scope, state.settled),
    );
    expect(result.current).toBe(true);

    // The first render of the new record still has the values of the old
    // one, until the data hooks reset
    state.scope = 'record-2';
    rerender();
    expect(result.current).toBe(false);

    state.settled = false;
    rerender();
    expect(result.current).toBe(false);

    state.settled = true;
    rerender();
    expect(result.current).toBe(true);
    unmount();
  });
});

describe('useChangeCount', () => {
  it('counts the changes of a value by identity', () => {
    const state = { value: { id: 'client-1' } as object };
    const { result, rerender, unmount } = renderHook(() =>
      useChangeCount(state.value),
    );
    expect(result.current).toBe(0);

    rerender();
    expect(result.current).toBe(0);

    state.value = { id: 'client-2' };
    rerender();
    expect(result.current).toBe(1);

    rerender();
    expect(result.current).toBe(1);
    unmount();
  });
});
