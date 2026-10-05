import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FieldExtension from '../src/entrypoints/FieldExtension';
import {
  buildLegacyProductJson,
  serializeLegacyProductJson,
} from '../src/lib/legacy';
import {
  getShopifyClient,
  type ShopifyClient,
  ShopifyClientError,
} from '../src/lib/shopifyClient';
import type {
  CollectionSummary,
  LegacyProductNode,
  PickerModalParameters,
  ProductSummary,
  ShopifyNode,
  VariantSummary,
} from '../src/types';
import legacy1xText from './fixtures/legacy-1x-product.json?raw';
import legacyBase64Text from './fixtures/legacy-base64-id.json?raw';
import legacyCropCenterText from './fixtures/legacy-crop-center-image.json?raw';
import legacyNodeFixture from './fixtures/legacy-product-node-2026-10.json';

vi.mock('datocms-react-ui', async () => {
  const { useState } = await import('react');
  type ButtonProps = {
    children?: ReactNode;
    disabled?: boolean;
    leftIcon?: ReactNode;
    onClick?: () => void;
  };
  return {
    Canvas: ({ children }: { children: ReactNode }) => <>{children}</>,
    Button: ({ children, disabled, leftIcon, onClick }: ButtonProps) => (
      <button type="button" disabled={disabled} onClick={onClick}>
        {leftIcon}
        {children}
      </button>
    ),
    ButtonLink: ({ children }: { children: ReactNode }) => (
      <a href="/">{children}</a>
    ),
    Spinner: () => <span data-testid="spinner" />,
    Dropdown: ({
      renderTrigger,
      children,
    }: {
      renderTrigger: (ctx: { open: boolean; onClick: () => void }) => ReactNode;
      children: ReactNode;
    }) => {
      const [open, setOpen] = useState(false);
      return (
        <div>
          {renderTrigger({ open, onClick: () => setOpen((value) => !value) })}
          {open && children}
        </div>
      );
    },
    DropdownMenu: ({ children }: { children: ReactNode }) => (
      <div role="menu">{children}</div>
    ),
    DropdownOption: ({
      children,
      disabled,
      onClick,
    }: ButtonProps & { red?: boolean }) => (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    ),
    DropdownSeparator: () => <hr />,
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: ReactNode }) => (
      <span role="tooltip">{children}</span>
    ),
  };
});

vi.mock('../src/lib/shopifyClient', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/lib/shopifyClient')>();
  return { ...actual, getShopifyClient: vi.fn() };
});

// ---------------------------------------------------------------------------
// Demo-store data
// ---------------------------------------------------------------------------

const SHOP = 'datocms-demo.myshopify.com';
const COMPLETE_ID = 'gid://shopify/Product/10080752009562';
const COMPARE_ID = 'gid://shopify/Product/10080751911258';
const OUT_OF_STOCK_ID = 'gid://shopify/Product/10080751747418';
const VARIANT_ID = 'gid://shopify/ProductVariant/50698337681754';
const COLLECTION_ID = 'gid://shopify/Collection/645261132122';
const MISSING_ID = 'gid://shopify/Product/1';
const LEGACY_NODE = legacyNodeFixture as LegacyProductNode;
const LEGACY_1X = JSON.stringify(JSON.parse(legacy1xText));

function product(
  id: string,
  title: string,
  handle: string,
  overrides: Partial<ProductSummary> = {},
): ProductSummary {
  return {
    __typename: 'Product',
    id,
    handle,
    title,
    vendor: 'Snowboard Vendor',
    productType: 'snowboard',
    availableForSale: true,
    onlineStoreUrl: null,
    updatedAt: '2026-07-18T23:38:42Z',
    featuredImage: {
      url: `https://cdn.shopify.com/${handle}.jpg`,
      altText: null,
    },
    priceRange: {
      minVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
      maxVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
    },
    compareAtPriceRange: {
      maxVariantPrice: { amount: '0.0', currencyCode: 'EUR' },
    },
    variantsCount: { count: 1 },
    sku: null,
    ...overrides,
  };
}

const COMPLETE = product(
  COMPLETE_ID,
  'The Complete Snowboard',
  'the-complete-snowboard',
);
const COMPARE = product(
  COMPARE_ID,
  'The Compare at Price Snowboard',
  'the-compare-at-price-snowboard',
  {
    priceRange: {
      minVariantPrice: { amount: '785.95', currencyCode: 'EUR' },
      maxVariantPrice: { amount: '785.95', currencyCode: 'EUR' },
    },
    compareAtPriceRange: {
      maxVariantPrice: { amount: '885.95', currencyCode: 'EUR' },
    },
  },
);
const OUT_OF_STOCK = product(
  OUT_OF_STOCK_ID,
  'The Out of Stock Snowboard',
  'the-out-of-stock-snowboard',
  { availableForSale: false },
);
const ICE: VariantSummary = {
  __typename: 'ProductVariant',
  id: VARIANT_ID,
  title: 'Ice',
  sku: 'BOARD-ICE',
  barcode: null,
  availableForSale: true,
  currentlyNotInStock: false,
  selectedOptions: [{ name: 'Color', value: 'Ice' }],
  price: { amount: '699.95', currencyCode: 'EUR' },
  compareAtPrice: null,
  image: null,
  product: {
    id: COMPLETE_ID,
    handle: 'the-complete-snowboard',
    title: 'The Complete Snowboard',
    vendor: 'Snowboard Vendor',
    onlineStoreUrl: null,
    featuredImage: null,
  },
};
const HYDROGEN: CollectionSummary = {
  __typename: 'Collection',
  id: COLLECTION_ID,
  handle: 'hydrogen',
  title: 'Hydrogen',
  updatedAt: '2026-07-19T00:46:43Z',
  onlineStoreUrl: null,
  image: null,
};

const NODES: Record<string, ShopifyNode> = {
  [COMPLETE_ID]: COMPLETE,
  [COMPARE_ID]: COMPARE,
  [OUT_OF_STOCK_ID]: OUT_OF_STOCK,
  [VARIANT_ID]: ICE,
  [COLLECTION_ID]: HYDROGEN,
};

function referenceDocument(
  kind: 'product' | 'variant' | 'collection',
  references: unknown[],
  shop = SHOP,
): string {
  return JSON.stringify({ version: 1, shop, kind, references }, null, 2);
}

const THREE_PRODUCTS = referenceDocument('product', [
  { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
  { id: COMPARE_ID, handle: 'the-compare-at-price-snowboard' },
  { id: OUT_OF_STOCK_ID, handle: 'the-out-of-stock-snowboard' },
]);

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function createClient() {
  const client = {
    shopDomain: SHOP,
    context: {},
    loadNodes: vi.fn(
      async (ids: string[]): Promise<Array<ShopifyNode | null>> =>
        ids.map((id) => NODES[id] ?? null),
    ),
    productByHandle: vi.fn(
      async (handle: string) =>
        Object.values(NODES).find(
          (node): node is ProductSummary =>
            node.__typename === 'Product' && node.handle === handle,
        ) ?? null,
    ),
    collectionByHandle: vi.fn(async (handle: string) =>
      handle === 'hydrogen' ? HYDROGEN : null,
    ),
    legacyProduct: vi.fn(async () => LEGACY_NODE),
    localization: vi.fn(async () => ({
      country: { isoCode: 'IT' },
      language: { isoCode: 'EN' },
      availableCountries: [],
      availableLanguages: [
        { isoCode: 'EN', endonymName: 'English' },
        { isoCode: 'IT', endonymName: 'Italiano' },
      ],
    })),
    withContext: vi.fn(),
    hasKnownCapabilities: vi.fn(() => true),
    detectCapabilities: vi.fn(),
    effectiveCapabilities: vi.fn(() => ({
      tags: true,
      inventory: false,
      metafields: false,
    })),
  };
  client.withContext.mockImplementation((context: unknown) => ({
    ...client,
    context,
  }));
  return client;
}

let client: ReturnType<typeof createClient>;

beforeEach(() => {
  vi.clearAllMocks();
  client = createClient();
  vi.mocked(getShopifyClient).mockReturnValue(
    client as unknown as ShopifyClient,
  );
});

afterEach(() => {
  cleanup();
});

type CtxOptions = {
  fieldType?: string;
  value?: unknown;
  parameters?: Record<string, unknown>;
  pluginParameters?: Record<string, unknown>;
  disabled?: boolean;
  localized?: boolean;
  canEditSchema?: boolean;
  isEnvironmentPrimary?: boolean;
  openModalResult?: unknown;
  confirm?: unknown;
};

const DEMO_PLUGIN_PARAMETERS = {
  paramsVersion: '3',
  stores: [],
  useDemoStore: true,
  autoApplyToFieldsWithApiKey: '',
};

function multiple(overrides: Record<string, unknown> = {}) {
  return {
    paramsVersion: '1',
    kind: 'product',
    cardinality: 'multiple',
    format: 'reference',
    snapshot: false,
    ...overrides,
  };
}

function single(overrides: Record<string, unknown> = {}) {
  return multiple({ cardinality: 'single', ...overrides });
}

function createCtx(options: CtxOptions = {}) {
  const setFieldValue = vi.fn().mockResolvedValue(undefined);
  const openModal = vi.fn().mockResolvedValue(options.openModalResult ?? null);
  const openConfirm = vi
    .fn()
    .mockResolvedValue('confirm' in options ? options.confirm : true);
  const alert = vi.fn().mockResolvedValue(undefined);
  const navigateTo = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    parameters: options.parameters ?? {},
    plugin: {
      id: 'plugin-1',
      attributes: {
        parameters: options.pluginParameters ?? DEMO_PLUGIN_PARAMETERS,
      },
    },
    field: {
      attributes: {
        field_type: options.fieldType ?? 'json',
        localized: options.localized ?? false,
        label: 'Shopify product',
        api_key: 'shopify_product',
      },
    },
    fieldPath: 'shopify_product',
    formValues: { shopify_product: options.value ?? null },
    disabled: options.disabled ?? false,
    locale: 'it',
    ui: { locale: 'en' },
    environment: 'feature-x',
    isEnvironmentPrimary: options.isEnvironmentPrimary ?? true,
    currentRole: {
      meta: {
        final_permissions: { can_edit_schema: options.canEditSchema ?? true },
      },
    },
    setFieldValue,
    openModal,
    openConfirm,
    alert,
    navigateTo,
  } as unknown as RenderFieldExtensionCtx;
  return { ctx, setFieldValue, openModal, openConfirm, alert, navigateTo };
}

function withValue(
  ctx: RenderFieldExtensionCtx,
  value: unknown,
): RenderFieldExtensionCtx {
  return {
    ...ctx,
    formValues: { shopify_product: value },
  } as RenderFieldExtensionCtx;
}

function pickerResult(nodes: Array<ShopifyNode | null>, keys: string[] = []) {
  return {
    selected: nodes.map((node, index) => ({
      key: node?.id ?? keys[index] ?? '',
      id: node?.id ?? keys[index] ?? null,
      node,
      fallbackLabel: node ? '' : (keys[index] ?? ''),
    })),
  };
}

function writtenDocument(setFieldValue: ReturnType<typeof vi.fn>) {
  const calls = setFieldValue.mock.calls;
  const value = calls[calls.length - 1]?.[1];
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/** The row's inline action buttons. */
async function openRowMenu(title: string) {
  return screen.getByRole('group', { name: `Actions for ${title}` });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FieldExtension: setup states', () => {
  it.each([
    [single(), 'No product selected'],
    [multiple(), 'No products selected'],
    [single({ kind: 'variant' }), 'No variant selected'],
    [multiple({ kind: 'collection' }), 'No collections selected'],
  ])('shows an empty state with Browse Shopify', (parameters, label) => {
    const { ctx } = createCtx({ parameters });
    render(<FieldExtension ctx={ctx} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Browse Shopify' }),
    ).toBeInTheDocument();
    expect(client.loadNodes).not.toHaveBeenCalled();
  });

  it('treats a 1.x string field as one product saved as a handle', () => {
    const { ctx } = createCtx({ fieldType: 'string' });
    render(<FieldExtension ctx={ctx} />);
    expect(screen.getByText('No product selected')).toBeInTheDocument();
  });

  it('points schema editors to the plugin settings, with the sandbox prefix, without calling Shopify', () => {
    const { ctx, navigateTo } = createCtx({
      value: THREE_PRODUCTS,
      parameters: multiple(),
      isEnvironmentPrimary: false,
      pluginParameters: { ...DEMO_PLUGIN_PARAMETERS, useDemoStore: false },
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      screen.getByText(
        'Connect a Shopify store to start picking from your catalog',
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Open plugin settings' }),
    );
    expect(navigateTo).toHaveBeenCalledWith(
      '/environments/feature-x/configuration/plugins/plugin-1/edit',
    );
    expect(getShopifyClient).not.toHaveBeenCalled();
  });

  it('asks other roles to contact an administrator', () => {
    const { ctx } = createCtx({
      canEditSchema: false,
      pluginParameters: { ...DEMO_PLUGIN_PARAMETERS, useDemoStore: false },
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      screen.getByText('Ask an administrator to connect a Shopify store'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open plugin settings' }),
    ).not.toBeInTheDocument();
  });

  it("explains when the field's store is no longer connected", () => {
    const { ctx, navigateTo } = createCtx({
      parameters: multiple({ shopDomain: 'acme-outlet.myshopify.com' }),
      pluginParameters: {
        paramsVersion: '3',
        stores: [
          {
            shopDomain: SHOP,
            storefrontAccessToken: '6f39fb123179b7d636d84d833d3d3adf',
            tokenless: false,
          },
        ],
        useDemoStore: false,
        autoApplyToFieldsWithApiKey: '',
      },
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      screen.getByText(
        "This field uses acme-outlet.myshopify.com, which isn't connected to the plugin",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Open plugin settings' }),
    );
    expect(navigateTo).toHaveBeenCalledWith(
      '/configuration/plugins/plugin-1/edit',
    );
  });

  it('asks other roles to reconnect a missing store', () => {
    const { ctx } = createCtx({
      canEditSchema: false,
      parameters: multiple({ shopDomain: 'acme-outlet.myshopify.com' }),
      pluginParameters: {
        paramsVersion: '3',
        stores: [
          {
            shopDomain: SHOP,
            storefrontAccessToken: '6f39fb123179b7d636d84d833d3d3adf',
            tokenless: false,
          },
        ],
        useDemoStore: false,
        autoApplyToFieldsWithApiKey: '',
      },
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      screen.getByText(
        "This field uses acme-outlet.myshopify.com, which isn't connected to the plugin. Ask an administrator to connect it again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open plugin settings' }),
    ).toBeNull();
  });

  it('refuses field types it does not support', () => {
    const { ctx } = createCtx({ fieldType: 'text' });
    render(<FieldExtension ctx={ctx} />);
    expect(
      screen.getByText(
        'The Shopify editor works on Single-line string and JSON fields only',
      ),
    ).toBeInTheDocument();
  });
});

describe('FieldExtension: legacy values', () => {
  it('renders a 1.x handle without changing it', async () => {
    const { ctx, setFieldValue } = createCtx({
      fieldType: 'string',
      value: 'the-complete-snowboard',
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('The Complete Snowboard'),
    ).toBeInTheDocument();
    expect(client.productByHandle).toHaveBeenCalledWith(
      'the-complete-snowboard',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      screen.getByText('Snowboard Vendor · snowboard'),
    ).toBeInTheDocument();
    expect(screen.getByText('€699.95')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('hydrates 1.x JSON by ID and stays quiet when nothing drifted', async () => {
    const { ctx, setFieldValue } = createCtx({ value: LEGACY_1X });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('The Complete Snowboard'),
    ).toBeInTheDocument();
    expect(client.loadNodes).toHaveBeenCalledWith(
      [COMPLETE_ID],
      expect.anything(),
    );
    await waitFor(() => expect(client.legacyProduct).toHaveBeenCalled());
    expect(
      screen.queryByText('Shopify data changed since this was saved'),
    ).not.toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('decodes base64 IDs saved before 2022-04', async () => {
    const { ctx } = createCtx({ value: legacyBase64Text });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('The Complete Snowboard'),
    ).toBeInTheDocument();
    expect(client.loadNodes).toHaveBeenCalledWith(
      [COMPLETE_ID],
      expect.anything(),
    );
  });

  it('falls back to the handle when the saved ID resolves to nothing', async () => {
    const value = JSON.stringify({
      ...JSON.parse(LEGACY_1X),
      id: MISSING_ID,
    });
    const { ctx } = createCtx({ value });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('The Complete Snowboard'),
    ).toBeInTheDocument();
    expect(client.productByHandle).toHaveBeenCalledWith(
      'the-complete-snowboard',
      expect.anything(),
    );
  });

  it('does not report drift for old _crop_center thumbnails', async () => {
    const { ctx, setFieldValue } = createCtx({ value: legacyCropCenterText });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('The Complete Snowboard'),
    ).toBeInTheDocument();
    await waitFor(() => expect(client.legacyProduct).toHaveBeenCalled());
    expect(
      screen.queryByText('Shopify data changed since this was saved'),
    ).not.toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('offers to refresh drifted 1.x JSON in the exact 1.x shape', async () => {
    const stale = JSON.stringify({
      ...JSON.parse(LEGACY_1X),
      title: 'Old title',
      priceRange: {
        maxVariantPrice: { amount: '649.95', currencyCode: 'EUR' },
        minVariantPrice: { amount: '649.95', currencyCode: 'EUR' },
      },
    });
    const { ctx, setFieldValue } = createCtx({ value: stale });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('Shopify data changed since this was saved'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The saved title and price no longer match Shopify.'),
    ).toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved data' }));
    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith(
        'shopify_product',
        serializeLegacyProductJson(buildLegacyProductJson(LEGACY_NODE)),
      ),
    );
  });

  it('writes 1.x JSON for a product picked in a legacy JSON field', async () => {
    const { ctx, setFieldValue, openModal } = createCtx({
      openModalResult: pickerResult([COMPLETE]),
    });
    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Shopify' }));
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(openModal.mock.calls[0]?.[0]).toMatchObject({
      id: 'shopifyPicker',
      title: 'Choose a product',
      width: 'xl',
      initialHeight: 760,
    });
    expect(client.legacyProduct).toHaveBeenCalledWith({
      id: COMPLETE_ID,
      handle: 'the-complete-snowboard',
    });
    expect(setFieldValue).toHaveBeenCalledWith(
      'shopify_product',
      serializeLegacyProductJson(buildLegacyProductJson(LEGACY_NODE)),
    );
  });

  it('writes a handle for a product picked in a 1.x string field', async () => {
    const { ctx, setFieldValue } = createCtx({
      fieldType: 'string',
      openModalResult: pickerResult([COMPLETE]),
    });
    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Shopify' }));
    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith(
        'shopify_product',
        'the-complete-snowboard',
      ),
    );
  });

  it('shows a product picked in a 1.x string field without waiting for Shopify', async () => {
    const { ctx, setFieldValue } = createCtx({
      fieldType: 'string',
      openModalResult: pickerResult([COMPARE]),
    });
    // The handle lookup never answers: the row must come from the picker.
    client.productByHandle.mockImplementation(() => new Promise(() => {}));
    const view = render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Shopify' }));
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    const written = setFieldValue.mock.calls[0]?.[1];
    expect(written).toBe('the-compare-at-price-snowboard');

    view.rerender(<FieldExtension ctx={withValue(ctx, written)} />);
    expect(
      screen.getByText('The Compare at Price Snowboard'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('spinner')).toBeNull();
  });

  describe('outside the shop primary market', () => {
    // The record locale (IT) and the store's default market both answer in
    // Italian; only a request with no market answers like 1.x did.
    const ITALIAN_NODE = {
      ...LEGACY_NODE,
      title: 'Lo snowboard completo',
    } as LegacyProductNode;
    let primaryMarket: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      primaryMarket = vi.fn(async () => LEGACY_NODE);
      client.legacyProduct.mockResolvedValue(ITALIAN_NODE);
      client.withContext.mockImplementation((context: object) => ({
        ...client,
        context,
        legacyProduct:
          Object.keys(context).length === 0
            ? primaryMarket
            : vi.fn(async () => ITALIAN_NODE),
      }));
    });

    it('checks 1.x JSON for drift without a market', async () => {
      const stored = serializeLegacyProductJson(
        buildLegacyProductJson(LEGACY_NODE),
      );
      const { ctx, setFieldValue } = createCtx({
        value: stored,
        localized: true,
      });
      render(<FieldExtension ctx={ctx} />);
      await waitFor(() => expect(primaryMarket).toHaveBeenCalled());
      await act(async () => {});
      expect(client.withContext).toHaveBeenCalledWith({});
      expect(
        screen.queryByText('Shopify data changed since this was saved'),
      ).not.toBeInTheDocument();
      expect(setFieldValue).not.toHaveBeenCalled();
    });

    it('writes 1.x JSON in the primary language from a localized field', async () => {
      const { ctx, setFieldValue } = createCtx({
        localized: true,
        openModalResult: pickerResult([COMPLETE]),
      });
      render(<FieldExtension ctx={ctx} />);
      fireEvent.click(screen.getByRole('button', { name: 'Browse Shopify' }));
      await waitFor(() =>
        expect(setFieldValue).toHaveBeenCalledWith(
          'shopify_product',
          serializeLegacyProductJson(buildLegacyProductJson(LEGACY_NODE)),
        ),
      );
      expect(primaryMarket).toHaveBeenCalledWith({
        id: COMPLETE_ID,
        handle: 'the-complete-snowboard',
      });
    });
  });
});

describe('FieldExtension: Shopify IDs', () => {
  it.each([
    [single({ format: 'gid' }), COMPARE_ID, 'The Compare at Price Snowboard'],
    [
      single({ format: 'gid', kind: 'variant' }),
      VARIANT_ID,
      'The Complete Snowboard — Ice',
    ],
    [single({ format: 'gid', kind: 'collection' }), COLLECTION_ID, 'Hydrogen'],
  ])('renders a GID string field', async (parameters, value, title) => {
    const { ctx, setFieldValue } = createCtx({
      fieldType: 'string',
      parameters,
      value,
    });
    render(<FieldExtension ctx={ctx} />);
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('shows the compare-at price and variant details', async () => {
    const { ctx } = createCtx({
      fieldType: 'string',
      parameters: single({ format: 'gid', kind: 'variant' }),
      value: VARIANT_ID,
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('Snowboard Vendor · SKU BOARD-ICE'),
    ).toBeInTheDocument();
  });
});

describe('FieldExtension: reference documents', () => {
  it('hydrates every reference with one batched call', async () => {
    const { ctx, setFieldValue } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('The Complete Snowboard'),
    ).toBeInTheDocument();
    expect(screen.getByText('The Out of Stock Snowboard')).toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    expect(screen.getByText('€885.95')).toBeInTheDocument();
    expect(client.loadNodes).toHaveBeenCalledOnce();
    expect(client.loadNodes.mock.calls[0]?.[0]).toEqual([
      COMPLETE_ID,
      COMPARE_ID,
      OUT_OF_STOCK_ID,
    ]);
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('shows a spinner during the first load', async () => {
    let resolve: (nodes: Array<ShopifyNode | null>) => void = () => undefined;
    client.loadNodes.mockImplementationOnce(
      () =>
        new Promise<Array<ShopifyNode | null>>((done) => {
          resolve = done;
        }),
    );
    const { ctx } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
    });
    render(<FieldExtension ctx={ctx} />);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.getByText('Loading Shopify data…')).toHaveAttribute(
      'role',
      'status',
    );
    await act(async () => {
      resolve([COMPLETE, COMPARE, OUT_OF_STOCK]);
    });
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    expect(screen.getByText('The Complete Snowboard')).toBeInTheDocument();
  });

  it('opens the picker with the current selection and saves the new order', async () => {
    const { ctx, openModal, setFieldValue } = createCtx({
      parameters: multiple({ max: 10 }),
      value: THREE_PRODUCTS,
      openModalResult: pickerResult([OUT_OF_STOCK, COMPLETE, ICE, COMPARE]),
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    expect(screen.getByText('3 of 10')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add products' }));

    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    const options = openModal.mock.calls[0]?.[0];
    expect(options.title).toBe('Choose products');
    const parameters = options.parameters as PickerModalParameters;
    expect(parameters.shopDomain).toBe(SHOP);
    expect(parameters.fieldType).toBe('json');
    expect(parameters.fieldParameters).toMatchObject({
      cardinality: 'multiple',
      max: 10,
    });
    expect(parameters.selected.map((entry) => entry.id)).toEqual([
      COMPLETE_ID,
      COMPARE_ID,
      OUT_OF_STOCK_ID,
    ]);
    expect(parameters.selected[0]?.node).toEqual(COMPLETE);
    // The variant is dropped: this field picks products.
    expect(writtenDocument(setFieldValue)).toEqual({
      version: 1,
      shop: SHOP,
      kind: 'product',
      references: [
        { id: OUT_OF_STOCK_ID, handle: 'the-out-of-stock-snowboard' },
        { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
        { id: COMPARE_ID, handle: 'the-compare-at-price-snowboard' },
      ],
    });
  });

  it('does nothing when the picker is cancelled', async () => {
    const { ctx, openModal, setFieldValue } = createCtx({
      parameters: multiple(),
    });
    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Shopify' }));
    await waitFor(() => expect(openModal).toHaveBeenCalled());
    await act(async () => Promise.resolve());
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('adds snapshots when the field asks for them', async () => {
    const { ctx, setFieldValue } = createCtx({
      parameters: multiple({ snapshot: true }),
      openModalResult: pickerResult([COMPARE]),
    });
    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Shopify' }));
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(writtenDocument(setFieldValue).references[0].snapshot).toMatchObject(
      {
        title: 'The Compare at Price Snowboard',
        price: { amount: '785.95', currencyCode: 'EUR' },
      },
    );
  });

  it('disables Add at the maximum and explains why', async () => {
    const { ctx } = createCtx({
      parameters: multiple({ max: 3 }),
      value: THREE_PRODUCTS,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    expect(screen.getByRole('button', { name: 'Add products' })).toBeDisabled();
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    expect(
      screen.getByText(
        'You cannot add more products, as this field holds up to 3',
      ),
    ).toBeInTheDocument();
  });

  it('warns below the minimum', async () => {
    const { ctx } = createCtx({
      parameters: multiple({ min: 2 }),
      value: referenceDocument('product', [
        { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
      ]),
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    expect(screen.getByText('Add at least 2 products')).toBeInTheDocument();
  });

  it('asks to remove the extra items above the maximum', async () => {
    const { ctx, setFieldValue } = createCtx({
      parameters: multiple({ max: 2 }),
      value: THREE_PRODUCTS,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    expect(screen.getByText('3 of 2')).toBeInTheDocument();
    expect(
      screen.getByText('Remove 1 product, as this field holds up to 2'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add products' })).toBeDisabled();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('keeps the handle column for a single item, drawn disabled', async () => {
    const { ctx } = createCtx({
      parameters: multiple(),
      value: referenceDocument('product', [
        { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
      ]),
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    expect(screen.queryByRole('button', { name: /Reorder/ })).toBeNull();
    expect(screen.getByTestId('shopify-inert-handle')).toBeInTheDocument();
    expect(
      screen.getByText('Add another product to reorder'),
    ).toBeInTheDocument();
  });

  it('has no handle column on single values', async () => {
    const { ctx } = createCtx({
      parameters: single(),
      value: referenceDocument('product', [
        { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
      ]),
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    expect(screen.queryByTestId('shopify-inert-handle')).toBeNull();
  });

  it('replaces one row in place from a single-mode picker', async () => {
    const { ctx, openModal, setFieldValue } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
      openModalResult: pickerResult([
        product('gid://shopify/Product/3', 'Third board', 'third-board'),
      ]),
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Compare at Price Snowboard');
    const menu = await openRowMenu('The Compare at Price Snowboard');
    fireEvent.click(within(menu).getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    const options = openModal.mock.calls[0]?.[0];
    expect(options.title).toBe('Choose a product');
    expect(options.parameters.fieldParameters.cardinality).toBe('single');
    expect(
      options.parameters.selected.map((entry: { id: string }) => entry.id),
    ).toEqual([COMPARE_ID]);
    expect(
      writtenDocument(setFieldValue).references.map(
        (ref: { id: string }) => ref.id,
      ),
    ).toEqual([COMPLETE_ID, 'gid://shopify/Product/3', OUT_OF_STOCK_ID]);
  });

  it('refuses a replacement that is already in the field', async () => {
    const { ctx, setFieldValue, alert } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
      openModalResult: pickerResult([COMPLETE]),
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Compare at Price Snowboard');
    const menu = await openRowMenu('The Compare at Price Snowboard');
    fireEvent.click(within(menu).getByRole('button', { name: 'Replace' }));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Couldn't replace the product, as it's already in this field!",
      ),
    );
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('removes a row from its actions', async () => {
    const { ctx, setFieldValue } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Compare at Price Snowboard');
    const menu = await openRowMenu('The Compare at Price Snowboard');
    expect(
      within(menu).getByRole('button', { name: 'Open in Shopify admin' }),
    ).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(
      writtenDocument(setFieldValue).references.map(
        (ref: { id: string }) => ref.id,
      ),
    ).toEqual([COMPLETE_ID, OUT_OF_STOCK_ID]);
  });

  it('clears a single value when its only row is removed', async () => {
    const { ctx, setFieldValue } = createCtx({
      parameters: single(),
      value: referenceDocument('product', [
        { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
      ]),
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    const menu = await openRowMenu('The Complete Snowboard');
    fireEvent.click(within(menu).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith('shopify_product', null),
    );
  });

  it('replaces a single value from the row actions', async () => {
    const { ctx, openModal } = createCtx({
      parameters: single(),
      value: referenceDocument('product', [
        { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
      ]),
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    const menu = await openRowMenu('The Complete Snowboard');
    fireEvent.click(within(menu).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(openModal).toHaveBeenCalled());
    expect(openModal.mock.calls[0]?.[0].parameters.selected).toHaveLength(1);
  });
});

describe('FieldExtension: stores saved without capabilities', () => {
  const UNCHECKED_PLUGIN_PARAMETERS = {
    paramsVersion: '3',
    stores: [
      {
        shopDomain: SHOP,
        storefrontAccessToken: '6f39fb123179b7d636d84d833d3d3adf',
        tokenless: false,
      },
    ],
    useDemoStore: false,
    autoApplyToFieldsWithApiKey: '',
  };

  /** Like the real client: inventory fields only once detection grants them. */
  function mockDetection(inventory: boolean) {
    let known = false;
    let granted = false;
    client.hasKnownCapabilities.mockImplementation(() => known);
    client.effectiveCapabilities.mockImplementation(() => ({
      tags: false,
      inventory: granted,
      metafields: false,
    }));
    let finish: () => void = () => undefined;
    client.detectCapabilities.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            known = true;
            granted = inventory;
            resolve({
              tags: false,
              inventory,
              metafields: false,
              checkedAt: '2026-10-04T12:00:00Z',
            });
          };
        }),
    );
    client.loadNodes.mockImplementation(async (ids: string[]) =>
      ids.map((id) => {
        const node = NODES[id];
        return node?.__typename === 'Product' && granted
          ? { ...node, totalInventory: 12 }
          : (node ?? null);
      }),
    );
    return () => act(async () => finish());
  }

  it('detects them once, then shows stock counts', async () => {
    const grant = mockDetection(true);
    const { ctx } = createCtx({
      parameters: single(),
      value: referenceDocument('product', [
        { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
      ]),
      pluginParameters: UNCHECKED_PLUGIN_PARAMETERS,
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('The Complete Snowboard'),
    ).toBeInTheDocument();
    expect(screen.queryByText('12 in stock')).toBeNull();
    expect(client.detectCapabilities).toHaveBeenCalledTimes(1);

    await grant();
    expect(await screen.findByText('12 in stock')).toBeInTheDocument();
    // The rows load again for the stock fields, and never disappear.
    expect(client.loadNodes).toHaveBeenCalledTimes(2);
    expect(screen.getByText('The Complete Snowboard')).toBeInTheDocument();
    expect(client.detectCapabilities).toHaveBeenCalledTimes(1);
  });

  it('loads once when the token has no inventory scope', async () => {
    const settle = mockDetection(false);
    const { ctx } = createCtx({
      parameters: single(),
      value: referenceDocument('product', [
        { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
      ]),
      pluginParameters: UNCHECKED_PLUGIN_PARAMETERS,
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('The Complete Snowboard'),
    ).toBeInTheDocument();
    await settle();
    expect(client.loadNodes).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/in stock/)).toBeNull();
  });

  it("doesn't detect what the settings or this tab already know", async () => {
    const { ctx } = createCtx({
      parameters: single(),
      value: referenceDocument('product', [
        { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
      ]),
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('The Complete Snowboard'),
    ).toBeInTheDocument();
    expect(client.detectCapabilities).not.toHaveBeenCalled();
  });
});

describe('FieldExtension: recovery', () => {
  it('keeps unresolved references visible with Replace and Remove', async () => {
    const value = referenceDocument('product', [
      { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
      { id: MISSING_ID, handle: 'retired-board' },
    ]);
    const { ctx, setFieldValue } = createCtx({ parameters: multiple(), value });
    render(<FieldExtension ctx={ctx} />);
    expect(await screen.findByText('retired-board')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Not visible to the storefront: it may be unpublished from the Headless channel, archived, or deleted.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(MISSING_ID)).toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();

    // The warning strip carries Replace and Remove; the row's inline
    // actions don't repeat them.
    const inline = screen.getByRole('group', {
      name: 'Actions for retired-board',
    });
    expect(within(inline).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(
      within(inline).queryByRole('button', { name: 'Replace' }),
    ).toBeNull();
    const stripRemove = screen
      .getAllByRole('button', { name: 'Remove' })
      .find((button) => !button.closest('[role="group"]'));
    fireEvent.click(stripRemove as HTMLElement);
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(writtenDocument(setFieldValue).references).toEqual([
      { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
    ]);
  });

  it('suggests a renamed handle and an admin search for values saved as a handle', async () => {
    const { ctx } = createCtx({
      fieldType: 'string',
      value: 'retired-board',
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText(/^No product with this handle is visible/),
    ).toBeInTheDocument();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const menu = await openRowMenu('retired-board');
    fireEvent.click(
      within(menu).getByRole('button', { name: 'Search in Shopify admin' }),
    );
    expect(open).toHaveBeenCalledWith(
      'https://admin.shopify.com/store/datocms-demo/products?query=retired-board',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('announces a removal', async () => {
    const { ctx, setFieldValue } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    const menu = await openRowMenu('The Complete Snowboard');
    fireEvent.click(within(menu).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(screen.getByText('Removed The Complete Snowboard')).toHaveAttribute(
      'role',
      'status',
    );
  });

  it('keeps unresolved entries the picker returns', async () => {
    const value = referenceDocument('product', [
      { id: MISSING_ID, handle: 'retired-board' },
    ]);
    const { ctx, setFieldValue } = createCtx({
      parameters: multiple(),
      value,
      openModalResult: pickerResult([null, COMPLETE], [MISSING_ID]),
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('retired-board');
    fireEvent.click(screen.getByRole('button', { name: 'Add products' }));
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(writtenDocument(setFieldValue).references).toEqual([
      { id: MISSING_ID, handle: 'retired-board' },
      { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
    ]);
  });

  it('updates a changed handle in the saved format only when asked', async () => {
    const value = referenceDocument('product', [
      {
        id: COMPLETE_ID,
        handle: 'complete-snowboard-2024',
        snapshot: { title: 'Kept', capturedAt: '2026-01-01T00:00:00Z' },
      },
    ]);
    const { ctx, setFieldValue } = createCtx({ parameters: single(), value });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText(/The Shopify handle changed to/),
    ).toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(writtenDocument(setFieldValue).references).toEqual([
      {
        id: COMPLETE_ID,
        handle: 'the-complete-snowboard',
        snapshot: { title: 'Kept', capturedAt: '2026-01-01T00:00:00Z' },
      },
    ]);
  });

  it('converts a value saved in another format', async () => {
    const { ctx, setFieldValue } = createCtx({
      fieldType: 'string',
      parameters: single({ format: 'gid' }),
      value: 'the-complete-snowboard',
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText(
        'Saved as a Shopify handle. This field now saves a Shopify ID.',
      ),
    ).toBeInTheDocument();
    await screen.findByText('The Complete Snowboard');
    expect(setFieldValue).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert to new format' }),
    );
    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith(
        'shopify_product',
        COMPLETE_ID,
      ),
    );
  });

  it('converts 1.x JSON into a reference document', async () => {
    const { ctx, setFieldValue } = createCtx({
      parameters: single(),
      value: LEGACY_1X,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert to new format' }),
    );
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(writtenDocument(setFieldValue)).toEqual({
      version: 1,
      shop: SHOP,
      kind: 'product',
      references: [{ id: COMPLETE_ID, handle: 'the-complete-snowboard' }],
    });
  });

  it('explains why converting is not possible yet', async () => {
    const { ctx } = createCtx({
      fieldType: 'string',
      parameters: single({ format: 'gid' }),
      value: 'retired-board',
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText(
      'No product with this handle is visible to the storefront: the handle may have changed in Shopify, or the product may be unpublished from the Headless channel, archived, or deleted.',
    );
    expect(
      screen.getByRole('button', { name: 'Convert to new format' }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "You cannot convert the value while a product isn't visible to the storefront",
      ),
    ).toBeInTheDocument();
  });

  it('shows an invalid value as saved and clears it only after confirmation', async () => {
    const raw = '{"id": "gid://shopify/Product/1", "title": ';
    const { ctx, setFieldValue, openConfirm } = createCtx({ value: raw });
    render(<FieldExtension ctx={ctx} />);
    expect(
      screen.getByText("Couldn't read the saved value"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The saved value isn't valid JSON. It's kept exactly as saved until you clear it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Saved value').textContent).toBe(raw);
    expect(getShopifyClient).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByRole('button', { name: 'Clear value' }));
    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith('shopify_product', null),
    );
    expect(openConfirm.mock.calls[0]?.[0]).toMatchObject({
      title: 'Clear this value?',
      choices: [{ label: 'Yes, clear the value', intent: 'negative' }],
      cancel: { label: 'Cancel' },
    });
  });

  it('keeps an invalid value when the confirmation is cancelled', async () => {
    const { ctx, setFieldValue, openConfirm } = createCtx({
      value: '{nope',
      confirm: false,
    });
    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear value' }));
    await waitFor(() => expect(openConfirm).toHaveBeenCalled());
    await act(async () => Promise.resolve());
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('truncates long invalid values behind "Show full value"', () => {
    const raw = `{${'"x": 1, '.repeat(80)}`;
    const { ctx } = createCtx({ value: raw });
    render(<FieldExtension ctx={ctx} />);
    const box = screen.getByLabelText('Saved value');
    expect(box.textContent?.length).toBeLessThan(raw.length);
    fireEvent.click(screen.getByRole('button', { name: 'Show full value' }));
    expect(box).toHaveTextContent(raw.trim());
  });

  it('names both stores of a shop mismatch', () => {
    const { ctx } = createCtx({
      parameters: multiple(),
      value: referenceDocument(
        'product',
        [{ id: COMPLETE_ID, handle: 'the-complete-snowboard' }],
        'acme-outlet.myshopify.com',
      ),
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      screen.getByText(
        /It was saved for acme-outlet.myshopify.com, and this field uses datocms-demo.myshopify.com./,
      ),
    ).toBeInTheDocument();
  });

  it('reports Shopify errors and retries', async () => {
    client.loadNodes.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    const { ctx, setFieldValue } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText(
        "Couldn't reach Shopify. Check your connection or ad-blocker.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Couldn't load the products")).toBeInTheDocument();
    expect(screen.getByText('the-complete-snowboard')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('The Complete Snowboard'),
    ).toBeInTheDocument();
    expect(client.loadNodes).toHaveBeenCalledTimes(2);
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('keeps the error and the saved rows while trying again', async () => {
    client.loadNodes.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    let answer: (nodes: Array<ShopifyNode | null>) => void = () => undefined;
    const { ctx } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText("Couldn't load the products");
    client.loadNodes.mockImplementationOnce(
      () =>
        new Promise<Array<ShopifyNode | null>>((done) => {
          answer = done;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => Promise.resolve());
    // No first-load spinner: the callout and the rows stay while it loads.
    expect(screen.getByText("Couldn't load the products")).toBeInTheDocument();
    expect(screen.getByText('the-complete-snowboard')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).not.toBeDisabled();
    expect(screen.getAllByTestId('spinner')).toHaveLength(1);
    await act(async () => answer([COMPLETE, COMPARE, OUT_OF_STOCK]));
    expect(screen.queryByText("Couldn't load the products")).toBeNull();
    expect(screen.getByText('The Complete Snowboard')).toBeInTheDocument();
  });

  it('sends admins to the plugin settings when Shopify rejects the token', async () => {
    client.loadNodes.mockRejectedValue(
      new ShopifyClientError('unauthorized', 'HTTP 401', { status: 401 }),
    );
    const { ctx, navigateTo } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText(
        'Shopify rejected the Storefront access token. Update it in the plugin settings.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Open plugin settings' }),
    );
    expect(navigateTo).toHaveBeenCalledWith(
      '/configuration/plugins/plugin-1/edit',
    );
  });

  it('asks other roles to contact an administrator about the token', async () => {
    client.loadNodes.mockRejectedValue(
      new ShopifyClientError('unauthorized', 'HTTP 401', { status: 401 }),
    );
    const { ctx } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
      canEditSchema: false,
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText(
        'Shopify rejected the Storefront access token. Ask an administrator to check the Shopify connection.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open plugin settings' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
  });

  it('alerts and keeps the value when the write fails', async () => {
    const { ctx, setFieldValue, alert } = createCtx({
      parameters: multiple(),
      openModalResult: pickerResult([COMPLETE]),
    });
    setFieldValue.mockRejectedValueOnce(new Error('nope'));
    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Shopify' }));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Couldn't save the Shopify selection!",
      ),
    );
  });
});

describe('FieldExtension: disabled and localized fields', () => {
  it('renders read-only rows with no actions', async () => {
    const { ctx, openModal } = createCtx({
      parameters: multiple({ max: 5 }),
      value: THREE_PRODUCTS,
      disabled: true,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    expect(screen.queryByRole('group', { name: /Actions for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reorder/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add products' })).toBeNull();
    expect(screen.getByText('3 of 5')).toBeInTheDocument();
    expect(openModal).not.toHaveBeenCalled();
  });

  it('drops the limit hints and handles on a disabled field', async () => {
    const { ctx } = createCtx({
      parameters: multiple({ min: 2 }),
      value: referenceDocument('product', [
        { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
      ]),
      disabled: true,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    expect(screen.queryByText('Add at least 2 products')).toBeNull();
    expect(screen.queryByTestId('shopify-inert-handle')).toBeNull();
  });

  it('hides Browse Shopify on a disabled empty field', () => {
    const { ctx } = createCtx({ parameters: multiple(), disabled: true });
    render(<FieldExtension ctx={ctx} />);
    expect(screen.getByText('No products selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Browse Shopify' })).toBeNull();
  });

  it('reads localized fields in the record locale when the store has it', async () => {
    const { ctx } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
      localized: true,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    expect(client.localization).toHaveBeenCalled();
    expect(client.withContext).toHaveBeenCalledWith({ language: 'IT' });
  });
});

describe('FieldExtension: handles in a language', () => {
  // The record locale (IT) maps to a store language. Shopify then answers
  // with translated handles, which only resolve in Italian; every handle the
  // field saves must be the one a context-free frontend sees.
  const ITALIAN: Record<string, ShopifyNode> = {
    [COMPLETE_ID]: product(
      COMPLETE_ID,
      'Lo snowboard completo',
      'lo-snowboard-completo',
    ),
    [COMPARE_ID]: product(
      COMPARE_ID,
      'Lo snowboard col prezzo di confronto',
      'lo-snowboard-confronto',
    ),
  };
  const italianByHandle: Record<string, ShopifyNode> = {
    // Shopify resolves primary handles in any language context.
    'the-complete-snowboard': ITALIAN[COMPLETE_ID] as ShopifyNode,
    'lo-snowboard-completo': ITALIAN[COMPLETE_ID] as ShopifyNode,
  };
  let italian: ReturnType<typeof createClient>;

  beforeEach(() => {
    italian = {
      ...createClient(),
      context: { language: 'IT' },
      loadNodes: vi.fn(async (ids: string[]) =>
        ids.map((id) => ITALIAN[id] ?? NODES[id] ?? null),
      ),
      productByHandle: vi.fn(
        async (handle: string) =>
          (italianByHandle[handle] as ProductSummary | undefined) ?? null,
      ),
    };
    client.withContext.mockImplementation((context: { language?: string }) =>
      context.language === 'IT' ? italian : { ...client, context },
    );
  });

  it('shows no handle change for a 1.x handle read in Italian', async () => {
    const { ctx, setFieldValue } = createCtx({
      fieldType: 'string',
      value: 'the-complete-snowboard',
      localized: true,
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('Lo snowboard completo'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(client.productByHandle).toHaveBeenCalledWith(
        'the-complete-snowboard',
        expect.anything(),
      ),
    );
    await act(async () => {});
    expect(screen.queryByText(/The Shopify handle changed/)).toBeNull();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('reports a real handle change with the primary handle', async () => {
    const { ctx, setFieldValue } = createCtx({
      parameters: single(),
      value: referenceDocument('product', [
        { id: COMPLETE_ID, handle: 'complete-snowboard-2024' },
      ]),
      localized: true,
    });
    render(<FieldExtension ctx={ctx} />);
    expect(
      await screen.findByText('the-complete-snowboard'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(writtenDocument(setFieldValue).references).toEqual([
      { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
    ]);
  });

  it('saves the primary handle of a product picked in Italian', async () => {
    const { ctx, setFieldValue, openModal } = createCtx({
      fieldType: 'string',
      localized: true,
      openModalResult: {
        ...pickerResult([ITALIAN[COMPLETE_ID] as ShopifyNode]),
        context: { language: 'IT' },
      },
    });
    render(<FieldExtension ctx={ctx} />);
    await waitFor(() => expect(client.localization).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Browse Shopify' }));
    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith(
        'shopify_product',
        'the-complete-snowboard',
      ),
    );
    expect(openModal.mock.calls[0]?.[0].parameters.context).toEqual({
      language: 'IT',
    });
  });

  it('saves primary handles when replacing a reference', async () => {
    const { ctx, setFieldValue } = createCtx({
      parameters: multiple(),
      value: referenceDocument('product', [
        { id: OUT_OF_STOCK_ID, handle: 'the-out-of-stock-snowboard' },
        { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
      ]),
      localized: true,
      openModalResult: pickerResult([ITALIAN[COMPARE_ID] as ShopifyNode]),
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('Lo snowboard completo');
    const menu = await openRowMenu('Lo snowboard completo');
    fireEvent.click(within(menu).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(writtenDocument(setFieldValue).references).toEqual([
      { id: OUT_OF_STOCK_ID, handle: 'the-out-of-stock-snowboard' },
      { id: COMPARE_ID, handle: 'the-compare-at-price-snowboard' },
    ]);
  });

  it('converts with primary handles', async () => {
    const { ctx, setFieldValue } = createCtx({
      parameters: single(),
      value: LEGACY_1X,
      localized: true,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('Lo snowboard completo');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert to new format' }),
    );
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(writtenDocument(setFieldValue).references).toEqual([
      { id: COMPLETE_ID, handle: 'the-complete-snowboard' },
    ]);
  });
});

describe('FieldExtension: picking keeps the rest of the value', () => {
  it('keeps the snapshots and handles of the items already in the field', async () => {
    const summer = {
      id: 'gid://shopify/Product/2',
      handle: 'summer-board',
      snapshot: { title: 'Summer Board', capturedAt: '2026-06-01T12:00:00Z' },
    };
    const drifted = {
      id: COMPLETE_ID,
      handle: 'complete-snowboard-2024',
      snapshot: { title: 'Kept', capturedAt: '2026-01-01T00:00:00Z' },
    };
    const { ctx, setFieldValue } = createCtx({
      parameters: multiple({ snapshot: false }),
      value: referenceDocument('product', [drifted, summer]),
      openModalResult: pickerResult([COMPLETE, null, COMPARE], ['', summer.id]),
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('Summer Board');
    fireEvent.click(screen.getByRole('button', { name: 'Add products' }));
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    expect(writtenDocument(setFieldValue).references).toEqual([
      drifted,
      summer,
      { id: COMPARE_ID, handle: 'the-compare-at-price-snowboard' },
    ]);
    expect(screen.getByText('Added 1 product')).toHaveAttribute(
      'role',
      'status',
    );
  });

  it('tells the Replace picker which items are already in the field', async () => {
    const { ctx, openModal } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Compare at Price Snowboard');
    const menu = await openRowMenu('The Compare at Price Snowboard');
    fireEvent.click(within(menu).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(openModal).toHaveBeenCalled());
    expect(openModal.mock.calls[0]?.[0].parameters.unavailable).toEqual([
      { key: COMPLETE_ID, id: COMPLETE_ID },
      { key: OUT_OF_STOCK_ID, id: OUT_OF_STOCK_ID },
    ]);
  });

  it('escapes Shopify error text in the toast', async () => {
    client.legacyProduct.mockRejectedValueOnce(
      new ShopifyClientError('graphql', 'GraphQL error', {
        userMessage: 'Field <title> & more is invalid',
      }),
    );
    const { ctx, alert, setFieldValue } = createCtx({
      openModalResult: pickerResult([COMPLETE]),
    });
    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Shopify' }));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Couldn't save the Shopify selection: Field &lt;title&gt; &amp; more is invalid",
      ),
    );
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('tells the editor when the picker cannot open', async () => {
    const { ctx, openModal, alert, setFieldValue } = createCtx({
      parameters: multiple(),
    });
    // Vitest fails the run on an unhandled rejection, so none may escape.
    openModal.mockRejectedValueOnce(new Error('penpal: connection destroyed'));
    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Shopify' }));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Couldn't open the Shopify picker!"),
    );
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    expect(setFieldValue).not.toHaveBeenCalled();
    // The field is usable again.
    expect(
      screen.getByRole('button', { name: 'Browse Shopify' }),
    ).not.toBeDisabled();
  });

  it('tells the editor when the clear confirmation cannot open', async () => {
    const { ctx, openConfirm, alert, setFieldValue } = createCtx({
      value: '{nope',
    });
    openConfirm.mockRejectedValueOnce(
      new Error('penpal: connection destroyed'),
    );
    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear value' }));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Couldn't clear the value!"),
    );
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('shows the count against a minimum', async () => {
    const { ctx } = createCtx({
      parameters: multiple({ min: 2 }),
      value: THREE_PRODUCTS,
    });
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    expect(screen.getByText('3 selected · at least 2')).toBeInTheDocument();
  });
});

describe('FieldExtension: values saved for another store', () => {
  const OTHER_STORE = referenceDocument(
    'product',
    [{ id: COMPLETE_ID, handle: 'the-complete-snowboard' }],
    'acme-outlet.myshopify.com',
  );

  it('titles the problem briefly and explains it in the body', () => {
    const { ctx } = createCtx({ parameters: multiple(), value: OTHER_STORE });
    render(<FieldExtension ctx={ctx} />);
    expect(
      screen.getByText('Saved for another Shopify store'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /^The saved value points to a different Shopify store than the one this field uses\. It was saved for acme-outlet\.myshopify\.com/,
      ),
    ).toBeInTheDocument();
  });

  it('picks again from this store, replacing the value without a confirmation', async () => {
    const { ctx, openModal, openConfirm, setFieldValue } = createCtx({
      parameters: multiple(),
      value: OTHER_STORE,
      openModalResult: pickerResult([COMPARE]),
    });
    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick again' }));
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    const parameters = openModal.mock.calls[0]?.[0].parameters;
    expect(parameters.shopDomain).toBe(SHOP);
    expect(parameters.selected).toEqual([]);
    expect(openConfirm).not.toHaveBeenCalled();
    expect(writtenDocument(setFieldValue)).toEqual({
      version: 1,
      shop: SHOP,
      kind: 'product',
      references: [
        { id: COMPARE_ID, handle: 'the-compare-at-price-snowboard' },
      ],
    });
  });

  it('offers no Pick again for other invalid values or read-only fields', () => {
    const { ctx } = createCtx({ value: '{nope' });
    const view = render(<FieldExtension ctx={ctx} />);
    expect(screen.queryByRole('button', { name: 'Pick again' })).toBeNull();
    view.unmount();
    const readOnly = createCtx({
      parameters: multiple(),
      value: OTHER_STORE,
      disabled: true,
    });
    render(<FieldExtension ctx={readOnly.ctx} />);
    expect(screen.queryByRole('button', { name: 'Pick again' })).toBeNull();
  });
});

describe('FieldExtension: drag and drop', () => {
  function mockRowRects() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const rows = Array.from(
          document.querySelectorAll('[data-testid="shopify-sortable-row"]'),
        );
        const index = rows.indexOf(this);
        const top = index < 0 ? 0 : index * 100;
        return {
          x: 0,
          y: top,
          top,
          left: 0,
          right: 600,
          bottom: top + 90,
          width: 600,
          height: 90,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
  }

  async function dragFirstRowDown() {
    const [handle] = screen.getAllByRole('button', { name: /^Reorder / });
    if (!handle) throw new Error('No drag handle');
    handle.focus();
    fireEvent.keyDown(handle, { code: 'Space' });
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    fireEvent.keyDown(document, { code: 'ArrowDown' });
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    fireEvent.keyDown(document, { code: 'Space' });
  }

  it('reorders with the keyboard and shows the new order at once', async () => {
    mockRowRects();
    const { ctx, setFieldValue } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
    });
    const { rerender } = render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');

    await dragFirstRowDown();
    await waitFor(() => expect(setFieldValue).toHaveBeenCalled());
    const reordered = writtenDocument(setFieldValue).references.map(
      (ref: { id: string }) => ref.id,
    );
    expect(reordered).toEqual([COMPARE_ID, COMPLETE_ID, OUT_OF_STOCK_ID]);
    const titles = () =>
      screen
        .getAllByTestId('shopify-sortable-row')
        .map((row) => within(row).getAllByText(/Snowboard$/)[0]?.textContent);
    expect(titles()).toEqual([
      'The Compare at Price Snowboard',
      'The Complete Snowboard',
      'The Out of Stock Snowboard',
    ]);

    rerender(
      <FieldExtension ctx={withValue(ctx, setFieldValue.mock.calls[0]?.[1])} />,
    );
    await act(async () => Promise.resolve());
    expect(titles()[0]).toBe('The Compare at Price Snowboard');
    // Reordering never refetches.
    expect(client.loadNodes).toHaveBeenCalledOnce();
  });

  it('rolls the order back when saving it fails', async () => {
    mockRowRects();
    const { ctx, setFieldValue, alert } = createCtx({
      parameters: multiple(),
      value: THREE_PRODUCTS,
    });
    setFieldValue.mockRejectedValueOnce(new Error('nope'));
    render(<FieldExtension ctx={ctx} />);
    await screen.findByText('The Complete Snowboard');
    await dragFirstRowDown();
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Couldn't save the Shopify selection!",
      ),
    );
    const first = screen.getAllByTestId('shopify-sortable-row')[0];
    expect(first).toHaveTextContent('The Complete Snowboard');
  });
});
