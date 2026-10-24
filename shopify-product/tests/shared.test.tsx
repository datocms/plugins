import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import Canvas from 'datocms-react-ui/Canvas';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AvailabilityBadge, {
  availabilityDotTone,
  availabilityText,
} from '../src/components/shared/AvailabilityBadge';
import PriceTag from '../src/components/shared/PriceTag';
import Thumbnail from '../src/components/shared/Thumbnail';
import { useDeepStable } from '../src/components/shared/useDeepStable';
import {
  getShopifyClient,
  resetShopifyClients,
} from '../src/lib/shopifyClient';
import type { ShopifyNode } from '../src/types';
import { DEMO_STORE } from '../src/types';

afterEach(() => {
  cleanup();
  resetShopifyClients();
});

const ctx = {
  ui: { locale: 'en' },
  site: { attributes: { internal_domain: null } },
  colorScheme: 'light',
  cssDesignTokens: {},
  bodyPadding: [0, 0, 0, 0],
} as unknown as Parameters<typeof Canvas>[0]['ctx'];

function inCanvas(children: ReactNode) {
  return render(<Canvas ctx={ctx}>{children}</Canvas>);
}

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

  it('shows the fallback without an image, and when the image fails', () => {
    const { container, rerender } = render(
      <Thumbnail image={null} fallback={<span>no image</span>} />,
    );
    expect(screen.getByText('no image')).toBeInTheDocument();

    rerender(
      <Thumbnail
        image={{ url: 'https://cdn.shopify.com/a.png', altText: null }}
        fallback={<span>no image</span>}
      />,
    );
    expect(screen.queryByText('no image')).toBeNull();
    const image = container.querySelector('img');
    if (!image) throw new Error('No image');
    fireEvent.error(image);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('no image')).toBeInTheDocument();
  });
});

function product(overrides: Record<string, unknown> = {}): ShopifyNode {
  return {
    __typename: 'Product',
    availableForSale: true,
    totalInventory: 12,
    priceRange: {
      minVariantPrice: { amount: '10.0', currencyCode: 'EUR' },
      maxVariantPrice: { amount: '10.0', currencyCode: 'EUR' },
    },
    compareAtPriceRange: {
      maxVariantPrice: { amount: '15.0', currencyCode: 'EUR' },
    },
    ...overrides,
  } as unknown as ShopifyNode;
}

describe('AvailabilityBadge', () => {
  it('says the state next to its dot, with the stock count only with inventory', () => {
    const { container, rerender } = inCanvas(
      <AvailabilityBadge node={product()} locale="en" />,
    );
    expect(container).toHaveTextContent('Available');
    expect(container).not.toHaveTextContent('in stock');
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    rerender(
      <Canvas ctx={ctx}>
        <AvailabilityBadge node={product()} locale="en" inventory />
      </Canvas>,
    );
    expect(container).toHaveTextContent('Available · 12 in stock');
  });

  it('renders nothing for collections', () => {
    const { container } = inCanvas(
      <AvailabilityBadge
        node={{ __typename: 'Collection' } as unknown as ShopifyNode}
        locale="en"
      />,
    );
    expect(container.querySelector('.Canvas')).toBeEmptyDOMElement();
  });

  it('maps availability to the tones of FeedbackDot and StatusCell', () => {
    expect(availabilityDotTone('success')).toBe('success');
    expect(availabilityDotTone('danger')).toBe('danger');
    expect(availabilityDotTone('neutral')).toBe('neutral');
    expect(
      availabilityText({ label: 'Sold out', tone: 'danger', quantity: 0 }),
    ).toBe('Sold out · 0 in stock');
    expect(
      availabilityText({ label: 'Available', tone: 'success', quantity: null }),
    ).toBe('Available');
  });

  it('writes the stock count with the separators of the locale', () => {
    const status = {
      label: 'Available',
      tone: 'success',
      quantity: 1200,
    } as const;
    expect(availabilityText(status, 'en')).toBe('Available · 1,200 in stock');
    expect(availabilityText(status, 'de')).toBe('Available · 1.200 in stock');
  });
});

describe('PriceTag', () => {
  it('strikes the compare-at price through and names it for screen readers', () => {
    const { container } = render(
      <PriceTag
        price={{
          min: { amount: '10.0', currencyCode: 'EUR' },
          max: { amount: '10.0', currencyCode: 'EUR' },
          compareAt: { amount: '15.0', currencyCode: 'EUR' },
        }}
        locale="en"
      />,
    );
    const struck = container.querySelector('s');
    expect(struck).toHaveTextContent('Compare at €15.00');
    expect(screen.getByText('Compare at')).toHaveClass('visually-hidden');
    expect(container).toHaveTextContent('€10.00');
  });

  it('shows no compare-at price that does not beat the price', () => {
    const { container } = render(
      <PriceTag
        price={{
          min: { amount: '10.0', currencyCode: 'EUR' },
          max: { amount: '20.0', currencyCode: 'EUR' },
          compareAt: { amount: '20.0', currencyCode: 'EUR' },
        }}
        locale="en"
      />,
    );
    expect(container.querySelector('s')).toBeNull();
    expect(container).toHaveTextContent('€10.00 – €20.00');
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
