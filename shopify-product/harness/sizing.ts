import type { IframeMethods, SizingUtilities } from 'datocms-plugin-sdk';

/**
 * A stand-in for the SDK's auto-resizer (SDK 2.5.0 `buildSizingUtilities`),
 * measuring exactly like it does. Instead of posting the height to the
 * dashboard, it sets the height of this (same-origin) iframe element.
 */
export type FrameSizing = SizingUtilities & IframeMethods;

function lowestElementBottom(): number {
  let bottom = 0;
  for (const element of document.querySelectorAll('body *')) {
    bottom = Math.max(bottom, element.getBoundingClientRect().bottom);
  }
  return bottom;
}

function measure(): number {
  return Math.max(
    document.body.scrollHeight,
    document.body.offsetHeight,
    document.documentElement.getBoundingClientRect().height,
    lowestElementBottom(),
  );
}

function setFrameHeight(height: number): void {
  // Same-origin, so the host's <iframe> is reachable. It lives in the host's
  // realm, hence no `instanceof HTMLElement` check.
  const frame = window.frameElement as HTMLElement | null;
  frame?.style.setProperty('height', `${Math.ceil(height)}px`);
}

/**
 * `fixed` frames (full-width modals) ignore heights, as the host does there.
 */
export function createFrameSizing({ fixed }: { fixed: boolean }): FrameSizing {
  let lastHeight: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;

  const setHeight = async (height: number) => {
    if (!fixed) {
      setFrameHeight(height);
    }
  };

  const updateHeight = (height?: number) => {
    const next = height ?? measure();
    if (next !== lastHeight) {
      lastHeight = next;
      void setHeight(next);
    }
  };

  const onChange = () => updateHeight();

  const startAutoResizer = () => {
    updateHeight();
    resizeObserver ??= new ResizeObserver(onChange);
    resizeObserver.observe(document.documentElement);
    if (!mutationObserver) {
      mutationObserver = new MutationObserver(onChange);
      mutationObserver.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  };

  const stopAutoResizer = () => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    mutationObserver?.disconnect();
    mutationObserver = null;
  };

  return {
    setHeight,
    updateHeight,
    startAutoResizer,
    stopAutoResizer,
    isAutoResizerActive: () => resizeObserver !== null,
  };
}
