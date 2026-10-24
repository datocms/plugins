/**
 * useFrameHeight.ts
 * -----------------
 * Sizes a modal frame that holds a scrolling box. The SDK auto-resizer takes
 * the lowest bottom edge of every element on the page, including the rows
 * clipped inside a scrolling box, so the frame would grow to fit content
 * nobody can see. This hook reports the height of the Canvas box instead.
 *
 * Render the frame with `noAutoResizer` (see main.tsx) and put the returned
 * ref on an element inside the Canvas.
 */
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { useEffect, useRef } from 'react';

/**
 * Keeps the frame as tall as the Canvas box around the returned ref.
 *
 * When the component unmounts, the SDK auto-resizer takes over again. A
 * component that throws in its first render never runs this effect: the
 * ErrorBoundary fallback then starts the auto-resizer itself, so the
 * fallback gets a frame of its height in both cases.
 *
 * @param ctx - The modal's ctx, whose `updateHeight` sets the frame height.
 * @returns A ref for an element inside the Canvas.
 */
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
      // Nothing to measure: let the SDK size the frame as usual.
      ctxRef.current.startAutoResizer();
      return () => ctxRef.current.stopAutoResizer();
    }

    ctxRef.current.stopAutoResizer();
    const observer = new ResizeObserver(() => {
      const { bottom } = canvas.getBoundingClientRect();
      ctxRef.current.updateHeight(Math.ceil(bottom + window.scrollY));
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      ctxRef.current.startAutoResizer();
    };
  }, []);

  return ref;
}
