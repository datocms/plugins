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

// datocms-react-ui measures with these and asks for media queries, and jsdom
// has none of them. A test file that needs one to do something (an
// IntersectionObserver that reports entries, a matching media query) assigns
// its own over these.
class ObserverStub {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ObserverStub,
  });
}

if (!('IntersectionObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: ObserverStub,
  });
}

// jsdom has a `matchMedia` key that holds undefined: test the value.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Dropdown menus and Table rows scroll their active element into view.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
