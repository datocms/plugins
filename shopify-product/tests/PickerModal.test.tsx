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
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PICKER_MODAL_HEIGHT,
  PICKER_PAGE_SIZE,
  PICKER_VIEW_STORAGE_KEY,
} from '../src/constants';
import PickerModal from '../src/entrypoints/PickerModal';
import { describeError, ShopifyClientError } from '../src/lib/shopifyClient';
import type {
  CollectionSummary,
  FieldParametersV1,
  LocalizationInfo,
  Page,
  PickerModalParameters,
  PickerModalResult,
  PickerSelectedEntry,
  ProductOption,
  ProductSummary,
  ShopifyContext,
  ShopifyFilter,
  VariantSummary,
} from '../src/types';

// ---------------------------------------------------------------------------
// Fake Shopify client
// ---------------------------------------------------------------------------

/**
 * Every client method forwards to these mocks with the client's market as the
 * last argument, so tests can tell which `@inContext` a query ran in.
 */
const api = vi.hoisted(() => ({
  browseProducts: vi.fn(),
  browseCollectionProducts: vi.fn(),
  productVariants: vi.fn(),
  collections: vi.fn(),
  filterValues: vi.fn(),
  skuMatches: vi.fn(),
  localization: vi.fn(),
  loadNode: vi.fn(),
  loadNodes: vi.fn(),
  appliedContext: vi.fn(),
  detectCapabilities: vi.fn(),
  capabilities: { tags: true, inventory: false, metafields: false },
  /** `hasKnownCapabilities()`: saved, detected in this tab, or tokenless. */
  knownCapabilities: true,
}));

vi.mock('../src/lib/shopifyClient', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/lib/shopifyClient')>();
  type Context = { country?: string; language?: string };
  function makeClient(context: Context): unknown {
    const forward =
      (method: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        method(...args, context);
    return {
      context,
      withContext: (next?: Context) => makeClient(next ?? {}),
      effectiveCapabilities: () => api.capabilities,
      hasKnownCapabilities: () => api.knownCapabilities,
      // Like the real client, a detection is remembered for the tab.
      detectCapabilities: (...args: unknown[]) =>
        Promise.resolve(api.detectCapabilities(...args, context)).then(
          (result: unknown) => {
            api.knownCapabilities = true;
            return result;
          },
        ),
      appliedContext: () => api.appliedContext(),
      browseProducts: forward(api.browseProducts),
      browseCollectionProducts: forward(api.browseCollectionProducts),
      productVariants: forward(api.productVariants),
      collections: forward(api.collections),
      filterValues: forward(api.filterValues),
      skuMatches: forward(api.skuMatches),
      localization: forward(api.localization),
      loadNode: forward(api.loadNode),
      loadNodes: forward(api.loadNodes),
    };
  }
  return { ...actual, getShopifyClient: () => makeClient({}) };
});

// jsdom has neither observer. ResizeObserver is a no-op; IntersectionObserver
// records what it observes so tests can bring the infinite-scroll sentinel
// into view with `intersect()`.
const io = vi.hoisted(() => {
  type Callback = (entries: unknown[], observer: unknown) => void;
  const live = new Set<{ callback: Callback; targets: Set<Element> }>();
  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  class IntersectionObserverMock {
    readonly targets = new Set<Element>();
    constructor(readonly callback: Callback) {}
    observe(target: Element) {
      this.targets.add(target);
      live.add(this);
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      live.delete(this);
    }
    takeRecords() {
      return [];
    }
  }
  Object.assign(globalThis, {
    IntersectionObserver: IntersectionObserverMock,
    ResizeObserver: ObserverStub,
  });
  return {
    /** Fires every live observer: its targets enter (or leave) the view. */
    intersect(isIntersecting: boolean) {
      for (const observer of [...live]) {
        const entries = [...observer.targets].map((target) => ({
          isIntersecting,
          target,
        }));
        if (entries.length > 0) observer.callback(entries, observer);
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function product(
  n: number,
  overrides: Partial<ProductSummary> = {},
): ProductSummary {
  return {
    __typename: 'Product',
    id: `gid://shopify/Product/${n}`,
    handle: `product-${n}`,
    title: `Product ${n}`,
    vendor: 'Snowboard Vendor',
    productType: 'snowboard',
    availableForSale: true,
    onlineStoreUrl: null,
    updatedAt: '2026-07-18T23:38:42Z',
    featuredImage: null,
    priceRange: {
      minVariantPrice: { amount: '10.0', currencyCode: 'EUR' },
      maxVariantPrice: { amount: '10.0', currencyCode: 'EUR' },
    },
    compareAtPriceRange: {
      maxVariantPrice: { amount: '0.0', currencyCode: 'EUR' },
    },
    variantsCount: { count: 1 },
    sku: null,
    ...overrides,
  };
}

function variant(
  n: number,
  parent: ProductSummary,
  value: string,
  overrides: Partial<VariantSummary> = {},
): VariantSummary {
  return {
    __typename: 'ProductVariant',
    id: `gid://shopify/ProductVariant/${n}`,
    title: value,
    sku: `SKU-${n}`,
    barcode: null,
    availableForSale: true,
    currentlyNotInStock: false,
    selectedOptions: [{ name: 'Color', value }],
    price: { amount: '10.0', currencyCode: 'EUR' },
    compareAtPrice: null,
    image: null,
    product: {
      id: parent.id,
      handle: parent.handle,
      title: parent.title,
      vendor: parent.vendor,
      onlineStoreUrl: null,
      featuredImage: null,
    },
    ...overrides,
  };
}

function collection(n: number, title: string): CollectionSummary {
  return {
    __typename: 'Collection',
    id: `gid://shopify/Collection/${n}`,
    handle: title.toLowerCase(),
    title,
    updatedAt: '2026-07-18T23:38:42Z',
    onlineStoreUrl: null,
    image: null,
  };
}

function page<T>(nodes: T[], endCursor: string | null = null): Page<T> {
  return { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } };
}

const AVAILABILITY_ONLY: ShopifyFilter[] = [
  {
    id: 'filter.v.availability',
    label: 'Availability',
    type: 'LIST',
    values: [
      {
        id: 'filter.v.availability.1',
        label: 'In stock',
        count: 7,
        input: '{"available":true}',
      },
    ],
  },
];

function localization(country: string): LocalizationInfo {
  return {
    country: { isoCode: country },
    language: { isoCode: 'EN' },
    // Shopify sends countries in ISO-code order.
    availableCountries: [
      {
        isoCode: 'AE',
        name: 'United Arab Emirates',
        currency: { isoCode: 'AED' },
      },
      { isoCode: 'AU', name: 'Australia', currency: { isoCode: 'AUD' } },
      { isoCode: 'IT', name: 'Italy', currency: { isoCode: 'EUR' } },
      { isoCode: 'MX', name: 'Mexico', currency: { isoCode: 'MXN' } },
    ],
    availableLanguages: [{ isoCode: 'EN', endonymName: 'English' }],
  };
}

const P1 = product(1, { title: 'Alpha board' });
const P2 = product(2, { title: 'Bravo board', vendor: 'Hydrogen Vendor' });
const P3 = product(3, { title: 'Charlie board' });
const MULTI = product(4, { title: 'Multi board', variantsCount: { count: 8 } });
const COLLECTIONS = [collection(1, 'Hydrogen'), collection(2, 'Frontpage')];

// ---------------------------------------------------------------------------
// ctx
// ---------------------------------------------------------------------------

function fieldParameters(
  overrides: Partial<FieldParametersV1> = {},
): FieldParametersV1 {
  return {
    paramsVersion: '1',
    kind: 'product',
    cardinality: 'multiple',
    format: 'reference',
    snapshot: false,
    ...overrides,
  };
}

function modalParameters(
  overrides: Partial<PickerModalParameters> = {},
): PickerModalParameters {
  return {
    fieldParameters: fieldParameters(),
    fieldType: 'json',
    shopDomain: 'datocms-demo.myshopify.com',
    selected: [],
    ...overrides,
  };
}

const DEMO_PLUGIN_PARAMETERS = {
  paramsVersion: '3',
  stores: [],
  useDemoStore: true,
  autoApplyToFieldsWithApiKey: '',
};

function createCtx(
  parameters: unknown,
  pluginParameters: Record<string, unknown> = DEMO_PLUGIN_PARAMETERS,
) {
  const resolve = vi.fn(async (_value: unknown) => {});
  const setHeight = vi.fn(async () => {});
  const alert = vi.fn(async () => {});
  const ctx = {
    mode: 'renderModal',
    modalId: 'shopifyPicker',
    parameters,
    plugin: {
      id: 'plugin',
      attributes: { parameters: pluginParameters },
    },
    ui: { locale: 'en' },
    bodyPadding: [20, 20, 20, 20],
    cssDesignTokens: {},
    theme: {},
    resolve,
    setHeight,
    alert,
    notice: vi.fn(),
    isAutoResizerActive: () => false,
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    updateHeight: vi.fn(),
  } as unknown as RenderModalCtx;
  return { ctx, resolve, setHeight, alert };
}

function renderPicker(parameters: unknown = modalParameters()) {
  const created = createCtx(parameters);
  render(<PickerModal ctx={created.ctx} />);
  return created;
}

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function lastResult(resolve: ReturnType<typeof createCtx>['resolve']) {
  return last(resolve.mock.calls)?.[0] as PickerModalResult;
}

/**
 * A result card or row: its accessible name starts with the title. In a
 * multiple field it is a native checkbox (the card is its label); in a
 * single field, or when it opens a variant panel, a button.
 */
function card(title: string): HTMLElement {
  const name = new RegExp(`^${title}`);
  return (
    screen.queryByRole('checkbox', { name }) ??
    screen.getByRole('button', { name })
  );
}

function findCard(title: string): Promise<HTMLElement> {
  return waitFor(() => card(title));
}

/** The footer's live selection count. */
function selectionCount(text: string): HTMLElement {
  return screen.getByText(text, { selector: '[role="status"]' });
}

const lastCall = (mock: ReturnType<typeof vi.fn>) =>
  last(mock.mock.calls) ?? [];

function selectedEntry(
  node: ProductSummary | VariantSummary,
  title: string,
): PickerSelectedEntry {
  return { key: node.id, id: node.id, node, fallbackLabel: title };
}

function variantParameters(
  overrides: Partial<FieldParametersV1> = {},
  extra: Partial<PickerModalParameters> = {},
) {
  return modalParameters({
    fieldParameters: fieldParameters({ kind: 'variant', ...overrides }),
    ...extra,
  });
}

async function chooseMenuOption(trigger: RegExp, option: string) {
  await userEvent.click(screen.getByRole('button', { name: trigger }));
  await userEvent.click(await screen.findByText(option));
}

/** Lets pending promises (mocked requests) settle and re-render. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  for (const mock of Object.values(api)) {
    if (typeof mock === 'function') mock.mockReset();
  }
  api.capabilities = { tags: true, inventory: false, metafields: false };
  api.knownCapabilities = true;
  api.browseProducts.mockResolvedValue(page([P1, P2, P3]));
  api.browseCollectionProducts.mockResolvedValue({
    found: true,
    page: page([P1, P2]),
    filters: AVAILABILITY_ONLY,
  });
  api.collections.mockResolvedValue(page(COLLECTIONS));
  api.filterValues.mockResolvedValue({
    productTypes: ['giftcard', 'snowboard'],
    tags: ['Premium', 'Sport'],
  });
  api.skuMatches.mockResolvedValue([]);
  api.localization.mockImplementation(
    async (_options: unknown, context: ShopifyContext) =>
      localization(context.country ?? 'IT'),
  );
  api.detectCapabilities.mockResolvedValue({
    tags: true,
    inventory: false,
    metafields: false,
    checkedAt: '2026-10-03T12:00:00Z',
  });
  api.loadNode.mockResolvedValue(null);
  api.loadNodes.mockImplementation(async (ids: string[]) =>
    ids.map(() => null),
  );
  api.appliedContext.mockReturnValue(null);
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PickerModal: frame and setup', () => {
  it('uses the fixed-height frame, focuses the search and lists products', async () => {
    const { setHeight } = renderPicker();
    await waitFor(() =>
      expect(setHeight).toHaveBeenCalledWith(PICKER_MODAL_HEIGHT),
    );
    expect(await screen.findByText('Alpha board')).toBeInTheDocument();
    expect(
      screen.getByRole('searchbox', { name: 'Search products' }),
    ).toHaveFocus();
    expect(lastCall(api.browseProducts)[0]).toEqual({
      first: PICKER_PAGE_SIZE,
      after: null,
      query: undefined,
      sortKey: 'TITLE',
      reverse: false,
    });
  });

  it('shows a spinner while the first page loads', () => {
    api.browseProducts.mockReturnValue(new Promise(() => {}));
    renderPicker();
    expect(screen.getByText('Loading products…')).toBeInTheDocument();
  });

  it('explains invalid parameters instead of guessing', () => {
    renderPicker({ fieldParameters: 'nope' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't open the picker",
    );
    expect(api.browseProducts).not.toHaveBeenCalled();
  });

  it('explains that the plugin has no store yet, without calling Shopify', () => {
    const { ctx } = createCtx(modalParameters(), {
      ...DEMO_PLUGIN_PARAMETERS,
      useDemoStore: false,
    });
    render(<PickerModal ctx={ctx} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "The plugin isn't set up yet",
    );
    expect(api.browseProducts).not.toHaveBeenCalled();
  });

  it('explains a store that is no longer connected', () => {
    renderPicker(modalParameters({ shopDomain: 'gone.myshopify.com' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Store not connected');
  });
});

describe('PickerModal: search', () => {
  it('debounces the search and escapes it into the query', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    api.browseProducts.mockClear();
    const search = screen.getByRole('searchbox');
    // Keystrokes well inside the 300ms debounce: one query, for the last value.
    for (const value of ['s', 'sn', 'sno', 'snow']) {
      fireEvent.change(search, { target: { value } });
    }
    expect(api.browseProducts).not.toHaveBeenCalled();
    await waitFor(() => expect(api.browseProducts).toHaveBeenCalledTimes(1));
    expect(lastCall(api.browseProducts)[0]).toMatchObject({
      query: 'snow',
      sortKey: 'RELEVANCE',
    });
  });

  it('pins exact SKU and barcode matches above the results', async () => {
    const pinned = product(9, { title: 'Managed board' });
    api.skuMatches.mockResolvedValue([
      {
        product: pinned,
        variants: [
          variant(91, pinned, 'Default Title', { sku: 'sku-managed-1' }),
        ],
      },
    ]);
    api.browseProducts.mockImplementation(async (args: { query?: string }) =>
      page(args.query ? [pinned, P1] : [P1, P2, P3]),
    );
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.type(screen.getByRole('searchbox'), 'sku-managed-1');
    const group = await screen.findByRole('region', {
      name: 'Exact SKU / barcode matches',
    });
    expect(within(group).getByText('Managed board')).toBeInTheDocument();
    expect(
      within(group).getByText('sku-managed-1').parentElement,
    ).toHaveTextContent('SKU sku-managed-1');
    expect(lastCall(api.skuMatches)[0]).toBe('sku-managed-1');
    // The pinned product isn't repeated in the main results.
    const main = screen.getByRole('region', { name: 'All products' });
    expect(within(main).queryByText('Managed board')).toBeNull();
    expect(within(main).getByText('Alpha board')).toBeInTheDocument();
  });

  it('does not run the SKU lookup for text with spaces', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'two words' },
    });
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: 'two words',
      }),
    );
    expect(api.skuMatches).not.toHaveBeenCalled();
  });

  it('lists the matching variants directly in variant mode', async () => {
    const parent = product(9, {
      title: 'Managed board',
      variantsCount: { count: 3 },
    });
    const hit = variant(91, parent, 'Black', { sku: 'sku-managed-1' });
    api.skuMatches.mockResolvedValue([{ product: parent, variants: [hit] }]);
    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({
          kind: 'variant',
          cardinality: 'single',
        }),
      }),
    );
    await screen.findByText('Alpha board');
    await userEvent.type(screen.getByRole('searchbox'), 'sku-managed-1');
    const group = await screen.findByRole('region', {
      name: 'Exact SKU / barcode matches',
    });
    await userEvent.click(
      within(group).getByRole('button', { name: /Managed board — Black/ }),
    );
    expect(lastResult(resolve).selected[0]).toMatchObject({
      id: hit.id,
      node: hit,
    });
  });
});

describe('PickerModal: filters and sorting', () => {
  it('applies product type, available for sale and clears them', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.click(screen.getByRole('button', { name: /Product type/ }));
    await userEvent.click(await screen.findByText('snowboard'));
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: 'product_type:snowboard',
      }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Available for sale' }),
    );
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: 'product_type:snowboard AND available_for_sale:true',
      }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear filters' }),
    );
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: undefined,
      }),
    );
  });

  it('means ANY of several tags', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.click(screen.getByRole('button', { name: /^Tags/ }));
    await userEvent.click(await screen.findByText('Premium'));
    await userEvent.click(screen.getByText('Sport'));
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: '(tag:Premium OR tag:Sport)',
      }),
    );
  });

  it('hides the tag filter without the tags capability', async () => {
    api.capabilities = { tags: false, inventory: false, metafields: false };
    renderPicker();
    await screen.findByText('Alpha board');
    expect(screen.queryByRole('button', { name: /^Tags/ })).toBeNull();
  });

  it('switches to the collection query and disables filters it does not enable', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.click(screen.getByRole('button', { name: /^Collection/ }));
    await userEvent.click(await screen.findByText('Hydrogen'));
    await waitFor(() =>
      expect(api.browseCollectionProducts).toHaveBeenCalled(),
    );
    expect(lastCall(api.browseCollectionProducts)[0]).toMatchObject({
      collectionId: 'gid://shopify/Collection/1',
      sortKey: 'COLLECTION_DEFAULT',
      filters: [],
    });
    const productType = await screen.findByRole('button', {
      name: /Product type\. Enable this filter in Shopify Search & Discovery/,
    });
    expect(productType).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('button', { name: /^Tags\. Enable this filter/ }),
    ).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(
      screen.getByRole('button', { name: 'Available for sale' }),
    );
    await waitFor(() =>
      expect(lastCall(api.browseCollectionProducts)[0]).toMatchObject({
        filters: [{ available: true }],
      }),
    );
  });

  it('enforces a locked vendor in the browser when the collection cannot', async () => {
    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({
          scope: {
            collectionId: 'gid://shopify/Collection/1',
            collectionTitle: 'Hydrogen',
            vendor: 'Hydrogen Vendor',
          },
        }),
      }),
    );
    expect(await screen.findByText('Bravo board')).toBeInTheDocument();
    expect(screen.queryByText('Alpha board')).toBeNull();
    expect(screen.getByText('Collection:').closest('span')).toHaveTextContent(
      'Collection: Hydrogen',
    );
    expect(screen.queryByRole('button', { name: /^Collection/ })).toBeNull();
    expect(
      screen.queryByRole('textbox', { name: 'Filter by vendor' }),
    ).toBeNull();
  });

  it('sorts with the matching Shopify sort key', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.click(screen.getByRole('button', { name: /^Sort:/ }));
    expect(screen.queryByText('Relevance')).toBeNull();
    await userEvent.click(await screen.findByText('Price high → low'));
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        sortKey: 'PRICE',
        reverse: true,
      }),
    );
  });
});

describe('PickerModal: pages and states', () => {
  it('loads more results with the cursor', async () => {
    api.browseProducts
      .mockResolvedValueOnce(page([P1, P2], 'cursor-1'))
      .mockResolvedValueOnce(page([P3]));
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.click(
      screen.getByRole('button', { name: 'Load more products' }),
    );
    expect(await screen.findByText('Charlie board')).toBeInTheDocument();
    expect(lastCall(api.browseProducts)[0]).toMatchObject({
      after: 'cursor-1',
    });
    expect(
      screen.queryByRole('button', { name: 'Load more products' }),
    ).toBeNull();
  });

  it('shows the empty state with the storefront hint and clears filters', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    api.browseProducts.mockResolvedValue(page([]));
    await userEvent.click(
      screen.getByRole('button', { name: 'Available for sale' }),
    );
    expect(
      await screen.findByText('No products match', {
        selector: '[class*="title"]',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Only products published to the Headless storefront/),
    ).toBeInTheDocument();
    const clear = screen.getAllByRole('button', { name: 'Clear filters' });
    await userEvent.click(clear[clear.length - 1]);
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: undefined,
      }),
    );
  });

  it('shows actionable errors and retries', async () => {
    api.browseProducts.mockRejectedValueOnce(
      new ShopifyClientError('unauthorized', 'HTTP 401'),
    );
    renderPicker();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the products");
    expect(alert).toHaveTextContent(
      'Shopify rejected the Storefront access token. Update it in the plugin settings.',
    );
    await userEvent.click(
      within(alert).getByRole('button', { name: 'Try again' }),
    );
    expect(await screen.findByText('Alpha board')).toBeInTheDocument();
  });
});

describe('PickerModal: selection', () => {
  it('resolves right away in single mode', async () => {
    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ cardinality: 'single' }),
      }),
    );
    expect(
      screen.getByText('Click a product to choose it'),
    ).toBeInTheDocument();
    await userEvent.click(await findCard('Bravo board'));
    expect(lastResult(resolve)).toEqual({
      selected: [
        {
          key: P2.id,
          id: P2.id,
          node: P2,
          fallbackLabel: 'Bravo board',
        },
      ],
    });
  });

  it('stages picks, respects the max, removes, clears and applies in order', async () => {
    const unresolvedEntry: PickerSelectedEntry = {
      key: 'gid://shopify/Product/77',
      id: 'gid://shopify/Product/77',
      node: null,
      fallbackLabel: 'Retired board',
    };
    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ max: 3 }),
        selected: [unresolvedEntry],
      }),
    );
    expect(selectionCount('1 of 3 selected')).toBeInTheDocument();
    await userEvent.click(await findCard('Bravo board'));
    await userEvent.click(card('Alpha board'));
    expect(selectionCount('3 of 3 selected')).toBeInTheDocument();
    expect(card('Bravo board')).toBeChecked();
    // At the max, the rest are disabled and say why.
    const charlie = card('Charlie board');
    expect(charlie).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(charlie);
    expect(selectionCount('3 of 3 selected')).toBeInTheDocument();
    // The footer and the disabled card's tooltip both say why.
    expect(
      screen.getAllByText('You can select up to 3 products').length,
    ).toBeGreaterThanOrEqual(1);

    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selection' }),
    );
    expect(lastResult(resolve).selected.map((entry) => entry.key)).toEqual([
      unresolvedEntry.key,
      P2.id,
      P1.id,
    ]);

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove Retired board' }),
    );
    expect(selectionCount('2 of 3 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(selectionCount('0 of 3 selected')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selection' }),
    );
    expect(lastResult(resolve)).toEqual({ selected: [] });
  });

  it('shows already-selected items as checked', async () => {
    renderPicker(
      modalParameters({
        selected: [
          { key: P3.id, id: P3.id, node: P3, fallbackLabel: 'Charlie board' },
        ],
      }),
    );
    expect(await findCard('Charlie board')).toBeChecked();
    expect(card('Alpha board')).not.toBeChecked();
  });
});

describe('PickerModal: variants', () => {
  const variants = Array.from({ length: 8 }, (_, index) =>
    variant(100 + index, MULTI, index % 2 === 0 ? 'Black' : 'White'),
  );
  const options: ProductOption[] = [
    { name: 'Color', optionValues: [{ name: 'Black' }, { name: 'White' }] },
  ];

  beforeEach(() => {
    api.browseProducts.mockResolvedValue(page([MULTI, P1]));
    api.productVariants.mockImplementation(
      async (args: { productId: string }) =>
        args.productId === MULTI.id
          ? { variantsCount: 8, options, page: page(variants) }
          : {
              variantsCount: 1,
              options: [],
              page: page([variant(1, P1, 'Default Title')]),
            },
    );
  });

  it('expands a product into selectable, filterable variant rows', async () => {
    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ kind: 'variant' }),
      }),
    );
    const multi = await findCard('Multi board');
    expect(multi).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(multi);
    expect(multi).toHaveAttribute('aria-expanded', 'true');
    const panel = await screen.findByRole('region', {
      name: 'Variants of Multi board',
    });
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(8),
    );
    expect(lastCall(api.productVariants)[0]).toMatchObject({
      productId: MULTI.id,
      first: 250,
    });

    await userEvent.click(within(panel).getByRole('button', { name: 'White' }));
    expect(within(panel).getAllByRole('checkbox')).toHaveLength(4);

    const [first] = within(panel).getAllByRole('checkbox');
    await userEvent.click(first);
    expect(first).toBeChecked();
    expect(selectionCount('1 selected')).toBeInTheDocument();
    expect(within(multi).getByText('1 selected')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selection' }),
    );
    expect(lastResult(resolve).selected[0]).toMatchObject({
      id: variants[1].id,
      node: variants[1],
    });
  });

  it('selects the only variant straight from the card', async () => {
    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ kind: 'variant' }),
      }),
    );
    const alpha = await findCard('Alpha board');
    expect(alpha).not.toHaveAttribute('aria-expanded');
    await userEvent.click(alpha);
    await waitFor(() =>
      expect(selectionCount('1 selected')).toBeInTheDocument(),
    );
    expect(lastCall(api.productVariants)[0]).toMatchObject({
      productId: P1.id,
      first: 1,
    });
    // Clicking again removes it.
    await userEvent.click(alpha);
    expect(selectionCount('0 selected')).toBeInTheDocument();
  });

  it('resolves a clicked variant row in single mode', async () => {
    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({
          kind: 'variant',
          cardinality: 'single',
        }),
      }),
    );
    await userEvent.click(await findCard('Multi board'));
    const panel = await screen.findByRole('region', {
      name: 'Variants of Multi board',
    });
    const rows = await within(panel).findAllByRole('button', {
      name: /SKU-10/,
    });
    await userEvent.click(rows[2]);
    expect(lastResult(resolve).selected[0]).toMatchObject({
      id: variants[2].id,
    });
  });
});

describe("PickerModal: Replace and the field's other items", () => {
  function replaceParameters(
    overrides: Partial<FieldParametersV1> = {},
    extra: Partial<PickerModalParameters> = {},
  ) {
    return modalParameters({
      fieldParameters: fieldParameters({ cardinality: 'single', ...overrides }),
      selected: [selectedEntry(P1, 'Alpha board')],
      unavailable: [
        { key: P2.id, id: P2.id },
        // A 1.x item saved only as a handle.
        { key: 'handle:product-3', id: null },
      ],
      ...extra,
    });
  }

  it('shows them selected and locked, and says why', async () => {
    const { resolve } = renderPicker(replaceParameters());
    const bravo = await findCard('Bravo board');
    expect(bravo).toHaveAttribute('aria-disabled', 'true');
    expect(bravo).not.toHaveAttribute('aria-current');
    expect(card('Charlie board')).toHaveAttribute('aria-disabled', 'true');
    // The item being replaced is the current choice, and stays pickable.
    expect(card('Alpha board')).toHaveAttribute('aria-current', 'true');
    expect(card('Alpha board')).not.toHaveAttribute('aria-disabled');

    await userEvent.hover(bravo);
    expect(
      await screen.findByText('Already in this field'),
    ).toBeInTheDocument();
    await userEvent.click(bravo);
    await userEvent.click(card('Charlie board'));
    expect(resolve).not.toHaveBeenCalled();
  });

  it('checks and locks them in multiple fields', async () => {
    renderPicker(replaceParameters({ cardinality: 'multiple' }));
    const bravo = await findCard('Bravo board');
    expect(bravo).toBeChecked();
    expect(bravo).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(bravo);
    expect(bravo).toBeChecked();
    expect(selectionCount('1 selected')).toBeInTheDocument();
  });

  it('locks variants that are already in the field', async () => {
    const MULTI_VARIANTS = [
      variant(201, MULTI, 'Black'),
      variant(202, MULTI, 'White'),
    ];
    api.browseProducts.mockResolvedValue(page([MULTI]));
    api.productVariants.mockResolvedValue({
      variantsCount: 2,
      options: [],
      page: page(MULTI_VARIANTS),
    });
    const { resolve } = renderPicker(
      replaceParameters(
        { kind: 'variant' },
        {
          selected: [],
          unavailable: [{ key: 'v', id: MULTI_VARIANTS[1].id }],
        },
      ),
    );
    await userEvent.click(await findCard('Multi board'));
    const panel = await screen.findByRole('region', {
      name: 'Variants of Multi board',
    });
    const [black, white] = await within(panel).findAllByRole('button', {
      name: /SKU-20/,
    });
    expect(white).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(white);
    expect(resolve).not.toHaveBeenCalled();
    expect(black).not.toHaveAttribute('aria-disabled');
    await userEvent.click(black);
    expect(lastResult(resolve).selected[0]).toMatchObject({
      id: MULTI_VARIANTS[0].id,
    });
  });

  it("won't pick a single-variant product whose variant is in the field", async () => {
    const only = variant(301, P1, 'Default Title');
    api.productVariants.mockResolvedValue({
      variantsCount: 1,
      options: [],
      page: page([only]),
    });
    const { resolve, alert } = renderPicker(
      replaceParameters(
        { kind: 'variant' },
        { selected: [], unavailable: [{ key: 'v', id: only.id }] },
      ),
    );
    await userEvent.click(await findCard('Alpha board'));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Couldn't choose the variant, as it's already in this field!",
      ),
    );
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('PickerModal: collections', () => {
  it('searches collections by title prefix and picks one', async () => {
    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({
          kind: 'collection',
          cardinality: 'single',
        }),
      }),
    );
    expect(await screen.findByText('Frontpage')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filters' })).toBeNull();
    expect(
      screen.getByPlaceholderText('Search collections…'),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'hyd');
    await waitFor(() =>
      expect(lastCall(api.collections)[0]).toMatchObject({
        query: 'title:hyd*',
      }),
    );
    // The new query shows a spinner until its page lands.
    await userEvent.click(await findCard('Hydrogen'));
    expect(lastResult(resolve).selected[0]).toMatchObject({
      id: COLLECTIONS[0].id,
    });
    expect(api.browseProducts).not.toHaveBeenCalled();
  });

  it('hydrates an unresolved selected collection when it loads', async () => {
    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ kind: 'collection' }),
        selected: [
          {
            key: COLLECTIONS[0].id,
            id: COLLECTIONS[0].id,
            node: null,
            fallbackLabel: 'hydrogen',
          },
        ],
      }),
    );
    expect(await screen.findByText('Frontpage')).toBeInTheDocument();
    expect(card('Hydrogen')).toBeChecked();
    // The tray's eye-slash tile becomes the collection's own tile.
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Hydrogen' })).toBeInTheDocument(),
    );
  });
});

describe('PickerModal: keyboard, view and market', () => {
  it('moves between cards with the arrow keys (one tab stop)', async () => {
    renderPicker();
    const alpha = await findCard('Alpha board');
    await waitFor(() => expect(alpha).toHaveAttribute('tabindex', '0'));
    expect(card('Bravo board')).toHaveAttribute('tabindex', '-1');
    act(() => alpha.focus());
    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(card('Bravo board')).toHaveFocus();
    fireEvent.keyDown(card('Bravo board'), { key: 'End' });
    expect(card('Charlie board')).toHaveFocus();
    expect(card('Charlie board')).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(card('Charlie board'), { key: 'ArrowUp' });
    expect(card('Bravo board')).toHaveFocus();
    fireEvent.keyDown(card('Bravo board'), { key: 'Home' });
    expect(alpha).toHaveFocus();
  });

  it('toggles Space and Enter on cards in multiple mode', async () => {
    renderPicker();
    const alpha = await findCard('Alpha board');
    alpha.focus();
    await userEvent.keyboard('[Space]');
    expect(alpha).toBeChecked();
    await userEvent.keyboard('[Enter]');
    expect(alpha).not.toBeChecked();
  });

  it('remembers the list view', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(window.localStorage.getItem(PICKER_VIEW_STORAGE_KEY)).toBe('list');
  });

  it('re-queries in another market and returns it', async () => {
    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ cardinality: 'single' }),
      }),
    );
    const trigger = await screen.findByRole('button', {
      name: 'Market: IT · EUR · EN',
    });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByText('Mexico (MXN)'));
    await waitFor(() =>
      expect(last(lastCall(api.browseProducts))).toEqual({
        country: 'MX',
        language: 'EN',
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'Market: MX · MXN · EN' }),
    ).toBeInTheDocument();
    await userEvent.click(await findCard('Alpha board'));
    expect(lastResult(resolve).context).toEqual({
      country: 'MX',
      language: 'EN',
    });
  });

  it('starts in the market the field passes', async () => {
    renderPicker(modalParameters({ context: { country: 'MX' } }));
    await screen.findByText('Alpha board');
    expect(last(lastCall(api.browseProducts))).toEqual({ country: 'MX' });
  });
});

describe('PickerModal: result copy', () => {
  it('calls the results of a variant picker products', async () => {
    api.browseProducts.mockResolvedValueOnce(page([P1, P2, P3], 'cursor-1'));
    renderPicker(variantParameters());
    await screen.findByText('Alpha board');
    expect(
      screen.getByRole('button', { name: 'Load more products' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Load more variants' }),
    ).toBeNull();
    expect(screen.getByText('3 products shown')).toBeInTheDocument();
  });

  it('titles a failed product search of a variant picker with products', async () => {
    api.browseProducts.mockRejectedValueOnce(
      new ShopifyClientError('network', 'offline'),
    );
    renderPicker(variantParameters());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load the products",
    );
  });

  it('pluralizes the announced count', async () => {
    api.browseProducts.mockResolvedValue(page([P1]));
    renderPicker();
    expect(await screen.findByText('1 product shown')).toBeInTheDocument();
  });
});

describe('PickerModal: infinite scroll and later pages', () => {
  it('loads the next page when the end of the list comes into view', async () => {
    api.browseProducts
      .mockResolvedValueOnce(page([P1, P2], 'cursor-1'))
      .mockResolvedValueOnce(page([P3]));
    renderPicker();
    await screen.findByText('Alpha board');
    act(() => io.intersect(true));
    expect(await screen.findByText('Charlie board')).toBeInTheDocument();
    expect(lastCall(api.browseProducts)[0]).toMatchObject({
      after: 'cursor-1',
    });
  });

  it('stops paging in on scroll at the limit and keeps Load more', async () => {
    const boards = (start: number) =>
      Array.from({ length: 250 }, (_, index) =>
        product(start + index, { title: `Board ${start + index}` }),
      );
    api.browseProducts
      .mockResolvedValueOnce(page(boards(1000), 'cursor-1'))
      .mockResolvedValueOnce(page(boards(2000), 'cursor-2'))
      .mockResolvedValueOnce(page(boards(3000), 'cursor-3'));
    renderPicker();
    await screen.findByText('Board 1000');
    act(() => io.intersect(true));
    await screen.findByText('Board 2000');
    // 500 loaded: the sentinel stops paging; the button still works.
    act(() => io.intersect(true));
    await settle();
    expect(api.browseProducts).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('button', { name: 'Load more products' }),
    ).toBeInTheDocument();
  }, 20_000);

  it('explains a failed next page and retries it, keeping what loaded', async () => {
    const error = new ShopifyClientError('network', 'offline');
    api.browseProducts
      .mockResolvedValueOnce(page([P1, P2], 'cursor-1'))
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(page([P3]));
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.click(
      screen.getByRole('button', { name: 'Load more products' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(describeError(error));
    expect(screen.getByText('Alpha board')).toBeInTheDocument();
    await userEvent.click(
      within(alert).getByRole('button', { name: 'Try again' }),
    );
    expect(await screen.findByText('Charlie board')).toBeInTheDocument();
    expect(lastCall(api.browseProducts)[0]).toMatchObject({
      after: 'cursor-1',
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains a locked collection the storefront cannot see', async () => {
    api.browseCollectionProducts.mockResolvedValue({
      found: false,
      page: page([]),
      filters: [],
    });
    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({
          scope: {
            collectionId: 'gid://shopify/Collection/1',
            collectionTitle: 'Hydrogen',
          },
        }),
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the products");
    expect(alert).toHaveTextContent(
      'Not visible to the storefront: it may be unpublished from the Headless channel, or deleted.',
    );
  });
});

describe('PickerModal: SKU matches and the editor filters', () => {
  const pinned = product(9, { title: 'Managed card', productType: 'giftcard' });
  const hit = variant(91, pinned, 'Default Title', { sku: 'sku-managed-1' });

  beforeEach(() => {
    api.skuMatches.mockResolvedValue([{ product: pinned, variants: [hit] }]);
  });

  it('does not pin hits outside the chosen product type', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await chooseMenuOption(/Product type/, 'snowboard');
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'sku-managed-1' },
    });
    await waitFor(() => expect(api.skuMatches).toHaveBeenCalled());
    await settle();
    expect(
      screen.queryByRole('region', { name: 'Exact SKU / barcode matches' }),
    ).toBeNull();
    expect(screen.queryByText('Managed card')).toBeNull();
  });

  it('skips the lookup inside a chosen collection', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await chooseMenuOption(/^Collection/, 'Hydrogen');
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'sku-managed-1' },
    });
    await waitFor(() =>
      expect(lastCall(api.browseCollectionProducts)[0]).toMatchObject({
        first: 250,
      }),
    );
    await settle();
    expect(api.skuMatches).not.toHaveBeenCalled();
    expect(screen.queryByText('Managed card')).toBeNull();
  });
});

describe('PickerModal: filters a collection cannot apply', () => {
  it('keeps the value visible on the disabled chip, and clearable', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await chooseMenuOption(/Product type/, 'giftcard');
    await chooseMenuOption(/^Collection/, 'Hydrogen');
    const chip = await screen.findByRole('button', {
      name: /^Product type: giftcard\. Not applied inside this collection\./,
    });
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear filters' }),
    );
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: undefined,
      }),
    );
    expect(
      screen.getByRole('button', { name: /^Product type$/ }),
    ).not.toHaveAttribute('aria-disabled');
  });
});

describe('PickerModal: variants available for sale', () => {
  const two = product(5, { title: 'Two board', variantsCount: { count: 2 } });
  const red = variant(41, two, 'Red');
  const blue = variant(42, two, 'Blue', { availableForSale: false });

  beforeEach(() => {
    api.browseProducts.mockResolvedValue(page([two]));
    api.productVariants.mockResolvedValue({
      variantsCount: 2,
      options: [],
      page: page([red, blue]),
    });
  });

  it('keeps sold-out variants out of a field that only allows available ones', async () => {
    renderPicker(variantParameters({ scope: { availableOnly: true } }));
    await userEvent.click(await findCard('Two board'));
    const panel = await screen.findByRole('region', {
      name: 'Variants of Two board',
    });
    const [redBox, blueBox] = await within(panel).findAllByRole('checkbox');
    expect(blueBox).toHaveAttribute('aria-disabled', 'true');
    expect(redBox).not.toHaveAttribute('aria-disabled');
    await userEvent.click(blueBox);
    expect(blueBox).not.toBeChecked();
    expect(selectionCount('0 selected')).toBeInTheDocument();
    await userEvent.click(redBox);
    expect(selectionCount('1 selected')).toBeInTheDocument();
  });

  it('does not resolve a sold-out variant while Available for sale is on', async () => {
    const { resolve } = renderPicker(
      variantParameters({ cardinality: 'single' }),
    );
    await findCard('Two board');
    await userEvent.click(
      screen.getByRole('button', { name: 'Available for sale' }),
    );
    await userEvent.click(await findCard('Two board'));
    const panel = await screen.findByRole('region', {
      name: 'Variants of Two board',
    });
    const blueRow = await within(panel).findByRole('button', { name: /Blue/ });
    expect(blueRow).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(blueRow);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('PickerModal: unresolved selected variants', () => {
  const onlyVariant = variant(11, P1, 'Default Title');
  const unresolvedVariant: PickerSelectedEntry = {
    key: onlyVariant.id,
    id: onlyVariant.id,
    node: null,
    fallbackLabel: 'Alpha board',
  };

  beforeEach(() => {
    api.browseProducts.mockResolvedValue(page([P1, P2]));
    api.productVariants.mockResolvedValue({
      variantsCount: 1,
      options: [],
      page: page([onlyVariant]),
    });
  });

  it('loads their nodes on open, so their products show selected', async () => {
    api.loadNodes.mockImplementation(async (ids: string[]) =>
      ids.map((id) => (id === onlyVariant.id ? onlyVariant : null)),
    );
    renderPicker(variantParameters({}, { selected: [unresolvedVariant] }));
    const alpha = await findCard('Alpha board');
    await waitFor(() => expect(alpha).toBeChecked());
    expect(lastCall(api.loadNodes)[0]).toEqual([onlyVariant.id]);
    expect(
      screen.queryByRole('img', { name: /Not visible to the storefront/ }),
    ).toBeNull();
  });

  it('adds, never removes, when picked before its node is known', async () => {
    api.loadNodes.mockReturnValue(new Promise(() => {}));
    const { resolve } = renderPicker(
      variantParameters({}, { selected: [unresolvedVariant] }),
    );
    const alpha = await findCard('Alpha board');
    expect(alpha).not.toBeChecked();
    await userEvent.click(alpha);
    await waitFor(() => expect(alpha).toBeChecked());
    expect(selectionCount('1 selected')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selection' }),
    );
    expect(lastResult(resolve).selected).toEqual([
      { ...unresolvedVariant, node: onlyVariant },
    ]);
  });
});

describe('PickerModal: variant panel pages and errors', () => {
  const variants = Array.from({ length: 8 }, (_, index) =>
    variant(100 + index, MULTI, `Color ${index}`),
  );

  beforeEach(() => {
    api.browseProducts.mockResolvedValue(page([MULTI]));
  });

  it('loads more variants inside the panel', async () => {
    api.productVariants.mockImplementation(
      async (args: { after: string | null }) => ({
        variantsCount: 8,
        options: [],
        page: args.after
          ? page(variants.slice(4))
          : page(variants.slice(0, 4), 'variants-cursor'),
      }),
    );
    renderPicker(variantParameters());
    await userEvent.click(await findCard('Multi board'));
    const panel = await screen.findByRole('region', {
      name: 'Variants of Multi board',
    });
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(4),
    );
    await userEvent.click(
      within(panel).getByRole('button', { name: 'Load more variants' }),
    );
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(8),
    );
    expect(lastCall(api.productVariants)[0]).toMatchObject({
      productId: MULTI.id,
      after: 'variants-cursor',
    });
    expect(
      within(panel).queryByRole('button', { name: 'Load more variants' }),
    ).toBeNull();
  });

  it('explains a product the storefront no longer sees', async () => {
    api.productVariants.mockResolvedValue(null);
    renderPicker(variantParameters());
    await userEvent.click(await findCard('Multi board'));
    const panel = await screen.findByRole('region', {
      name: 'Variants of Multi board',
    });
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Not visible to the storefront: it may be unpublished from the Headless channel, archived, or deleted.',
    );
  });
});

describe('PickerModal: current choice and the tray', () => {
  it('marks the current choice in single mode', async () => {
    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ cardinality: 'single' }),
        selected: [selectedEntry(P2, 'Bravo board')],
      }),
    );
    const bravo = await findCard('Bravo board');
    expect(bravo).toHaveAttribute('aria-current', 'true');
    expect(bravo).not.toHaveAttribute('aria-pressed');
    expect(card('Alpha board')).not.toHaveAttribute('aria-current');
  });

  it('marks the current variant row in single mode', async () => {
    const two = product(5, { title: 'Two board', variantsCount: { count: 2 } });
    const red = variant(41, two, 'Red');
    api.browseProducts.mockResolvedValue(page([two]));
    api.productVariants.mockResolvedValue({
      variantsCount: 2,
      options: [],
      page: page([red, variant(42, two, 'Blue')]),
    });
    renderPicker(
      variantParameters(
        { cardinality: 'single' },
        { selected: [selectedEntry(red, 'Two board — Red')] },
      ),
    );
    await userEvent.click(await findCard('Two board'));
    const panel = await screen.findByRole('region', {
      name: 'Variants of Two board',
    });
    expect(
      await within(panel).findByRole('button', { name: /Red/ }),
    ).toHaveAttribute('aria-current', 'true');
    expect(
      within(panel).getByRole('button', { name: /Blue/ }),
    ).not.toHaveAttribute('aria-current');
  });

  it('keeps keyboard focus in the tray when an item is removed', async () => {
    renderPicker(
      modalParameters({
        selected: [
          selectedEntry(P1, 'Alpha board'),
          selectedEntry(P2, 'Bravo board'),
        ],
      }),
    );
    await screen.findByText('Charlie board');
    const tray = screen.getByRole('list', { name: 'Selection' });
    act(() =>
      within(tray).getByRole('button', { name: 'Remove Alpha board' }).focus(),
    );
    await userEvent.keyboard('[Enter]');
    expect(
      within(tray).getByRole('img', { name: 'Bravo board' }),
    ).toHaveFocus();
    act(() =>
      within(tray).getByRole('button', { name: 'Remove Bravo board' }).focus(),
    );
    await userEvent.keyboard('[Enter]');
    expect(
      screen.getByRole('button', { name: 'Apply selection' }),
    ).toHaveFocus();
  });

  it('shows every tray item as a square tile named by its tooltip', async () => {
    renderPicker(
      modalParameters({
        selected: [
          selectedEntry(P1, 'Alpha board'),
          {
            key: 'gid://shopify/Product/77',
            id: 'gid://shopify/Product/77',
            node: null,
            fallbackLabel: 'Retired board',
          },
        ],
      }),
    );
    const tray = await screen.findByRole('list', { name: 'Selection' });
    // No image: a blank tile, not a text chip.
    expect(
      within(tray).getByRole('img', { name: 'Alpha board' }),
    ).toHaveTextContent('');
    // Not visible: the field editor's sentence, word for word.
    expect(
      within(tray).getByRole('img', {
        name: 'Retired board. Not visible to the storefront: it may be unpublished from the Headless channel, archived, or deleted.',
      }),
    ).toHaveTextContent('');
  });
});

describe('PickerModal: market menu', () => {
  it('lists countries by name', async () => {
    renderPicker();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Market: IT · EUR · EN' }),
    );
    const names = [
      'Australia (AUD)',
      'Italy (EUR)',
      'Mexico (MXN)',
      'United Arab Emirates (AED)',
    ].map((name) => screen.getByText(name));
    for (const [index, element] of names.slice(1).entries()) {
      expect(
        names[index].compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('shows when Shopify answered in another language', async () => {
    api.appliedContext.mockReturnValue({ country: 'IT', language: 'EN' });
    renderPicker(
      modalParameters({ context: { country: 'IT', language: 'DE' } }),
    );
    await screen.findByText('Alpha board');
    expect(
      screen.getByText(
        "DE isn't published for this market, so Shopify answered in EN",
        { selector: '[role="status"]' },
      ),
    ).toBeInTheDocument();
  });
});

describe('PickerModal: thumbnails', () => {
  const SCENE =
    'Top and bottom view of a snowboard. The top view shows 7 stacked hexagons.';

  it('keeps Shopify alt text out of card names', async () => {
    const pictured = product(9, {
      title: 'Hydro board',
      featuredImage: {
        url: 'https://cdn.shopify.com/hydro.png',
        altText: SCENE,
      },
    });
    api.browseProducts.mockResolvedValue(page([pictured, P1]));
    renderPicker();
    expect(await findCard('Hydro board')).toBeInTheDocument();
    expect(screen.queryByAltText(SCENE)).toBeNull();
  });

  it('keeps Shopify alt text out of variant checkbox names', async () => {
    const parent = product(10, {
      title: 'Hydro board',
      variantsCount: { count: 2 },
    });
    const image = { url: 'https://cdn.shopify.com/ice.png', altText: SCENE };
    api.browseProducts.mockResolvedValue(page([parent]));
    api.productVariants.mockResolvedValue({
      variantsCount: 2,
      options: [],
      page: page([
        variant(11, parent, 'Ice', { image }),
        variant(12, parent, 'Fire', { image }),
      ]),
    });
    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ kind: 'variant' }),
      }),
    );
    await userEvent.click(await findCard('Hydro board'));
    const panel = await screen.findByRole('region', {
      name: 'Variants of Hydro board',
    });
    expect(
      await within(panel).findByRole('checkbox', { name: /^Ice/ }),
    ).toBeInTheDocument();
    expect(screen.queryByAltText(SCENE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Menus from the keyboard (real kit Dropdown, through ui/Menu)
// ---------------------------------------------------------------------------

/** Focuses a menu trigger and opens it with Enter; the menu decorates async. */
async function openMenuWithKeyboard(name: RegExp | string) {
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name });
  act(() => trigger.focus());
  await user.keyboard('{Enter}');
  await settle();
  return { user, trigger };
}

describe('PickerModal: menus from the keyboard', () => {
  it('sorts from the keyboard and gives focus back to the trigger', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    const { user, trigger } = await openMenuWithKeyboard(/^Sort:/);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // More than 5 options: the kit's search field takes focus.
    const menu = screen.getByRole('menu', { name: /^Sort:/ });
    expect(document.activeElement?.tagName).toBe('INPUT');
    expect(
      screen.getByRole('menuitemradio', { name: 'Title A–Z' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('menuitemradio', { name: 'Newest' }),
    ).toHaveAttribute('aria-checked', 'false');
    await user.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('menuitemradio', { name: 'Best selling' }),
    ).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        sortKey: 'CREATED_AT',
        reverse: true,
      }),
    );
    await settle();
    expect(menu).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent('Sort: Newest');
  });

  it('chooses a collection from the keyboard', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    const { user, trigger } = await openMenuWithKeyboard(/^Collection/);
    const all = screen.getByRole('menuitemradio', { name: 'All products' });
    expect(all).toHaveFocus();
    expect(all).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('menuitemradio', { name: 'Hydrogen' }),
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(lastCall(api.browseCollectionProducts)[0]).toMatchObject({
        collectionId: COLLECTIONS[0].id,
      }),
    );
    await settle();
    expect(trigger).toHaveFocus();
  });

  it('closes on Escape and Tab, back on the trigger', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    const { user, trigger } = await openMenuWithKeyboard(/^Product type/);
    expect(
      screen.getByRole('menuitemradio', { name: 'Any product type' }),
    ).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    await settle();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Tab}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('switches the market from the keyboard', async () => {
    renderPicker();
    await screen.findByRole('button', { name: 'Market: IT · EUR · EN' });
    const { user, trigger } = await openMenuWithKeyboard(
      'Market: IT · EUR · EN',
    );
    expect(
      screen.getByRole('menuitemradio', { name: 'Italy (EUR)' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('group', { name: 'Country' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitemradio', { name: 'Australia (AUD)' }),
    ).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(last(lastCall(api.browseProducts))).toEqual({
        country: 'MX',
        language: 'EN',
      }),
    );
    await settle();
    expect(trigger).toHaveFocus();
  });

  it('toggles tags from the keyboard, keeping the menu open and their state', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    const { user, trigger } = await openMenuWithKeyboard(/^Tags/);
    const premium = screen.getByRole('menuitemcheckbox', { name: 'Premium' });
    expect(premium).toHaveFocus();
    expect(premium).toHaveAttribute('aria-checked', 'false');
    await user.keyboard('{Enter}');
    await settle();
    // Still open, focus still on the toggled tag, now checked.
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Premium' }),
    ).toHaveFocus();
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Premium' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Sport' }),
    ).toHaveAttribute('aria-checked', 'false');
    // "Any tag" clears them: an action, not a choice.
    expect(screen.getByRole('menuitem', { name: 'Any tag' })).toBeVisible();
    await user.keyboard('{ArrowDown}{Enter}');
    await settle();
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: '(tag:Premium OR tag:Sport)',
      }),
    );
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Sport' }),
    ).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent('Tags: Premium or Sport');
  });
});

// ---------------------------------------------------------------------------
// Focus after controls that leave or turn disabled
// ---------------------------------------------------------------------------

describe('PickerModal: focus stays in the picker', () => {
  it('moves focus to the search after Clear empties the tray', async () => {
    renderPicker(
      modalParameters({ selected: [selectedEntry(P1, 'Alpha board')] }),
    );
    await screen.findByText('Charlie board');
    const clear = screen.getByRole('button', { name: 'Clear' });
    act(() => clear.focus());
    await userEvent.keyboard('[Enter]');
    expect(selectionCount('0 selected')).toBeInTheDocument();
    expect(clear).toBeDisabled();
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('moves focus to the search after Clear filters', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.click(
      screen.getByRole('button', { name: 'Available for sale' }),
    );
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    act(() => clear.focus());
    await userEvent.keyboard('[Enter]');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('keeps Load more focusable while loading, then focuses the first new item', async () => {
    let finish: (value: Page<ProductSummary>) => void = () => {};
    api.browseProducts
      .mockResolvedValueOnce(page([P1, P2], 'cursor-1'))
      .mockReturnValueOnce(
        new Promise<Page<ProductSummary>>((resolve) => {
          finish = resolve;
        }),
      );
    renderPicker();
    await screen.findByText('Alpha board');
    const loadMore = screen.getByRole('button', { name: 'Load more products' });
    act(() => loadMore.focus());
    await userEvent.keyboard('[Enter]');
    expect(loadMore).toHaveFocus();
    expect(loadMore).toBeEnabled();
    expect(screen.getByText('Loading more products…')).toBeInTheDocument();
    // A second press while loading asks for nothing more.
    await userEvent.keyboard('[Enter]');
    expect(api.browseProducts).toHaveBeenCalledTimes(2);

    await act(async () => finish(page([P3])));
    // The last page: the button leaves, and focus lands on what it loaded.
    await waitFor(() => expect(card('Charlie board')).toHaveFocus());
    expect(card('Charlie board')).toHaveAttribute('tabindex', '0');
    expect(
      screen.queryByRole('button', { name: 'Load more products' }),
    ).toBeNull();
  });

  it('leaves focus alone when infinite scroll loads a page', async () => {
    api.browseProducts
      .mockResolvedValueOnce(page([P1, P2], 'cursor-1'))
      .mockResolvedValueOnce(page([P3]));
    renderPicker();
    await screen.findByText('Alpha board');
    act(() => io.intersect(true));
    expect(await screen.findByText('Charlie board')).toBeInTheDocument();
    await settle();
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('focuses the Try again of a failed page, then the first new item', async () => {
    api.browseProducts
      .mockResolvedValueOnce(page([P1, P2], 'cursor-1'))
      .mockRejectedValueOnce(new ShopifyClientError('network', 'offline'))
      .mockResolvedValueOnce(page([P3]));
    renderPicker();
    await screen.findByText('Alpha board');
    act(() =>
      screen.getByRole('button', { name: 'Load more products' }).focus(),
    );
    await userEvent.keyboard('[Enter]');
    const alert = await screen.findByRole('alert');
    await waitFor(() =>
      expect(
        within(alert).getByRole('button', { name: 'Try again' }),
      ).toHaveFocus(),
    );
    await userEvent.keyboard('[Enter]');
    await waitFor(() => expect(card('Charlie board')).toHaveFocus());
  });

  it('focuses the first result after Try again succeeds', async () => {
    api.browseProducts.mockRejectedValueOnce(
      new ShopifyClientError('network', 'offline'),
    );
    renderPicker();
    const alert = await screen.findByRole('alert');
    act(() => within(alert).getByRole('button', { name: 'Try again' }).focus());
    await userEvent.keyboard('[Enter]');
    await waitFor(() => expect(card('Alpha board')).toHaveFocus());
  });

  it('focuses the first new variant after Load more variants', async () => {
    const variants = Array.from({ length: 6 }, (_, index) =>
      variant(100 + index, MULTI, `Color ${index}`),
    );
    api.browseProducts.mockResolvedValue(page([MULTI]));
    api.productVariants.mockImplementation(
      async (args: { after: string | null }) => ({
        variantsCount: 6,
        options: [],
        page: args.after
          ? page(variants.slice(3))
          : page(variants.slice(0, 3), 'variants-cursor'),
      }),
    );
    renderPicker(variantParameters());
    await userEvent.click(await findCard('Multi board'));
    const panel = await screen.findByRole('region', {
      name: 'Variants of Multi board',
    });
    const loadMore = await within(panel).findByRole('button', {
      name: 'Load more variants',
    });
    act(() => loadMore.focus());
    await userEvent.keyboard('[Enter]');
    await waitFor(() =>
      expect(
        within(panel).getByRole('checkbox', { name: /^Color 3/ }),
      ).toHaveFocus(),
    );
  });
});

// ---------------------------------------------------------------------------
// Capabilities detected on open
// ---------------------------------------------------------------------------

const PROBE_DOMAIN = 'probe-store.myshopify.com';
const PROBE_PLUGIN_PARAMETERS = {
  paramsVersion: '3',
  stores: [
    {
      shopDomain: PROBE_DOMAIN,
      storefrontAccessToken: '0'.repeat(32),
      tokenless: false,
    },
  ],
  useDemoStore: false,
  autoApplyToFieldsWithApiKey: '',
};

describe('PickerModal: a store without detected capabilities', () => {
  function renderProbeStore() {
    const { ctx } = createCtx(
      modalParameters({ shopDomain: PROBE_DOMAIN }),
      PROBE_PLUGIN_PARAMETERS,
    );
    return render(<PickerModal ctx={ctx} />);
  }

  beforeEach(() => {
    api.knownCapabilities = false;
  });

  it('asks for the filter values once, after detection, with the tags', async () => {
    api.capabilities = { tags: false, inventory: false, metafields: false };
    api.detectCapabilities.mockImplementation(async () => {
      api.capabilities = { tags: true, inventory: false, metafields: false };
      return {
        tags: true,
        inventory: false,
        metafields: false,
        checkedAt: '2026-10-04T12:00:00Z',
      };
    });
    renderProbeStore();
    await screen.findByText('Alpha board');
    await waitFor(() => expect(api.filterValues).toHaveBeenCalledTimes(1));
    expect(api.detectCapabilities).toHaveBeenCalledTimes(1);
    expect(
      api.detectCapabilities.mock.invocationCallOrder[0] ?? 0,
    ).toBeLessThan(api.filterValues.mock.invocationCallOrder[0] ?? 0);
    expect(
      await screen.findByRole('button', { name: /^Tags$/ }),
    ).toBeInTheDocument();
    await settle();
    expect(api.filterValues).toHaveBeenCalledTimes(1);
  });

  it("doesn't probe again in a reopened picker", async () => {
    const first = renderProbeStore();
    await screen.findByText('Alpha board');
    await waitFor(() => expect(api.filterValues).toHaveBeenCalledTimes(1));
    first.unmount();
    expect(api.detectCapabilities).toHaveBeenCalledTimes(1);

    renderProbeStore();
    await screen.findByText('Alpha board');
    await waitFor(() => expect(api.filterValues).toHaveBeenCalledTimes(2));
    expect(api.detectCapabilities).toHaveBeenCalledTimes(1);
  });

  it('never probes when the capabilities are known', async () => {
    api.knownCapabilities = true;
    renderProbeStore();
    await screen.findByText('Alpha board');
    await waitFor(() => expect(api.filterValues).toHaveBeenCalledTimes(1));
    expect(api.detectCapabilities).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Tags$/ })).toBeInTheDocument();
  });

  it('holds the Tags chip in place while detecting, then loads the values once', async () => {
    let finish: (value: unknown) => void = () => {};
    api.detectCapabilities.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderProbeStore();
    await screen.findByText('Alpha board');
    const checking = screen.getByRole('button', {
      name: /^Tags\. Checking whether the token can read product tags/,
    });
    expect(checking).toHaveAttribute('aria-disabled', 'true');
    // Product types wait too: one request, with or without the tags.
    expect(api.filterValues).not.toHaveBeenCalled();

    await act(async () =>
      finish({
        tags: true,
        inventory: false,
        metafields: false,
        checkedAt: '2026-10-04T12:00:00Z',
      }),
    );
    const tags = await screen.findByRole('button', { name: /^Tags$/ });
    expect(tags).toHaveAttribute('aria-haspopup', 'menu');
    // The chip kept its place: still right before the vendor filter.
    expect(
      tags.compareDocumentPosition(
        screen.getByRole('textbox', { name: 'Filter by vendor' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await waitFor(() => expect(api.filterValues).toHaveBeenCalledTimes(1));
  });

  it('drops the Tags chip when detection finds no tag access', async () => {
    api.capabilities = { tags: false, inventory: false, metafields: false };
    api.detectCapabilities.mockRejectedValue(new Error('offline'));
    renderProbeStore();
    await screen.findByText('Alpha board');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Tags/ })).toBeNull(),
    );
    await waitFor(() => expect(api.filterValues).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// One selection control, one meta line
// ---------------------------------------------------------------------------

describe('PickerModal: items look the same everywhere', () => {
  it('uses native checkboxes in multiple fields and buttons in single ones', async () => {
    window.localStorage.setItem(PICKER_VIEW_STORAGE_KEY, 'list');
    renderPicker();
    const row = await findCard('Alpha board');
    expect(row).toBeInstanceOf(HTMLInputElement);
    expect(row).toHaveAttribute('type', 'checkbox');
    cleanup();

    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ cardinality: 'single' }),
      }),
    );
    expect(await findCard('Alpha board')).toBeInstanceOf(HTMLButtonElement);
  });

  it("shows the only variant's SKU in the list view", async () => {
    window.localStorage.setItem(PICKER_VIEW_STORAGE_KEY, 'list');
    api.browseProducts.mockResolvedValue(
      page([P1, product(5, { title: 'Echo board', sku: 'BOARD-ECHO' }), MULTI]),
    );
    renderPicker();
    await screen.findByText('Alpha board');
    const row = (title: string) => card(title).closest('label') as HTMLElement;
    expect(within(row('Echo board')).getByText('BOARD-ECHO').tagName).toBe(
      'CODE',
    );
    expect(within(row('Alpha board')).getByText('No SKU')).toBeVisible();
    // Several variants: the Variants column already counts them.
    expect(within(row('Multi board')).queryByText('No SKU')).toBeNull();
    expect(within(row('Multi board')).getByText('8 variants')).toBeVisible();
  });

  it('shows vendor and product type on grid cards, as in list rows', async () => {
    renderPicker();
    const alpha = await findCard('Alpha board');
    expect(alpha.closest('label')).toHaveTextContent(
      'Snowboard Vendor · snowboard',
    );
  });

  it('names the availability filter as the field settings do', async () => {
    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ scope: { availableOnly: true } }),
      }),
    );
    await screen.findByText('Alpha board');
    expect(
      screen.getByText('Available for sale').closest('[tabindex]'),
    ).toHaveTextContent('Available for sale. Set in the field settings');
    expect(screen.queryByText('In stock')).toBeNull();
  });
});
