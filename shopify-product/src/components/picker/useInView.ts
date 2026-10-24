import { type RefObject, useEffect, useState } from 'react';

const SCROLLING = /(auto|scroll|overlay)/;

/**
 * The element that scrolls `element` (the content of the picker's Pane), or
 * null for the page itself.
 */
export function scrollParent(element: Element | null): HTMLElement | null {
  for (
    let node = element?.parentElement ?? null;
    node && node !== document.body;
    node = node.parentElement
  ) {
    if (SCROLLING.test(window.getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/**
 * True while `target` is within `rootMargin` of the box that scrolls it. Uses
 * the native IntersectionObserver; without one (old browsers) it stays false
 * and the visible "Load more" button does the job.
 */
export function useInView(
  target: RefObject<HTMLElement | null>,
  options: { rootMargin?: string; enabled?: boolean } = {},
): boolean {
  const { rootMargin = '240px', enabled = true } = options;
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = target.current;
    if (!enabled || !element || typeof IntersectionObserver === 'undefined') {
      setInView(false);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setInView(entry.isIntersecting);
      },
      { root: scrollParent(element), rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, rootMargin, enabled]);

  return inView;
}
