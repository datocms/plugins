import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { COMMENTS_PAGE_SIZE } from '@/constants';

type UsePaginationOptions<T> = {
  /**
   * The full sorted list of items to paginate.
   */
  items: T[];
  /**
   * Number of items to show per page (default: COMMENTS_PAGE_SIZE).
   */
  pageSize?: number;
  /**
   * Ref to the scrollable container (used to preserve scroll position).
   */
  containerRef: RefObject<HTMLDivElement | null>;
};

type UsePaginationReturn<T> = {
  /**
   * The currently visible (paginated) items.
   */
  paginatedItems: T[];
  /**
   * Whether there are more items to load (above the current view).
   */
  hasMore: boolean;
  /**
   * Handler to load earlier items (expands the visible range upward).
   */
  handleLoadEarlier: () => void;
};

/**
 * Hook for managing pagination in a chat-style list where newest items are at the bottom.
 *
 * Initially shows the last `pageSize` items. "Load earlier" expands the visible range
 * upward while preserving scroll position so the user doesn't lose their place.
 */
export function usePagination<T>({
  items,
  pageSize = COMMENTS_PAGE_SIZE,
  containerRef,
}: UsePaginationOptions<T>): UsePaginationReturn<T> {
  // Track the index of the first (oldest) visible item
  // null means not initialized yet - will show last pageSize items
  const [firstVisibleIndex, setFirstVisibleIndex] = useState<number | null>(null);

  // Track scroll height before loading more to preserve scroll position
  const scrollHeightBeforeLoad = useRef<number | null>(null);

  // Initialize firstVisibleIndex when items first load.
  // This only runs once - when items become available for the first time.
  //
  // DEPENDENCY ARRAY DESIGN:
  // ------------------------
  // This effect intentionally uses `items.length` rather than `items` because:
  //
  // 1. INITIALIZATION GUARD: The condition `firstVisibleIndex === null` ensures
  //    this effect only runs during initialization. After that, the condition
  //    is false and the effect body never executes again.
  //
  // 2. LENGTH IS SUFFICIENT: For initialization, we only need to know HOW MANY
  //    items exist to calculate the starting index. We don't need to inspect
  //    the item contents.
  //
  // 3. PREVENTING RESET: If we included `items` in the dependencies, changing
  //    filter criteria (which changes items but may keep length similar) would
  //    NOT reset the view because firstVisibleIndex is already set. But it would
  //    cause unnecessary effect execution.
  //
  // The `paginatedItems` memo correctly uses the full `items` array because
  // it needs the actual content for slicing.
  useEffect(() => {
    if (firstVisibleIndex === null && items.length > 0) {
      setFirstVisibleIndex(Math.max(0, items.length - pageSize));
    }
  }, [items.length, firstVisibleIndex, pageSize]);

  // Paginated items - show from firstVisibleIndex to end
  // New items (appended at higher indices) are automatically included
  const paginatedItems = useMemo(() => {
    const startIndex = firstVisibleIndex ?? Math.max(0, items.length - pageSize);
    return items.slice(startIndex);
  }, [items, firstVisibleIndex, pageSize]);

  const hasMore = (firstVisibleIndex ?? 0) > 0;

  // Handler for loading earlier messages - saves scroll height before update
  const handleLoadEarlier = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      scrollHeightBeforeLoad.current = container.scrollHeight;
    }
    setFirstVisibleIndex((prev) => Math.max(0, (prev ?? 0) - pageSize));
  }, [containerRef, pageSize]);

  // Restore scroll position after loading earlier messages
  // useLayoutEffect runs synchronously after DOM mutations but before paint
  //
  // NOTE: This effect only runs when scrollHeightBeforeLoad.current is set,
  // which only happens when handleLoadEarlier() is called. The effect checks
  // this value first and bails out if null, so it won't erroneously adjust
  // scroll position when new items are appended (which sets paginatedItems
  // but doesn't set scrollHeightBeforeLoad).
  useLayoutEffect(() => {
    // Only restore scroll position if we just loaded earlier items
    // (scrollHeightBeforeLoad is only set by handleLoadEarlier)
    if (scrollHeightBeforeLoad.current === null) return;

    const container = containerRef.current;
    if (!container) return;

    const newScrollHeight = container.scrollHeight;
    const scrollDiff = newScrollHeight - scrollHeightBeforeLoad.current;
    container.scrollTop += scrollDiff;
    scrollHeightBeforeLoad.current = null;
  }, [paginatedItems, containerRef]);

  return {
    paginatedItems,
    hasMore,
    handleLoadEarlier,
  };
}
