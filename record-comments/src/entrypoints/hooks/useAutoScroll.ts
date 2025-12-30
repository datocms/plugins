import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type UseAutoScrollOptions = {
  containerRef: RefObject<HTMLDivElement | null>;
  itemsCount: number;
  /** Pixel threshold from bottom to consider "at bottom" (default: 50) */
  bottomThreshold?: number;
};

type UseAutoScrollReturn = {
  isAtBottom: boolean;
  newItemsCount: number;
  handleScroll: () => void;
  handleNewItemsClick: () => void;
};

export function useAutoScroll({
  containerRef,
  itemsCount,
  bottomThreshold = 50,
}: UseAutoScrollOptions): UseAutoScrollReturn {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newItemsCount, setNewItemsCount] = useState(0);

  const shouldAutoScrollRef = useRef(false);
  const prevItemsCountRef = useRef(itemsCount);
  const bottomThresholdRef = useRef(bottomThreshold);
  bottomThresholdRef.current = bottomThreshold;

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const atBottom = scrollHeight - scrollTop - clientHeight < bottomThreshold;
    setIsAtBottom(atBottom);

    if (atBottom) {
      setNewItemsCount(0);
    }
  }, [containerRef, bottomThreshold]);

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

  useEffect(() => {
    const newCount = itemsCount - prevItemsCountRef.current;
    const container = containerRef.current;

    if (newCount > 0) {
      if (isAtBottom && container) {
        shouldAutoScrollRef.current = true;
        container.scrollTop = container.scrollHeight;
      } else if (!isAtBottom) {
        setNewItemsCount(prev => prev + newCount);
      }
    }

    prevItemsCountRef.current = itemsCount;
  }, [itemsCount, isAtBottom, containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isObserverActive = true;

    const resizeObserver = new ResizeObserver(() => {
      const currentContainer = containerRef.current;
      if (!isObserverActive || !currentContainer || !currentContainer.isConnected) return;

      if (shouldAutoScrollRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = currentContainer;
        const atBottom = scrollHeight - scrollTop - clientHeight < bottomThresholdRef.current;
        if (atBottom) {
          currentContainer.scrollTop = scrollHeight;
        } else {
          shouldAutoScrollRef.current = false;
        }
      }
    });

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
