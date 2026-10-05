import { type RefObject, useEffect, useState } from 'react';

/**
 * True while `target` is within `rootMargin` of the `root` scroll box. Uses
 * the native IntersectionObserver; without one (old browsers, jsdom) it
 * stays false and the visible "Load more" button does the job.
 */
export function useInView(
  root: RefObject<HTMLElement | null>,
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
      { root: root.current, rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [root, target, rootMargin, enabled]);

  return inView;
}
