// Scrolling inside the picker's own scroll box. Element.scrollIntoView also
// scrolls the CMS's modal overlay that holds the frame (the dialog's header
// then goes under the top bar), so the picker moves only the nearest
// scrollable ancestor of an element: the content of its Pane.

const SCROLLING = new Set(['auto', 'scroll', 'overlay']);

/** The nearest ancestor of the element that scrolls vertically, or null */
export function scrollParent(element: Element | null): HTMLElement | null {
  for (
    let parent = element?.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (SCROLLING.has(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

/**
 * Scrolls the element's scroll parent as little as it takes to show the
 * element (block "nearest"): nothing when it is already in view.
 */
export function scrollToNearestEdge(element: Element | null): void {
  const container = scrollParent(element);
  if (!element || !container) return;

  const box = element.getBoundingClientRect();
  const view = container.getBoundingClientRect();
  if (box.top < view.top) {
    container.scrollTop -= view.top - box.top;
  } else if (box.bottom > view.bottom) {
    container.scrollTop += Math.min(
      box.bottom - view.bottom,
      box.top - view.top,
    );
  }
}
