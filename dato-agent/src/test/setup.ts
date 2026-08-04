import '@testing-library/jest-dom/vitest';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver;

// ProseMirror asks the browser for caret geometry while typing. JSDOM does not
// implement these layout APIs, so give editor tests deterministic empty bounds.
Object.defineProperty(document, 'elementFromPoint', {
  configurable: true,
  value: () => null,
});

Object.defineProperty(Range.prototype, 'getClientRects', {
  configurable: true,
  value: () => [] as unknown as DOMRectList,
});

Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => new DOMRect(),
});
