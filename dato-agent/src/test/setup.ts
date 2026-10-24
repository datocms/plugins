import '@testing-library/jest-dom/vitest';

// Node 25+ ships its own `localStorage` and `sessionStorage` globals, and the
// Vitest 4 jsdom environment does not replace globals that already exist. Point
// both back at jsdom's Storage, as on Node 24 and earlier, so tests keep using
// the same Storage that `window`, `Storage.prototype` and `StorageEvent` use.
const jsdomWindow = (
  globalThis as typeof globalThis & { jsdom?: { window: Window } }
).jsdom?.window;
if (jsdomWindow) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get: () => jsdomWindow[key],
    });
  }
}

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver;

// jsdom has no media queries. The components of datocms-react-ui read them
// (hover support, reduced motion, the frame width), so answer "no match".
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (media: string): MediaQueryList =>
    ({
      matches: false,
      media,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList,
});

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
