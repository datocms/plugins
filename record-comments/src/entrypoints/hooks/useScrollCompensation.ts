import { useRef, useCallback, type RefObject } from 'react';

type ScrollState = {
  scrollTop: number;
  scrollHeight: number;
};

/**
 * Hook that provides scroll position compensation during sync updates.
 * When new content is added above the current view, adjusts scroll
 * to keep the same content visible.
 */
export function useScrollCompensation<T extends HTMLElement>(containerRef: RefObject<T>) {
  const savedScrollState = useRef<ScrollState | null>(null);

  const onBeforeSync = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    savedScrollState.current = {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
    };
  }, [containerRef]);

  const onAfterSync = useCallback(() => {
    const container = containerRef.current;
    const saved = savedScrollState.current;
    if (!container || !saved) return;

    const newScrollHeight = container.scrollHeight;
    const heightDiff = newScrollHeight - saved.scrollHeight;

    // If content was added (height increased), adjust scroll to compensate
    if (heightDiff > 0) {
      container.scrollTop = saved.scrollTop + heightDiff;
    }

    savedScrollState.current = null;
  }, [containerRef]);

  return { onBeforeSync, onAfterSync };
}
