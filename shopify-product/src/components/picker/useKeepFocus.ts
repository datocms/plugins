import { type RefObject, useCallback, useEffect, useRef } from 'react';

/**
 * Keyboard focus through controls that leave while they work: "Load more"
 * (and the "Try again" of a failed page), and the "Try again" of a failed
 * first load, which a spinner replaces. Focus only moves when it was on that
 * control or fell to the body with it, never away from where the editor
 * went meanwhile, and never for infinite scroll.
 */

type Status = 'idle' | 'loading' | 'ready' | 'error';

function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/**
 * "Load more": the button stays focusable while the page loads. When the
 * page lands, focus moves to the first new item; with nothing new, back to
 * the area (Load more again, or Try again after a failure); with nothing
 * left to load, to the last item.
 *
 * Returns `capture`, for the area's buttons to call before they load: the
 * button that is clicked may unmount before the loading effect runs.
 */
export function useLoadMoreFocus({
  items,
  area,
  loadingMore,
}: {
  /** The list's items, in order. */
  items: () => HTMLElement[];
  /** Wraps the Load more button, or the Try again of a failed page. */
  area: RefObject<HTMLElement | null>;
  loadingMore: boolean;
}): () => void {
  /** How many items there were when loading started, while focus is kept. */
  const pending = useRef<number | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const focusInArea = () => {
      const active = document.activeElement;
      return active instanceof Node && Boolean(area.current?.contains(active));
    };
    if (loadingMore) {
      // Infinite scroll started it while the button had focus.
      if (pending.current === null && focusInArea()) {
        pending.current = itemsRef.current().length;
      }
      return;
    }
    const index = pending.current;
    pending.current = null;
    if (index === null || !(focusInArea() || focusIsLost())) return;
    const list = itemsRef.current();
    const target =
      list[index] ??
      area.current?.querySelector<HTMLElement>('button') ??
      list[list.length - 1];
    target?.focus();
  }, [loadingMore, area]);

  return useCallback(() => {
    pending.current = itemsRef.current().length;
  }, []);
}

/**
 * "Try again" of a failed first load: once the retry settles, focus the
 * first item (the roving tab stop), or the new Try again if it failed again,
 * else call `fallback`. Returns the function its button calls before retrying.
 */
export function useRetryFocus({
  root,
  status,
  fallback,
}: {
  /** Holds the results (or the failure's alert) once the retry settles. */
  root: RefObject<HTMLElement | null>;
  status: Status;
  fallback?: () => void;
}): () => void {
  const pending = useRef(false);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    if (!pending.current || status === 'loading' || status === 'idle') return;
    pending.current = false;
    if (!focusIsLost()) return;
    const element = root.current;
    const target =
      status === 'error'
        ? element?.querySelector<HTMLElement>('[role="alert"] button')
        : (element?.querySelector<HTMLElement>('[data-roving][tabindex="0"]') ??
          element?.querySelector<HTMLElement>('[data-roving]'));
    if (target) target.focus();
    else fallbackRef.current?.();
  }, [status, root]);

  return useCallback(() => {
    pending.current = true;
  }, []);
}
