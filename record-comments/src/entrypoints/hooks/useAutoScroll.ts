import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type UseAutoScrollOptions = {
  /**
   * Ref to the scrollable container element.
   */
  containerRef: RefObject<HTMLDivElement | null>;
  /**
   * Current number of items (comments) - used to detect new arrivals.
   */
  itemsCount: number;
  /**
   * Pixel threshold from bottom to consider "at bottom" (default: 50).
   */
  bottomThreshold?: number;
};

type UseAutoScrollReturn = {
  /**
   * Whether the user is currently scrolled to the bottom.
   */
  isAtBottom: boolean;
  /**
   * Number of new items that arrived while user was scrolled up.
   */
  newItemsCount: number;
  /**
   * Scroll event handler to attach to the container.
   */
  handleScroll: () => void;
  /**
   * Handler for clicking the "new items" indicator - scrolls to bottom and resets count.
   */
  handleNewItemsClick: () => void;
};

/**
 * Hook for managing auto-scroll behavior in a chat-style scrollable list.
 *
 * Tracks whether the user is at the bottom of the scroll container and
 * automatically scrolls when new items arrive (if user was at bottom).
 * Also tracks how many new items arrived while user was scrolled up.
 */
export function useAutoScroll({
  containerRef,
  itemsCount,
  bottomThreshold = 50,
}: UseAutoScrollOptions): UseAutoScrollReturn {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newItemsCount, setNewItemsCount] = useState(0);

  // Track if we should auto-scroll (user was at bottom when new item arrived)
  const shouldAutoScrollRef = useRef(false);
  const prevItemsCountRef = useRef(itemsCount);

  // Store threshold in ref so ResizeObserver callback can access current value
  const bottomThresholdRef = useRef(bottomThreshold);
  bottomThresholdRef.current = bottomThreshold;

  // Scroll handler to detect if user is at bottom
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const atBottom = scrollHeight - scrollTop - clientHeight < bottomThreshold;
    setIsAtBottom(atBottom);

    // Clear new items count when user scrolls to bottom
    if (atBottom) {
      setNewItemsCount(0);
    }
  }, [containerRef, bottomThreshold]);

  // Click handler for new items indicator
  const handleNewItemsClick = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
    setNewItemsCount(0);
  }, [containerRef]);

  // Smart auto-scroll when new items arrive
  useEffect(() => {
    const newCount = itemsCount - prevItemsCountRef.current;
    const container = containerRef.current;

    if (newCount > 0) {
      if (isAtBottom && container) {
        // User is at bottom, mark that we should auto-scroll
        shouldAutoScrollRef.current = true;
        container.scrollTop = container.scrollHeight;
      } else if (!isAtBottom) {
        // User is scrolled up, increment new items counter
        setNewItemsCount(prev => prev + newCount);
      }
    }

    prevItemsCountRef.current = itemsCount;
  }, [itemsCount, isAtBottom, containerRef]);

  // Use ResizeObserver to scroll when content size changes (e.g., images load)
  // NOTE: This effect intentionally does NOT depend on itemsCount. The ResizeObserver
  // only needs to be set up once per container and will automatically detect size changes
  // when items are added/removed. Including itemsCount would cause unnecessary observer
  // reconnections on every item change, which is wasteful.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Track if observer is still active to prevent callbacks after cleanup
    let isObserverActive = true;

    const resizeObserver = new ResizeObserver(() => {
      // Guard against callbacks firing after disconnect (browser timing edge case)
      // IMPORTANT: Read containerRef.current inside callback to avoid stale closure.
      // The outer `container` variable could be stale if the ref was reassigned.
      const currentContainer = containerRef.current;
      if (!isObserverActive || !currentContainer || !currentContainer.isConnected) return;

      // If we should auto-scroll and user is still at bottom, scroll to bottom
      if (shouldAutoScrollRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = currentContainer;
        // Use the same threshold as the scroll handler for consistent behavior
        const atBottom = scrollHeight - scrollTop - clientHeight < bottomThresholdRef.current;
        if (atBottom) {
          currentContainer.scrollTop = scrollHeight;
        } else {
          // User scrolled away, stop auto-scrolling
          shouldAutoScrollRef.current = false;
        }
      }
    });

    // Observe the scrollable content area.
    // NOTE: Using `container` (captured at effect start) here is intentional and correct.
    // Unlike the callback above (which reads containerRef.current for each invocation),
    // we observe the element that exists when the effect runs. If containerRef.current
    // changes, React will re-run this effect (due to containerRef in deps), the cleanup
    // will disconnect the observer, and we'll observe the new container. There is no
    // stale closure issue here because the effect lifecycle handles ref changes properly.
    const scrollContent = container.firstElementChild;
    if (scrollContent) {
      resizeObserver.observe(scrollContent);
    }
    resizeObserver.observe(container);

    return () => {
      isObserverActive = false;
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  return {
    isAtBottom,
    newItemsCount,
    handleScroll,
    handleNewItemsClick,
  };
}
