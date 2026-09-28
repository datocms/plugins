import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import type {
  FindReplaceController,
  FindReplaceEvent,
  FindReplaceSnapshot,
} from './contract';

/** The controller's current snapshot; re-renders on every emit. */
export function useFindReplaceSnapshot(
  controller: FindReplaceController,
): FindReplaceSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Calls `handler` once per controller event. The latest handler is used, and
 * there is one subscription per controller, so StrictMode never doubles an
 * event.
 */
export function useFindReplaceEvent(
  controller: FindReplaceController,
  handler: (event: FindReplaceEvent) => void,
): void {
  const handlerRef = useRef(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(
    () => controller.subscribeEvents((event) => handlerRef.current(event)),
    [controller],
  );
}
