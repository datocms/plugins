import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { Canvas } from 'datocms-react-ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Thumbnail from '../src/components/shared/Thumbnail';
import Tip from '../src/components/shared/Tip';
import { useDeepStable } from '../src/components/shared/useDeepStable';
import {
  getShopifyClient,
  resetShopifyClients,
} from '../src/lib/shopifyClient';
import { DEMO_STORE } from '../src/types';

// datocms-react-ui measures with these (some at import time); jsdom has neither.
vi.hoisted(() => {
  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.assign(globalThis, {
    IntersectionObserver: ObserverStub,
    ResizeObserver: ObserverStub,
  });
});

afterEach(() => {
  cleanup();
  resetShopifyClients();
});

const ctx = {
  theme: {},
  cssDesignTokens: {},
  bodyPadding: [0, 0, 0, 0],
} as unknown as Parameters<typeof Canvas>[0]['ctx'];

const SCENE =
  'Top and bottom view of a snowboard. The top view shows 7 stacked hexagons.';

describe('Thumbnail', () => {
  it('is decorative, whatever alt text Shopify has', () => {
    const { container } = render(
      <Thumbnail
        image={{ url: 'https://cdn.shopify.com/a.png', altText: SCENE }}
      />,
    );
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('takes an explicit alt for a standalone image', () => {
    render(
      <Thumbnail
        image={{ url: 'https://cdn.shopify.com/a.png', altText: SCENE }}
        alt="Hydro board"
      />,
    );
    expect(
      screen.getByRole('img', { name: 'Hydro board' }),
    ).toBeInTheDocument();
  });
});

describe('Tip', () => {
  it('renders the children alone without a tip', () => {
    const { container } = render(
      <Tip tip={null}>
        <button type="button">Add</button>
      </Tip>,
    );
    expect(container.innerHTML).toBe('<button type="button">Add</button>');
  });

  it('can make a focusable anchor around a disabled button', () => {
    render(
      <Canvas ctx={ctx}>
        <Tip tip="You reached the maximum" anchor="focusable">
          <button type="button" disabled>
            Add
          </button>
        </Tip>
      </Canvas>,
    );
    const anchor = screen.getByRole('button', { name: 'Add' }).parentElement;
    expect(anchor).toHaveClass('dl-tooltip-anchor');
    expect(anchor).toHaveAttribute('tabindex', '0');
  });
});

describe('useDeepStable', () => {
  it('keeps the previous reference while the value is deeply equal', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDeepStable(value),
      { initialProps: { value: { kind: 'product', tags: ['a'] } } },
    );
    const first = result.current;
    rerender({ value: { kind: 'product', tags: ['a'] } });
    expect(result.current).toBe(first);
    rerender({ value: { kind: 'product', tags: ['b'] } });
    expect(result.current).not.toBe(first);
    expect(result.current.tags).toEqual(['b']);
  });
});

describe('DEMO_STORE', () => {
  it('knows its capabilities, so nothing has to probe for them', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = getShopifyClient(DEMO_STORE);
    expect(client.effectiveCapabilities()).toEqual({
      tags: true,
      inventory: false,
      // What detection reports: there is no metafields scope to detect.
      metafields: false,
    });
    expect(client.hasKnownCapabilities()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
