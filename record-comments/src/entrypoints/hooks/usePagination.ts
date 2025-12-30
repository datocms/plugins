import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { COMMENTS_PAGE_SIZE } from '@/constants';

type UsePaginationOptions<T> = {
  items: T[];
  pageSize?: number;
  containerRef: RefObject<HTMLDivElement | null>;
};

type UsePaginationReturn<T> = {
  paginatedItems: T[];
  hasMore: boolean;
  handleLoadEarlier: () => void;
};

/** Chat-style pagination: newest at bottom, "load earlier" expands upward. */
export function usePagination<T>({
  items,
  pageSize = COMMENTS_PAGE_SIZE,
  containerRef,
}: UsePaginationOptions<T>): UsePaginationReturn<T> {
  const [firstVisibleIndex, setFirstVisibleIndex] = useState<number | null>(null);
  const scrollHeightBeforeLoad = useRef<number | null>(null);

  useEffect(() => {
    if (firstVisibleIndex === null && items.length > 0) {
      setFirstVisibleIndex(Math.max(0, items.length - pageSize));
    }
  }, [items.length, firstVisibleIndex, pageSize]);

  const paginatedItems = useMemo(() => {
    const startIndex = firstVisibleIndex ?? Math.max(0, items.length - pageSize);
    return items.slice(startIndex);
  }, [items, firstVisibleIndex, pageSize]);

  const hasMore = (firstVisibleIndex ?? 0) > 0;

  const handleLoadEarlier = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      scrollHeightBeforeLoad.current = container.scrollHeight;
    }
    setFirstVisibleIndex((prev) => Math.max(0, (prev ?? 0) - pageSize));
  }, [containerRef, pageSize]);

  useLayoutEffect(() => {
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
