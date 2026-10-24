import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { useEffect, useRef } from 'react';

// The SDK auto-resizer takes the lowest bottom edge of every element on the
// page, including rows clipped inside a scrolling pane, so the frame grows to
// fit content nobody can see. Report the height of the Canvas box instead.
// Render <Canvas noAutoResizer> and put the returned ref on an element inside
// it.
export function useFrameHeight(ctx: RenderModalCtx) {
  const ref = useRef<HTMLDivElement>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    const element = ref.current;
    const canvas =
      element?.closest<HTMLElement>('[data-color-scheme]') ??
      element?.parentElement;
    if (!canvas || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      const { bottom } = canvas.getBoundingClientRect();
      ctxRef.current.updateHeight(Math.ceil(bottom + window.scrollY));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return ref;
}
