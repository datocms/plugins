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

class ResizeObserverMock implements ResizeObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: ResizeObserverMock,
});

// The kit's menus and tooltips watch their anchors with an
// IntersectionObserver, which jsdom does not have.
class IntersectionObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(globalThis, 'IntersectionObserver', {
  configurable: true,
  writable: true,
  value: IntersectionObserverMock,
});

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
