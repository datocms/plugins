import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  FindReplaceController,
  FindReplaceEvent,
  FindReplaceSnapshot,
} from './contract';
import { useFindReplaceEvent, useFindReplaceSnapshot } from './useFindReplace';

/** Just enough of a controller for the bridge: a snapshot store and events. */
function stubController() {
  let snapshot = { version: 1 } as FindReplaceSnapshot;
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: FindReplaceEvent) => void>();
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeEvents: (listener: (event: FindReplaceEvent) => void) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  } as unknown as FindReplaceController;
  return {
    controller,
    emit: (next: FindReplaceSnapshot) => {
      snapshot = next;
      for (const listener of listeners) listener();
    },
    dispatch: (event: FindReplaceEvent) => {
      for (const listener of eventListeners) listener(event);
    },
    eventListenerCount: () => eventListeners.size,
  };
}

describe('useFindReplaceSnapshot', () => {
  it('renders the current snapshot and follows every emit', () => {
    const stub = stubController();
    const { result } = renderHook(() =>
      useFindReplaceSnapshot(stub.controller),
    );
    expect(result.current.version).toBe(1);

    const next = { version: 2 } as FindReplaceSnapshot;
    act(() => stub.emit(next));
    expect(result.current).toBe(next);
  });
});

describe('useFindReplaceEvent', () => {
  it('calls the latest handler once per event and unsubscribes on unmount', () => {
    const stub = stubController();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ handler }) => useFindReplaceEvent(stub.controller, handler),
      { initialProps: { handler: first } },
    );
    rerender({ handler: second });
    stub.dispatch({ type: 'runStarted' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(stub.eventListenerCount()).toBe(1);

    unmount();
    expect(stub.eventListenerCount()).toBe(0);
  });
});
