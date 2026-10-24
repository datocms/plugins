import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

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

// jsdom has no layout. The kit measures elements and follows media queries
// (some of it as it loads), so these only need to exist.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver =
  NoopObserver as unknown as typeof IntersectionObserver;

window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
