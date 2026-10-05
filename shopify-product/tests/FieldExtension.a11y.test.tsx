import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FieldExtension from '../src/entrypoints/FieldExtension';
import {
  getShopifyClient,
  type ShopifyClient,
  ShopifyClientError,
} from '../src/lib/shopifyClient';
import type { ProductSummary, ShopifyNode } from '../src/types';

// Keyboard and focus behaviour with the real datocms-react-ui: its Dropdown
// portals the menu and renders options as plain buttons, which a mocked kit
// can't reproduce.

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

vi.mock('../src/lib/shopifyClient', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/lib/shopifyClient')>();
  return { ...actual, getShopifyClient: vi.fn() };
});

const SHOP = 'datocms-demo.myshopify.com';

function product(id: number, title: string, handle: string): ProductSummary {
  return {
    __typename: 'Product',
    id: `gid://shopify/Product/${id}`,
    handle,
    title,
    vendor: 'Snowboard Vendor',
    productType: 'snowboard',
    availableForSale: true,
    onlineStoreUrl: null,
    updatedAt: '2026-07-18T23:38:42Z',
    featuredImage: null,
    priceRange: {
      minVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
      maxVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
    },
    compareAtPriceRange: {
      maxVariantPrice: { amount: '0.0', currencyCode: 'EUR' },
    },
    variantsCount: { count: 1 },
    sku: null,
  };
}

const ALPHA = product(11, 'Alpha board', 'alpha-board');
const BRAVO = product(12, 'Bravo board', 'bravo-board');
const CHARLIE = product(13, 'Charlie board', 'charlie-board');
const NODES = new Map<string, ShopifyNode>(
  [ALPHA, BRAVO, CHARLIE].map((node) => [node.id, node]),
);

function document_(nodes: ProductSummary[], handles?: string[]): string {
  return JSON.stringify({
    version: 1,
    shop: SHOP,
    kind: 'product',
    references: nodes.map((node, index) => ({
      id: node.id,
      handle: handles?.[index] ?? node.handle,
    })),
  });
}

function createClient() {
  const client = {
    shopDomain: SHOP,
    context: {},
    loadNodes: vi.fn(async (ids: string[]) =>
      ids.map((id) => NODES.get(id) ?? null),
    ),
    productByHandle: vi.fn(async () => null),
    collectionByHandle: vi.fn(async () => null),
    legacyProduct: vi.fn(async () => null),
    localization: vi.fn(),
    withContext: vi.fn(),
    hasKnownCapabilities: () => true,
    detectCapabilities: vi.fn(),
    effectiveCapabilities: () => ({
      tags: true,
      inventory: false,
      metafields: false,
    }),
  };
  client.withContext.mockImplementation((context: unknown) => ({
    ...client,
    context,
  }));
  return client;
}

let client: ReturnType<typeof createClient>;

beforeEach(() => {
  client = createClient();
  vi.mocked(getShopifyClient).mockReturnValue(
    client as unknown as ShopifyClient,
  );
});

afterEach(cleanup);

function createCtx(value: unknown, openModalResult: unknown = null) {
  const setFieldValue = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    mode: 'renderFieldExtension',
    theme: {},
    cssDesignTokens: {},
    bodyPadding: [0, 0, 0, 0],
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    parameters: {
      paramsVersion: '1',
      kind: 'product',
      cardinality: 'multiple',
      format: 'reference',
      snapshot: false,
    },
    plugin: {
      id: 'plugin-1',
      attributes: {
        parameters: {
          paramsVersion: '3',
          stores: [],
          useDemoStore: true,
          autoApplyToFieldsWithApiKey: '',
        },
      },
    },
    field: {
      attributes: {
        field_type: 'json',
        localized: false,
        label: 'Shopify product',
        api_key: 'shopify_product',
      },
    },
    fieldPath: 'shopify_product',
    formValues: { shopify_product: value },
    disabled: false,
    locale: 'en',
    ui: { locale: 'en' },
    environment: 'main',
    isEnvironmentPrimary: true,
    currentRole: { meta: { final_permissions: { can_edit_schema: true } } },
    setFieldValue,
    openModal: vi.fn().mockResolvedValue(openModalResult),
    openConfirm: vi.fn().mockResolvedValue(true),
    alert: vi.fn().mockResolvedValue(undefined),
    navigateTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as RenderFieldExtensionCtx;
  return { ctx, setFieldValue };
}

function withValue(ctx: RenderFieldExtensionCtx, value: unknown) {
  return {
    ...ctx,
    formValues: { shopify_product: value },
  } as RenderFieldExtensionCtx;
}

/** The kit portals the menu in an effect; the menu hook decorates it next. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  });
}

/** The row's first action: where focus lands for that row. */
function trigger(title: string) {
  const group = screen.getByRole('group', { name: `Actions for ${title}` });
  return within(group).getAllByRole('button')[0] as HTMLElement;
}

function rowAction(title: string, name: string) {
  const group = screen.getByRole('group', { name: `Actions for ${title}` });
  return within(group).getByRole('button', { name });
}

describe('FieldExtension with the real kit: row actions', () => {
  it('are named buttons in the tab order, with no menu', async () => {
    const { ctx } = createCtx(document_([ALPHA, BRAVO]));
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('Bravo board');
    const user = userEvent.setup();
    trigger('Alpha board').focus();
    expect(document.activeElement).toBe(
      rowAction('Alpha board', 'Open in Shopify admin'),
    );
    await user.tab();
    expect(document.activeElement).toBe(rowAction('Alpha board', 'Replace'));
    await user.tab();
    expect(document.activeElement).toBe(rowAction('Alpha board', 'Remove'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Actions for/ }),
    ).not.toBeInTheDocument();
  });
});

describe('FieldExtension with the real kit: focus after actions', () => {
  async function removeWithKeyboard(title: string) {
    const user = userEvent.setup();
    rowAction(title, 'Remove').focus();
    await user.keyboard('{Enter}');
    await settle();
  }

  it('moves to the row that takes the removed one’s place', async () => {
    const value = document_([ALPHA, BRAVO, CHARLIE]);
    const { ctx, setFieldValue } = createCtx(value);
    const view = render(<FieldExtension ctx={ctx} />);
    await screen.findByText('Charlie board');
    await removeWithKeyboard('Alpha board');
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());

    view.rerender(
      <FieldExtension ctx={withValue(ctx, setFieldValue.mock.calls[0]?.[1])} />,
    );
    await settle();
    expect(screen.queryByText('Alpha board')).toBeNull();
    expect(document.activeElement).toBe(trigger('Bravo board'));
    expect(screen.getByText('Removed Alpha board')).toHaveAttribute(
      'role',
      'status',
    );
  });

  it('moves to the row before when the last one is removed', async () => {
    const { ctx, setFieldValue } = createCtx(document_([ALPHA, BRAVO]));
    const view = render(<FieldExtension ctx={ctx} />);
    await screen.findByText('Bravo board');
    await removeWithKeyboard('Bravo board');
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    view.rerender(
      <FieldExtension ctx={withValue(ctx, setFieldValue.mock.calls[0]?.[1])} />,
    );
    await settle();
    expect(document.activeElement).toBe(trigger('Alpha board'));
  });

  it('moves from "Browse Shopify" to the first picked row', async () => {
    const picked = {
      selected: [BRAVO, CHARLIE].map((node) => ({
        key: node.id,
        id: node.id,
        node,
        fallbackLabel: '',
      })),
    };
    const { ctx, setFieldValue } = createCtx(null, picked);
    const view = render(<FieldExtension ctx={ctx} />);
    const browse = screen.getByRole('button', { name: 'Browse Shopify' });
    browse.focus();
    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    // The button that started the pick keeps focus while it runs.
    expect(document.activeElement).toBe(browse);

    view.rerender(
      <FieldExtension ctx={withValue(ctx, setFieldValue.mock.calls[0]?.[1])} />,
    );
    await settle();
    expect(document.activeElement).toBe(trigger('Bravo board'));
    expect(screen.getByText('Added 2 products')).toBeInTheDocument();
  });

  it('moves from "Update" to its row', async () => {
    const { ctx, setFieldValue } = createCtx(
      document_([ALPHA, BRAVO], ['alpha-board', 'bravo-2024']),
    );
    const view = render(<FieldExtension ctx={ctx} />);
    const update = await screen.findByRole('button', { name: 'Update' });
    update.focus();
    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    view.rerender(
      <FieldExtension ctx={withValue(ctx, setFieldValue.mock.calls[0]?.[1])} />,
    );
    await settle();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    expect(document.activeElement).toBe(trigger('Bravo board'));
  });

  it('moves from "Try again" to the first row once Shopify answers', async () => {
    client.loadNodes.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    const { ctx } = createCtx(document_([ALPHA, BRAVO]));
    render(<FieldExtension ctx={ctx} />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.focus();
    await userEvent.setup().keyboard('{Enter}');
    await screen.findByText('Alpha board');
    await settle();
    expect(document.activeElement).toBe(trigger('Alpha board'));
  });

  it('moves from "Clear value" to "Browse Shopify"', async () => {
    const { ctx, setFieldValue } = createCtx('{nope');
    const view = render(<FieldExtension ctx={ctx} />);
    const clear = screen.getByRole('button', { name: 'Clear value' });
    clear.focus();
    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith('shopify_product', null),
    );
    view.rerender(<FieldExtension ctx={withValue(ctx, null)} />);
    await settle();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Browse Shopify' }),
    );
  });
});
