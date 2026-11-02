import {
  act,
  cleanup,
  fireEvent,
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
// portals the menu out of the field, takes focus and moves a highlight, and a
// pick doesn't give focus back by itself.

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
    colorScheme: 'light',
    site: { attributes: { internal_domain: null } },
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    notice: vi.fn().mockResolvedValue(undefined),
    customToast: vi.fn().mockResolvedValue(undefined),
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

function picked(nodes: ProductSummary[]) {
  return {
    selected: nodes.map((node) => ({
      key: node.id,
      id: node.id,
      node,
      fallbackLabel: '',
    })),
  };
}

function withValue(ctx: RenderFieldExtensionCtx, value: unknown) {
  return {
    ...ctx,
    formValues: { shopify_product: value },
  } as RenderFieldExtensionCtx;
}

/** The kit portals the menu in an effect, and closes it over 100 ms. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  });
}

/** The row's ⋮: where focus lands for that row. */
function trigger(title: string) {
  return screen.getByRole('button', { name: `Actions for ${title}` });
}

const KEY_CODES = { Enter: 13, Escape: 27, ArrowDown: 40 } as const;

/**
 * The kit's menus read the key code (`which`), which user-event leaves at 0
 * in jsdom: this presses a key on the focused element like a browser does.
 */
function press(key: keyof typeof KEY_CODES) {
  const code = KEY_CODES[key];
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key,
    code: key,
    keyCode: code,
    which: code,
  });
}

/**
 * Opens a row's ⋮ from the keyboard; the menu takes focus (its search field,
 * when it has more than 5 options).
 */
async function openMenuWithKeyboard(title: string) {
  act(() => trigger(title).focus());
  press('Enter');
  await waitFor(() =>
    expect(screen.getByRole('menu').contains(document.activeElement)).toBe(
      true,
    ),
  );
}

/** Moves the menu's highlight down to an option. */
function highlight(option: string) {
  const menu = screen.getByRole('menu');
  const target = within(menu).getByRole('menuitem', { name: option });
  // The menu, or its search field, holds the highlight.
  const active = document.activeElement;
  const holder =
    active instanceof HTMLElement && menu.contains(active) ? active : menu;
  for (let step = 0; step < 8; step += 1) {
    if (holder.getAttribute('aria-activedescendant') === target.id) break;
    press('ArrowDown');
  }
  expect(holder).toHaveAttribute('aria-activedescendant', target.id);
}

/**
 * Picks an option of a row's ⋮ with the keyboard only. The menu fades out
 * for 100ms, and a menu reopened meanwhile is the same one, which doesn't
 * take focus again: wait for it to leave.
 */
async function pickWithKeyboard(title: string, option: string) {
  await openMenuWithKeyboard(title);
  highlight(option);
  press('Enter');
  await settle();
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

describe('FieldExtension with the real kit: row menus', () => {
  it('open from the keyboard, name their row and close back to the trigger', async () => {
    const { ctx } = createCtx(document_([ALPHA, BRAVO]));
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('Bravo board');
    await openMenuWithKeyboard('Alpha board');
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((option) => option.textContent),
    ).toEqual(['Open in Shopify admin', 'Replace', 'Move down', 'Remove']);
    // The frame keeps room for the whole menu while it is open.
    expect(document.documentElement.style.minHeight).not.toBe('');
    press('Escape');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger('Alpha board')).toHaveFocus();
    expect(document.documentElement.style.minHeight).toBe('');
  });

  it('give focus back to the trigger after a link option', async () => {
    const { ctx } = createCtx(document_([ALPHA, BRAVO]));
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('Bravo board');
    // The link opens the admin in a new tab; the kit only closes the menu.
    await pickWithKeyboard('Alpha board', 'Open in Shopify admin');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger('Alpha board')).toHaveFocus();
  });

  it('give focus back to the trigger after a pick', async () => {
    const { ctx } = createCtx(document_([ALPHA, BRAVO]));
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('Bravo board');
    // Replace opens the picker, which the editor cancels.
    await pickWithKeyboard('Alpha board', 'Replace');
    await waitFor(() => expect(ctx.openModal).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger('Alpha board')).toHaveFocus();
  });
});

describe('FieldExtension with the real kit: reordering from the keyboard', () => {
  it('keeps focus on the moved row, in its new place', async () => {
    const value = document_([ALPHA, BRAVO, CHARLIE]);
    const { ctx, setFieldValue } = createCtx(value);
    const view = render(<FieldExtension ctx={ctx} />);
    await screen.findByText('Charlie board');
    await pickWithKeyboard('Alpha board', 'Move down');
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(trigger('Alpha board')).toHaveFocus();
    const rows = Array.from(document.querySelectorAll('[data-entry-row]'));
    expect(rows[1]).toContainElement(trigger('Alpha board'));
    // Screen readers hear where the row went, as dnd-kit used to say.
    expect(
      await screen.findByText('Moved Alpha board to position 2 of 3'),
    ).toHaveAttribute('role', 'status');

    view.rerender(
      <FieldExtension ctx={withValue(ctx, setFieldValue.mock.calls[0]?.[1])} />,
    );
    await settle();
    expect(trigger('Alpha board')).toHaveFocus();
    // The first row can now move down only to where it was.
    await pickWithKeyboard('Alpha board', 'Move up');
    await waitFor(() => expect(setFieldValue).toHaveBeenCalledTimes(2));
    expect(trigger('Alpha board')).toHaveFocus();
  });
});

describe('FieldExtension with the real kit: focus after actions', () => {
  async function removeWithKeyboard(title: string) {
    await pickWithKeyboard(title, 'Remove');
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

  it('moves from the empty slot\'s "Add products" to the first picked row', async () => {
    const { ctx, setFieldValue } = createCtx(null, picked([BRAVO, CHARLIE]));
    const view = render(<FieldExtension ctx={ctx} />);
    const browse = screen.getByRole('button', { name: /Add products/ });
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
    const update = await screen.findByRole('button', {
      name: 'Update address',
    });
    update.focus();
    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    view.rerender(
      <FieldExtension ctx={withValue(ctx, setFieldValue.mock.calls[0]?.[1])} />,
    );
    await settle();
    expect(screen.queryByRole('button', { name: 'Update address' })).toBeNull();
    expect(document.activeElement).toBe(trigger('Bravo board'));
  });

  it('moves from "Replace" to the row that replaced it', async () => {
    const { ctx, setFieldValue } = createCtx(
      document_([ALPHA, BRAVO]),
      picked([CHARLIE]),
    );
    const view = render(<FieldExtension ctx={ctx} />);
    await screen.findByText('Bravo board');
    await pickWithKeyboard('Bravo board', 'Replace');
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    view.rerender(
      <FieldExtension ctx={withValue(ctx, setFieldValue.mock.calls[0]?.[1])} />,
    );
    await settle();
    expect(screen.queryByText('Bravo board')).toBeNull();
    expect(document.activeElement).toBe(trigger('Charlie board'));
    expect(
      screen.getByText('Replaced Bravo board with Charlie board'),
    ).toHaveAttribute('role', 'status');
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

  it('moves from "Clear value" to the empty slot\'s "Add products"', async () => {
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
      screen.getByRole('button', { name: /Add products/ }),
    );
  });
});
