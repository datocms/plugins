import { type RefObject, useCallback, useEffect, useRef } from 'react';

/**
 * Keyboard focus through controls that leave while they work: "Load more"
 * (and the "Try again" of a failed page), and the "Try again" of a failed
 * first load, which a loading state replaces. Focus only moves when it was on
 * that control or fell to the body with it, never away from where the editor
 * went meanwhile, and never for infinite scroll.
 */

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** Marks the element of each result (a card, or a row of a table). */
export const ITEM_ATTRIBUTE = 'data-picker-item';

/** Marks a variant panel, so the items of the list around it skip its rows. */
export const PANEL_ATTRIBUTE = 'data-picker-panel';

/** Marks the pinned SKU matches, which aren't items of the main list. */
export const PINNED_ATTRIBUTE = 'data-picker-pinned';

/**
 * What takes focus in an item: a row that opens (it is focusable itself),
 * else its first enabled control (the card's media button, a checkbox, a
 * tree toggle).
 */
const FOCUSABLE =
  '[tabindex="0"], button:not(:disabled), input:not(:disabled), a[href]';

function focusTarget(item: HTMLElement): HTMLElement | null {
  if (item.matches(FOCUSABLE)) return item;
  return item.querySelector<HTMLElement>(FOCUSABLE);
}

/** The focus targets of these items, without the items that have none. */
export function focusTargets(items: Iterable<HTMLElement>): HTMLElement[] {
  return Array.from(items)
    .map(focusTarget)
    .filter((target): target is HTMLElement => target !== null);
}

/**
 * The focus targets of the items in `container`, in order: the rows of a
 * variant panel opened inside it are not its items, and items without a
 * control (an item that can't be picked) are skipped. `skipPinned` leaves
 * out the pinned SKU matches (the main list's Load more).
 */
export function itemTargets(
  container: HTMLElement | null,
  { skipPinned = false }: { skipPinned?: boolean } = {},
): HTMLElement[] {
  if (!container) return [];
  const panel = container.closest(`[${PANEL_ATTRIBUTE}]`);
  return focusTargets(
    Array.from(
      container.querySelectorAll<HTMLElement>(`[${ITEM_ATTRIBUTE}]`),
    ).filter(
      (item) =>
        item.closest(`[${PANEL_ATTRIBUTE}]`) === panel &&
        !(skipPinned && item.closest(`[${PINNED_ATTRIBUTE}]`)),
    ),
  );
}

function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/**
 * "Load more": when the page lands, focus moves to the first new item; with
 * nothing new, back to the area (Load more again, or Try again after a
 * failure); with nothing left to load, to the last item. A busy button is
 * disabled, so the browser may drop its focus meanwhile: that counts as
 * focus that was on it.
 *
 * Returns `capture`, for the area's buttons to call before they load: the
 * button that is clicked may unmount before the loading effect runs.
 */
export function useLoadMoreFocus({
  items,
  area,
  loadingMore,
}: {
  /** The focus targets of the list's items, in order. */
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
      area.current?.querySelector<HTMLElement>('button:not(:disabled)') ??
      list[list.length - 1];
    target?.focus();
  }, [loadingMore, area]);

  return useCallback(() => {
    pending.current = itemsRef.current().length;
  }, []);
}

/**
 * "Try again" of a failed first load: once the retry settles, focus the
 * first item, or the new Try again if it failed again, else call `fallback`.
 * Returns the function its button calls before retrying.
 */
export function useRetryFocus({
  firstItem,
  retryButton,
  status,
  fallback,
}: {
  /** The focus target of the first result, once the retry settles. */
  firstItem: () => HTMLElement | null;
  /** The Try again of the failure, once it shows again. */
  retryButton: RefObject<HTMLElement | null>;
  status: Status;
  fallback?: () => void;
}): () => void {
  const pending = useRef(false);
  const firstItemRef = useRef(firstItem);
  firstItemRef.current = firstItem;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    if (!pending.current || status === 'loading' || status === 'idle') return;
    pending.current = false;
    if (!focusIsLost()) return;
    const target =
      status === 'error' ? retryButton.current : firstItemRef.current();
    if (target) target.focus();
    else fallbackRef.current?.();
  }, [status, retryButton]);

  return useCallback(() => {
    pending.current = true;
  }, []);
}
