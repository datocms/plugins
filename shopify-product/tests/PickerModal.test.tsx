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

// The infinite scroll needs an IntersectionObserver that reports entries: it
// records what it observes so tests can bring the sentinel into view with
// `intersect()`.
const io = vi.hoisted(() => {
  type Callback = (entries: unknown[], observer: unknown) => void;
  const live = new Set<{ callback: Callback; targets: Set<Element> }>();
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
  Object.assign(globalThis, { IntersectionObserver: IntersectionObserverMock });
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
    site: { attributes: { internal_domain: null } },
    bodyPadding: [20, 20, 20, 20],
    cssDesignTokens: {},
    colorScheme: 'light',
    theme: {},
    resolve,
    setHeight,
    alert,
    notice: vi.fn(async () => {}),
    customToast: vi.fn(async () => {}),
    openConfirm: vi.fn(async () => null),
    navigateTo: vi.fn(async () => {}),
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

/** Text in the results and bars, not in the visually hidden announcements. */
const VISIBLE_TEXT = { ignore: '[role="status"], script, style' };

/** A result: its card in the grid, or its row of the table. */
function item(title: string): HTMLElement {
  const holder = screen
    .getAllByText(title, VISIBLE_TEXT)
    .map((element) => element.closest<HTMLElement>('[data-picker-item]'))
    .find((element) => element !== null);
  if (!holder) throw new Error(`No result is titled "${title}"`);
  return holder;
}

function findItem(title: string): Promise<HTMLElement> {
  return waitFor(() => item(title));
}

/**
 * The control that picks or opens a result. Multiple fields: its checkbox
 * (a card's names it by its caption, a row's by its first cell). Single
 * fields, and products that open their variants: the card's media button.
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

/** The row of the table, or the card, that holds this text. */
function holderOf(text: string, container: HTMLElement = document.body) {
  const element = within(container).getByText(text);
  const holder = element.closest<HTMLElement>('[data-picker-item]');
  if (!holder) throw new Error(`"${text}" isn't in a result`);
  return holder;
}

/** The text filter of the results, in the search landmark the Pane names. */
function searchField(name = 'Products'): HTMLElement {
  return within(screen.getByRole('search', { name })).getByRole('textbox');
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

/** Opens a menu by its trigger and picks one of its options. */
async function chooseMenuOption(trigger: RegExp, option: string) {
  await userEvent.click(screen.getByRole('button', { name: trigger }));
  await userEvent.click(await screen.findByRole('menuitem', { name: option }));
}

/** The variants a card opened, in the band under its row. */
function findPanel(title: string): Promise<HTMLElement> {
  return screen.findByRole('group', { name: `Variants of ${title}` });
}

function startInListView() {
  window.localStorage.setItem(PICKER_VIEW_STORAGE_KEY, 'list');
}

/** Lets pending promises (mocked requests) settle and re-render. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * The kit's menus read `keyCode`, which user-event leaves at 0 in jsdom: keys
 * on a menu or its trigger go through fireEvent.
 */
const KEY_CODES = {
  Enter: 13,
  Escape: 27,
  Tab: 9,
  ArrowDown: 40,
} as const;

function press(key: keyof typeof KEY_CODES) {
  const code = KEY_CODES[key];
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key,
    code: key,
    keyCode: code,
    which: code,
  });
}

/** Focuses a menu trigger and opens it with Enter; the menu takes focus. */
async function openMenuWithKeyboard(name: RegExp | string) {
  const trigger = screen.getByRole('button', { name });
  act(() => trigger.focus());
  press('Enter');
  await settle();
  return trigger;
}

/** Moves the open menu's highlight down to an option. */
function highlight(
  option: string,
  role: 'menuitem' | 'menuitemcheckbox' = 'menuitem',
) {
  const menu = screen.getByRole('menu');
  const target = screen.getByRole(role, { name: option });
  // The menu, or its search field (over 5 options), holds the highlight.
  const active = document.activeElement;
  const holder =
    active instanceof HTMLElement && menu.contains(active) ? active : menu;
  for (let step = 0; step < 12; step += 1) {
    if (holder.getAttribute('aria-activedescendant') === target.id) break;
    press('ArrowDown');
  }
  expect(holder).toHaveAttribute('aria-activedescendant', target.id);
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
    expect(searchField()).toHaveFocus();
    // The placeholder, also the field's name, shows what the search finds.
    expect(searchField()).toHaveAttribute(
      'placeholder',
      'T-shirt, SKU or barcode',
    );
    expect(lastCall(api.browseProducts)[0]).toEqual({
      first: PICKER_PAGE_SIZE,
      after: null,
      query: undefined,
      sortKey: 'TITLE',
      reverse: false,
    });
  });

  it('shows a loading state while the first page loads', () => {
    api.browseProducts.mockReturnValue(new Promise(() => {}));
    renderPicker();
    expect(screen.getByText('Loading the products')).toBeInTheDocument();
    expect(screen.getByText('Loading products…')).toBeInTheDocument();
  });

  it('explains invalid parameters instead of guessing', () => {
    renderPicker({ fieldParameters: 'nope' });
    expect(screen.getByText("Couldn't open the picker")).toBeInTheDocument();
    expect(api.browseProducts).not.toHaveBeenCalled();
  });

  it('explains that the plugin has no store yet, without calling Shopify', () => {
    const { ctx } = createCtx(modalParameters(), {
      ...DEMO_PLUGIN_PARAMETERS,
      useDemoStore: false,
    });
    render(<PickerModal ctx={ctx} />);
    expect(screen.getByText("The plugin isn't set up yet")).toBeInTheDocument();
    expect(api.browseProducts).not.toHaveBeenCalled();
  });

  it('explains a store that is no longer connected', () => {
    renderPicker(modalParameters({ shopDomain: 'gone.myshopify.com' }));
    expect(screen.getByText('Store not connected')).toBeInTheDocument();
    expect(
      screen.getByText(/This field browses gone\.myshopify\.com/),
    ).toBeInTheDocument();
  });
});

describe('PickerModal: search', () => {
  it('debounces the search and escapes it into the query', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    api.browseProducts.mockClear();
    const search = searchField();
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

  it('keeps the last results on screen while a new search loads', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    let answer: (value: Page<ProductSummary>) => void = () => {};
    api.browseProducts.mockReturnValueOnce(
      new Promise<Page<ProductSummary>>((resolve) => {
        answer = resolve;
      }),
    );

    fireEvent.change(searchField(), {
      target: { value: 'charlie' },
    });
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: expect.stringContaining('charlie'),
      }),
    );
    // No first-load blank slate: the list stays, and says it loads.
    expect(screen.getByText('Alpha board')).toBeInTheDocument();
    expect(screen.queryByText('Loading the products')).toBeNull();
    expect(screen.getByText('Loading products…')).toHaveAttribute(
      'role',
      'status',
    );
    expect(
      screen.queryByRole('button', { name: 'Load more products' }),
    ).toBeNull();

    await act(async () => answer(page([P3])));
    expect(await screen.findByText('Charlie board')).toBeInTheDocument();
    expect(screen.queryByText('Alpha board')).toBeNull();
    expect(screen.getByText('1 product shown')).toBeInTheDocument();
  });

  it("doesn't pick the last results while new ones load", async () => {
    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ cardinality: 'single' }),
      }),
    );
    await findCard('Bravo board');
    let answer: (value: Page<ProductSummary>) => void = () => {};
    api.browseProducts.mockReturnValueOnce(
      new Promise<Page<ProductSummary>>((resolve) => {
        answer = resolve;
      }),
    );
    fireEvent.change(searchField(), {
      target: { value: 'charlie' },
    });
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: expect.stringContaining('charlie'),
      }),
    );
    // Still on screen, but from the previous query: shown as unavailable
    // (no button to pick it), and a click does nothing.
    expect(
      within(item('Bravo board')).queryByRole('button', {
        name: /^Bravo board/,
      }),
    ).toBeNull();
    await userEvent.click(within(item('Bravo board')).getByText('Bravo board'));
    expect(resolve).not.toHaveBeenCalled();

    await act(async () => answer(page([P3])));
    await userEvent.click(await findCard('Charlie board'));
    expect(lastResult(resolve).selected[0]).toMatchObject({ id: P3.id });
  });

  it('shows the loading state, not "no match", while a search in a collection loads', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await chooseMenuOption(/^Collection/, 'Hydrogen');
    await waitFor(() => expect(screen.queryByText('Charlie board')).toBeNull());
    expect(screen.getByText('Bravo board')).toBeInTheDocument();
    let answer: (value: unknown) => void = () => {};
    api.browseCollectionProducts.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    // The text is matched in the browser: none of the kept products match.
    fireEvent.change(searchField(), {
      target: { value: 'charlie' },
    });
    await waitFor(() =>
      expect(lastCall(api.browseCollectionProducts)[0]).toMatchObject({
        first: 250,
      }),
    );
    expect(screen.getByText('Loading the products')).toBeInTheDocument();
    expect(screen.queryByText('No products match')).toBeNull();
    expect(screen.queryByText(/loaded so far match/)).toBeNull();

    await act(async () =>
      answer({
        found: true,
        page: page([P1, P2, P3]),
        filters: AVAILABILITY_ONLY,
      }),
    );
    expect(await screen.findByText('Charlie board')).toBeInTheDocument();
    expect(screen.queryByText('Loading the products')).toBeNull();
    expect(screen.queryByText('Alpha board')).toBeNull();
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
    await userEvent.type(searchField(), 'sku-managed-1');
    const group = await screen.findByRole('group', {
      name: 'SKU and barcode matches',
    });
    expect(within(group).getByRole('heading', { level: 2 })).toHaveTextContent(
      'SKU and barcode matches',
    );
    expect(within(group).getByText('Managed board')).toBeInTheDocument();
    expect(
      within(group).getByText('sku-managed-1').parentElement,
    ).toHaveTextContent('SKU sku-managed-1');
    expect(lastCall(api.skuMatches)[0]).toBe('sku-managed-1');
    // The pinned product isn't repeated in the main results.
    const main = await screen.findByRole('group', { name: 'All products' });
    expect(within(main).queryByText('Managed board')).toBeNull();
    expect(within(main).getByText('Alpha board')).toBeInTheDocument();
  });

  it('does not run the SKU lookup for text with spaces', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    fireEvent.change(searchField(), {
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
    await userEvent.type(searchField(), 'sku-managed-1');
    const group = await screen.findByRole('group', {
      name: 'SKU and barcode matches',
    });
    // A row of the variants' table: a click picks it.
    await userEvent.click(within(group).getByText('Managed board — Black'));
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
    await chooseMenuOption(/^Product type: Any/, 'snowboard');
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: 'product_type:snowboard',
      }),
    );
    expect(
      screen.getByRole('button', { name: /^Product type: snowboard/ }),
    ).toBeInTheDocument();
    await chooseMenuOption(/^Availability/, 'Available for sale');
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
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('Premium'));
    // The checkboxes keep the menu open.
    await userEvent.click(within(menu).getByText('Sport'));
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Sport' }),
    ).toHaveAttribute('aria-checked', 'true');
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: '(tag:Premium OR tag:Sport)',
      }),
    );

    // The menu's footer unchecks them all, closes it and refocuses its pill.
    await userEvent.click(
      within(menu).getByRole('button', { name: 'Clear tags' }),
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    const trigger = screen.getByRole('button', { name: /^Tags/ });
    expect(trigger).toHaveTextContent('Tags: Any');
    expect(trigger).toHaveFocus();
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: undefined,
      }),
    );
  });

  it('shows Clear tags only while some tag is checked', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.click(screen.getByRole('button', { name: /^Tags/ }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).queryByRole('button', { name: 'Clear tags' }),
    ).toBeNull();
    // A checkbox menu: no "Any tag" choice among the tags.
    expect(
      within(menu).queryByRole('menuitem', { name: 'Any tag' }),
    ).toBeNull();
    await userEvent.click(within(menu).getByText('Premium'));
    expect(
      within(menu).getByRole('button', { name: 'Clear tags' }),
    ).toBeVisible();
  });

  it('hides the tag filter without the tags capability', async () => {
    api.capabilities = { tags: false, inventory: false, metafields: false };
    renderPicker();
    await screen.findByText('Alpha board');
    expect(screen.queryByRole('button', { name: /^Tags/ })).toBeNull();
  });

  it('switches to the collection query and hides the filters it does not enable', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await chooseMenuOption(/^Collection/, 'Hydrogen');
    await waitFor(() =>
      expect(api.browseCollectionProducts).toHaveBeenCalled(),
    );
    expect(lastCall(api.browseCollectionProducts)[0]).toMatchObject({
      collectionId: 'gid://shopify/Collection/1',
      sortKey: 'COLLECTION_DEFAULT',
      filters: [],
    });
    // Its Search & Discovery settings only enable availability.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /^Product type/ }),
      ).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: /^Tags/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Vendor/ })).toBeNull();
    await chooseMenuOption(/^Availability/, 'Available for sale');
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
    // The field's scope shows as locked pills, not as menus.
    expect(await screen.findByText('Collection: Hydrogen')).toBeInTheDocument();
    expect(screen.getByText('Vendor: Hydrogen Vendor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Collection/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Vendor/ })).toBeNull();
  });

  it('sorts with the matching Shopify sort key', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.click(screen.getByRole('button', { name: /^Sort:/ }));
    expect(screen.queryByRole('menuitem', { name: 'Relevance' })).toBeNull();
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Price high → low' }),
    );
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
    await chooseMenuOption(/^Availability/, 'Available for sale');
    expect(
      await screen.findByText('No products match', VISIBLE_TEXT),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Only products published to the Headless storefront/),
    ).toBeInTheDocument();
    const clear = screen.getAllByRole('button', { name: 'Clear filters' });
    expect(clear).toHaveLength(2);
    await userEvent.click(clear[clear.length - 1]);
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: undefined,
      }),
    );
  });

  it('says when the storefront shows nothing at all', async () => {
    api.browseProducts.mockResolvedValue(page([]));
    renderPicker();
    expect(
      await screen.findByText('No products visible to this storefront'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Only products published to the Headless storefront/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it("says nothing matches when the field's limits leave nothing", async () => {
    api.browseProducts.mockResolvedValue(page([]));
    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ scope: { vendor: 'Nobody' } }),
      }),
    );
    expect(
      await screen.findByText('No products match', VISIBLE_TEXT),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No products visible to this storefront'),
    ).toBeNull();
    // The limits are the field's: there is nothing for the editor to clear.
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('adds the spelling tip while searching', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    api.browseProducts.mockResolvedValue(page([]));
    fireEvent.change(searchField(), {
      target: { value: 'two words' },
    });
    expect(
      await screen.findByText(/^Check the spelling, or try fewer words\./),
    ).toBeInTheDocument();
    expect(screen.getByText('No products match', VISIBLE_TEXT)).toBeVisible();
  });

  it('shows actionable errors and retries', async () => {
    api.browseProducts.mockRejectedValueOnce(
      new ShopifyClientError('unauthorized', 'HTTP 401'),
    );
    renderPicker();
    expect(
      await screen.findByText("Couldn't load the products"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Shopify rejected the Storefront access token. Update it in the plugin settings.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Couldn't load the products.", {
        selector: '[role="status"]',
      }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Alpha board')).toBeInTheDocument();
  });

  it('explains the market fallback above the results', async () => {
    api.appliedContext.mockReturnValue({ country: 'IT', language: 'EN' });
    renderPicker(
      modalParameters({ context: { country: 'IT', language: 'DE' } }),
    );
    await screen.findByText('Alpha board');
    const notice = screen.getByText(
      "DE isn't published for this market, so Shopify answered in EN.",
    );
    expect(notice.closest('[role="alert"]')).not.toBeNull();
  });
});

describe('PickerModal: selection', () => {
  it('resolves right away in single mode', async () => {
    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ cardinality: 'single' }),
      }),
    );
    // Picking resolves at once: the footer says so, with no Apply.
    expect(
      screen.getByText('Click a product to choose it.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Apply selection' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
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
    expect(selectionCount('1 of 3 products selected')).toBeInTheDocument();
    await userEvent.click(await findCard('Bravo board'));
    await userEvent.click(card('Alpha board'));
    // At the max, the rest can't be picked, and the footer says why after
    // the count.
    expect(
      selectionCount("3 of 3 products selected. You can't select more."),
    ).toBeInTheDocument();
    expect(card('Bravo board')).toBeChecked();
    expect(card('Charlie board')).toBeDisabled();
    expect(
      within(item('Charlie board')).queryByRole('button', {
        name: 'Charlie board',
      }),
    ).toBeNull();
    await userEvent.click(
      within(item('Charlie board')).getByText('Charlie board'),
    );
    expect(
      selectionCount("3 of 3 products selected. You can't select more."),
    ).toBeInTheDocument();
    // The count leads the footer, with the limit ("3 of 3": the selection is
    // full, and why), the tray of chips sits in the middle, then Clear and
    // Apply.
    const footer = screen.getByRole('button', {
      name: 'Apply selection',
    }).parentElement as HTMLElement;
    const parts = Array.from(footer.children).map(
      (part) => part.textContent ?? '',
    );
    expect(parts[0]).toBe("3 of 3 products selected. You can't select more.");
    expect(
      within(footer).getByRole('list', { name: 'Selected products' }),
    ).toBeInTheDocument();
    expect(parts.slice(-2)).toEqual(['Clear', 'Apply selection']);

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
    // Below the max again, the count is alone.
    expect(selectionCount('2 of 3 products selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(selectionCount('0 of 3 products selected')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selection' }),
    );
    expect(lastResult(resolve)).toEqual({ selected: [] });
  });

  it('shows the last results as unavailable while new ones load', async () => {
    renderPicker();
    expect(await findCard('Bravo board')).toBeEnabled();
    api.browseProducts.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.change(searchField(), {
      target: { value: 'charlie' },
    });
    await waitFor(() => expect(card('Bravo board')).toBeDisabled());
    await userEvent.click(within(item('Bravo board')).getByText('Bravo board'));
    expect(selectionCount('0 products selected')).toBeInTheDocument();
  });

  it('reminds the minimum in the count while below it', async () => {
    renderPicker(
      modalParameters({ fieldParameters: fieldParameters({ min: 2 }) }),
    );
    await userEvent.click(await findCard('Alpha board'));
    expect(
      selectionCount('1 product selected · at least 2'),
    ).toBeInTheDocument();
    await userEvent.click(card('Bravo board'));
    expect(selectionCount('2 products selected')).toBeInTheDocument();
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

  it('lets an open product close while new results load, and picks nothing', async () => {
    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ kind: 'variant' }),
      }),
    );
    await userEvent.click(await findCard('Multi board'));
    const panel = await findPanel('Multi board');
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(8),
    );
    api.browseProducts.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.change(searchField(), {
      target: { value: 'charlie' },
    });
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')[0]).toBeDisabled(),
    );
    await userEvent.click(card('Multi board'));
    expect(
      screen.queryByRole('group', { name: 'Variants of Multi board' }),
    ).toBeNull();
    // Closed, it waits for the new results like the other cards.
    expect(
      within(item('Multi board')).queryByRole('button', {
        name: /^Multi board/,
      }),
    ).toBeNull();
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
    // Opening picks nothing: the card doesn't look selected.
    expect(item('Multi board').querySelector('.is-selected')).toBeNull();
    const panel = await findPanel('Multi board');
    expect(multi).toHaveAttribute('aria-controls', panel.id);
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(8),
    );
    expect(within(panel).getByText('8 variants')).toBeInTheDocument();
    expect(lastCall(api.productVariants)[0]).toMatchObject({
      productId: MULTI.id,
      first: 250,
    });

    await userEvent.click(
      within(panel).getByRole('button', { name: /^Color: Any/ }),
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'White' }),
    );
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(4),
    );
    expect(within(panel).getByText('4 of 8 variants')).toBeInTheDocument();

    const [first] = within(panel).getAllByRole('checkbox');
    await userEvent.click(first);
    expect(first).toBeChecked();
    expect(selectionCount('1 variant selected')).toBeInTheDocument();
    expect(
      within(item('Multi board')).getByText('1 variant selected'),
    ).toBeVisible();
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
    expect(alpha).toHaveAttribute('type', 'checkbox');
    await userEvent.click(alpha);
    await waitFor(() =>
      expect(selectionCount('1 variant selected')).toBeInTheDocument(),
    );
    expect(lastCall(api.productVariants)[0]).toMatchObject({
      productId: P1.id,
      first: 1,
    });
    expect(alpha).toBeChecked();
    // Clicking again removes it.
    await userEvent.click(alpha);
    expect(selectionCount('0 variants selected')).toBeInTheDocument();
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
    const panel = await findPanel('Multi board');
    await userEvent.click(await within(panel).findByText('SKU-102'));
    expect(lastResult(resolve).selected[0]).toMatchObject({
      id: variants[2].id,
    });
  });

  it('opens the variants under their product in the list view', async () => {
    startInListView();
    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ kind: 'variant' }),
      }),
    );
    const toggle = await screen.findByRole('button', {
      name: /^Multi board/,
      expanded: false,
    });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() =>
      expect(
        screen.getAllByRole('checkbox', { name: /^(Black|White)/ }),
      ).toHaveLength(8),
    );
    // The product itself isn't picked: its variants are.
    expect(
      screen.getByRole('checkbox', { name: /^Multi board/ }),
    ).toBeDisabled();
    expect(within(item('Multi board')).getByText('8 variants')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^Color: Any/ }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Black' }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole('checkbox', { name: /^(Black|White)/ }),
      ).toHaveLength(4),
    );
    const [first] = screen.getAllByRole('checkbox', { name: /^Black/ });
    await userEvent.click(first);
    expect(first).toBeChecked();
    expect(selectionCount('1 variant selected')).toBeInTheDocument();
    // A product with one variant picks it straight from its row.
    await userEvent.click(
      screen.getByRole('checkbox', { name: /^Alpha board/ }),
    );
    await waitFor(() =>
      expect(selectionCount('2 variants selected')).toBeInTheDocument(),
    );
    await userEvent.click(toggle);
    expect(
      screen.queryAllByRole('checkbox', { name: /^(Black|White)/ }),
    ).toHaveLength(0);
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
    const bravo = await findItem('Bravo board');
    const charlie = item('Charlie board');
    for (const locked of [bravo, charlie]) {
      expect(within(locked).getByText('In this field')).toBeInTheDocument();
      expect(within(locked).queryByRole('button')).toBeNull();
    }
    // The item being replaced is the current choice, and stays pickable.
    expect(card('Alpha board')).toHaveAttribute('aria-current', 'true');

    await userEvent.click(within(bravo).getByText('Bravo board'));
    await userEvent.click(within(charlie).getByText('Charlie board'));
    expect(resolve).not.toHaveBeenCalled();
  });

  it('checks and locks them in multiple fields', async () => {
    renderPicker(replaceParameters({ cardinality: 'multiple' }));
    const bravo = await findCard('Bravo board');
    expect(bravo).toBeChecked();
    expect(bravo).toBeDisabled();
    await userEvent.click(within(item('Bravo board')).getByText('Bravo board'));
    expect(bravo).toBeChecked();
    expect(selectionCount('1 product selected')).toBeInTheDocument();
  });

  it('mutes them in the list view, with their pill', async () => {
    startInListView();
    const { resolve } = renderPicker(replaceParameters());
    const bravo = await findItem('Bravo board');
    expect(within(bravo).getByText('In this field')).toBeInTheDocument();
    expect(bravo.querySelector('[tabindex="0"]')).toBeNull();
    await userEvent.click(within(bravo).getByText('Bravo board'));
    expect(resolve).not.toHaveBeenCalled();
    // The current choice is the active row.
    expect(
      item('Alpha board').querySelector('[aria-current="true"]'),
    ).not.toBeNull();
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
    const panel = await findPanel('Multi board');
    await within(panel).findByText('SKU-202');
    const white = holderOf('SKU-202', panel);
    expect(within(white).getByText('In this field')).toBeInTheDocument();
    await userEvent.click(within(white).getByText('SKU-202'));
    expect(resolve).not.toHaveBeenCalled();
    await userEvent.click(within(panel).getByText('SKU-201'));
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
        "Couldn't choose the variant: it's already in this field.",
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
    expect(searchField('Collections')).toHaveAttribute(
      'placeholder',
      'Summer sale',
    );
    // No filter bar for collections.
    expect(screen.queryByRole('button', { name: /^Collection:/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sort:/ })).toBeNull();
    await userEvent.type(searchField('Collections'), 'hyd');
    await waitFor(() =>
      expect(lastCall(api.collections)[0]).toMatchObject({
        query: 'title:hyd*',
      }),
    );
    // The new query shows its loading state until its page lands.
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
    // The tray's chip takes the collection's own title.
    const tray = screen.getByRole('list', { name: 'Selected collections' });
    await waitFor(() =>
      expect(within(tray).getByText('Hydrogen')).toBeInTheDocument(),
    );
    expect(within(tray).queryByText('Not visible')).toBeNull();
  });

  it('lists collections as a table in the list view', async () => {
    startInListView();
    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({
          kind: 'collection',
          cardinality: 'single',
        }),
      }),
    );
    const frontpage = await findItem('Frontpage');
    expect(within(frontpage).getByText('frontpage')).toBeInTheDocument();
    await userEvent.click(within(frontpage).getByText('Frontpage'));
    expect(lastResult(resolve).selected[0]).toMatchObject({
      id: COLLECTIONS[1].id,
    });
  });
});

describe('PickerModal: keyboard, view and market', () => {
  it('reaches every card with Tab: its media, then its checkbox', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    const media = screen.getByRole('button', { name: 'Alpha board' });
    act(() => media.focus());
    await userEvent.tab();
    expect(card('Alpha board')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Bravo board' })).toHaveFocus();
  });

  it('toggles with Space on the checkbox and Enter on the media', async () => {
    renderPicker();
    const alpha = await findCard('Alpha board');
    act(() => alpha.focus());
    await userEvent.keyboard('[Space]');
    expect(alpha).toBeChecked();
    act(() => screen.getByRole('button', { name: 'Alpha board' }).focus());
    await userEvent.keyboard('[Enter]');
    expect(alpha).not.toBeChecked();
  });

  it('remembers the list view', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();
    expect(window.localStorage.getItem(PICKER_VIEW_STORAGE_KEY)).toBe('list');
    // The list view is a table with column headers.
    expect(screen.getByText('Availability', VISIBLE_TEXT)).toBeInTheDocument();
  });

  it('re-queries in another market and returns it', async () => {
    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ cardinality: 'single' }),
      }),
    );
    const trigger = await screen.findByRole('button', {
      name: 'IT · EUR · EN',
    });
    await userEvent.click(trigger);
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Mexico (MXN)' }),
    );
    await waitFor(() =>
      expect(last(lastCall(api.browseProducts))).toEqual({
        country: 'MX',
        language: 'EN',
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'MX · MXN · EN' }),
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
    expect(
      await screen.findByText("Couldn't load the products"),
    ).toBeInTheDocument();
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
    // The table renders the 500 rows faster than the cards.
    startInListView();
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
  }, 30_000);

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
    expect(
      await screen.findByText("Couldn't load more products"),
    ).toBeInTheDocument();
    expect(screen.getByText(describeError(error))).toBeInTheDocument();
    expect(screen.getByText('Alpha board')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Charlie board')).toBeInTheDocument();
    expect(lastCall(api.browseProducts)[0]).toMatchObject({
      after: 'cursor-1',
    });
    expect(screen.queryByText("Couldn't load more products")).toBeNull();
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
    expect(
      await screen.findByText("Couldn't load the products"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Not visible to the storefront: it may be unpublished from the Headless channel, or deleted.',
      ),
    ).toBeInTheDocument();
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
    await chooseMenuOption(/^Product type/, 'snowboard');
    fireEvent.change(searchField(), {
      target: { value: 'sku-managed-1' },
    });
    await waitFor(() => expect(api.skuMatches).toHaveBeenCalled());
    await settle();
    expect(
      screen.queryByRole('group', { name: 'SKU and barcode matches' }),
    ).toBeNull();
    expect(screen.queryByText('Managed card')).toBeNull();
  });

  it('skips the lookup inside a chosen collection', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await chooseMenuOption(/^Collection/, 'Hydrogen');
    fireEvent.change(searchField(), {
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
  it('keeps the value visible on a static pill, explained, and clearable', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await chooseMenuOption(/^Product type/, 'giftcard');
    await chooseMenuOption(/^Collection/, 'Hydrogen');
    await waitFor(() =>
      expect(
        screen.getByText('Product type: giftcard').closest('button'),
      ).toBeNull(),
    );
    // The results say it in words; the pill's tooltip repeats it.
    expect(
      screen
        .getByText(
          "Shopify can't apply the product type filter inside this collection until it's enabled in Search & Discovery.",
        )
        .closest('[role="alert"]'),
    ).not.toBeNull();
    await userEvent.hover(screen.getByText('Product type: giftcard'));
    expect(
      await screen.findByText(/^Not applied inside this collection\./),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear filters' }),
    );
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: undefined,
      }),
    );
    expect(
      screen.getByRole('button', { name: /^Product type: Any/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Shopify can't apply/)).toBeNull();
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
    const panel = await findPanel('Two board');
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(2),
    );
    const [redBox, blueBox] = within(panel).getAllByRole('checkbox');
    expect(blueBox).toBeDisabled();
    expect(redBox).toBeEnabled();
    expect(within(holderOf('Blue', panel)).getByText('Sold out')).toBeVisible();
    // The inert row says why, on the row (the kit's rows have no reason).
    expect(
      within(holderOf('Blue', panel)).getByText(
        'Sold out: this field only allows variants available for sale.',
      ),
    ).toBeVisible();
    expect(within(holderOf('Red', panel)).queryByText(/^Sold out:/)).toBeNull();
    await userEvent.click(within(panel).getByText('Blue'));
    expect(blueBox).not.toBeChecked();
    expect(selectionCount('0 variants selected')).toBeInTheDocument();
    await userEvent.click(redBox);
    expect(selectionCount('1 variant selected')).toBeInTheDocument();
  });

  it('does not resolve a sold-out variant while Available for sale is on', async () => {
    const { resolve } = renderPicker(
      variantParameters({ cardinality: 'single' }),
    );
    await findCard('Two board');
    await chooseMenuOption(/^Availability/, 'Available for sale');
    await userEvent.click(await findCard('Two board'));
    const panel = await findPanel('Two board');
    const blueName = await within(panel).findByText('Blue');
    // Not a row that opens: it doesn't take focus or clicks, and says why.
    expect(holderOf('Blue', panel).querySelector('[tabindex="0"]')).toBeNull();
    expect(
      within(holderOf('Blue', panel)).getByText(
        'Sold out: turn off Available for sale to choose it.',
      ),
    ).toBeVisible();
    await userEvent.click(blueName);
    expect(resolve).not.toHaveBeenCalled();
    await userEvent.click(within(panel).getByText('Red'));
    expect(lastResult(resolve).selected[0]).toMatchObject({ id: red.id });
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
    expect(screen.queryByText('Not visible')).toBeNull();
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
    expect(selectionCount('1 variant selected')).toBeInTheDocument();
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
    const panel = await findPanel('Multi board');
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
    const panel = await findPanel('Multi board');
    expect(
      await within(panel).findByText(
        'Not visible to the storefront: it may be unpublished from the Headless channel, archived, or deleted.',
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("Couldn't load the variants"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
  });

  it('explains a failed variant load under its product in the list view, and retries', async () => {
    api.productVariants.mockResolvedValueOnce(null).mockResolvedValue({
      variantsCount: 8,
      options: [],
      page: page(variants),
    });
    startInListView();
    renderPicker(variantParameters());
    await userEvent.click(
      await screen.findByRole('button', { name: /^Multi board/ }),
    );
    expect(
      await screen.findByText(
        'Not visible to the storefront: it may be unpublished from the Headless channel, archived, or deleted.',
      ),
    ).toBeInTheDocument();
    // The same error state as the grid's panel, in a row of the tree.
    expect(screen.getByText("Couldn't load the variants")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(
        screen.getAllByRole('checkbox', { name: /^Color \d/ }),
      ).toHaveLength(8),
    );
  });

  it('loads more variants under their product in the list view', async () => {
    api.productVariants.mockImplementation(
      async (args: { after: string | null }) => ({
        variantsCount: 8,
        options: [],
        page: args.after
          ? page(variants.slice(4))
          : page(variants.slice(0, 4), 'variants-cursor'),
      }),
    );
    startInListView();
    renderPicker(variantParameters());
    await userEvent.click(
      await screen.findByRole('button', { name: /^Multi board/ }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole('checkbox', { name: /^Color \d/ }),
      ).toHaveLength(4),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Load more variants' }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole('checkbox', { name: /^Color \d/ }),
      ).toHaveLength(8),
    );
    expect(
      screen.queryByRole('button', { name: 'Load more variants' }),
    ).toBeNull();
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
    const panel = await findPanel('Two board');
    await within(panel).findByText('Red');
    expect(
      holderOf('Red', panel).querySelector('[aria-current="true"]'),
    ).not.toBeNull();
    expect(holderOf('Blue', panel).querySelector('[aria-current]')).toBeNull();
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
    const tray = screen.getByRole('list', { name: 'Selected products' });
    act(() =>
      within(tray).getByRole('button', { name: 'Remove Alpha board' }).focus(),
    );
    await userEvent.keyboard('[Enter]');
    expect(
      within(tray).getByRole('button', { name: 'Remove Bravo board' }),
    ).toHaveFocus();
    await userEvent.keyboard('[Enter]');
    expect(
      screen.getByRole('button', { name: 'Apply selection' }),
    ).toHaveFocus();
  });

  it('shows each staged item as a chip, and says which are not visible', async () => {
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
    const tray = await screen.findByRole('list', { name: 'Selected products' });
    const chips = within(tray).getAllByRole('listitem');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('Alpha board');
    expect(chips[0]).not.toHaveTextContent('Not visible');
    expect(chips[1]).toHaveTextContent('Retired board');
    expect(chips[1]).toHaveTextContent('Not visible');
  });
});

describe('PickerModal: market menu', () => {
  it('lists countries by name', async () => {
    renderPicker();
    await userEvent.click(
      await screen.findByRole('button', { name: 'IT · EUR · EN' }),
    );
    const names = [
      'Australia (AUD)',
      'Italy (EUR)',
      'Mexico (MXN)',
      'United Arab Emirates (AED)',
    ].map((name) => screen.getByRole('menuitem', { name }));
    for (const [index, element] of names.slice(1).entries()) {
      expect(
        names[index].compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
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
    const panel = await findPanel('Hydro board');
    expect(
      await within(panel).findByRole('checkbox', { name: /^Ice/ }),
    ).toBeInTheDocument();
    expect(screen.queryByAltText(SCENE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Menus from the keyboard (the kit's Dropdown)
// ---------------------------------------------------------------------------

describe('PickerModal: menus from the keyboard', () => {
  it('sorts from the keyboard and gives focus back to the trigger', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    const trigger = await openMenuWithKeyboard(/^Sort:/);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // More than 5 sorts: the menu opens on its search field.
    expect(
      within(screen.getByRole('menu')).getByPlaceholderText('Search...'),
    ).toHaveFocus();
    highlight('Newest');
    press('Enter');
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        sortKey: 'CREATED_AT',
        reverse: true,
      }),
    );
    await settle();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // The menu fades out before it leaves.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent('Sort: Newest');
  });

  it('chooses a collection from the keyboard', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    const trigger = await openMenuWithKeyboard(/^Collection/);
    highlight('Hydrogen');
    press('Enter');
    await waitFor(() =>
      expect(lastCall(api.browseCollectionProducts)[0]).toMatchObject({
        collectionId: COLLECTIONS[0].id,
      }),
    );
    await settle();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent('Collection: Hydrogen');
  });

  it('closes on Escape and Tab, back on the trigger', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    const trigger = await openMenuWithKeyboard(/^Product type/);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    press('Escape');
    await settle();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    // The menu fades out before it leaves.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    press('Enter');
    await waitFor(() => expect(screen.getByRole('menu')).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    press('Tab');
    await settle();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('switches the market from the keyboard', async () => {
    renderPicker();
    await screen.findByRole('button', { name: 'IT · EUR · EN' });
    const trigger = await openMenuWithKeyboard('IT · EUR · EN');
    expect(screen.getByText('Country')).toBeInTheDocument();
    highlight('Mexico (MXN)');
    press('Enter');
    await waitFor(() =>
      expect(last(lastCall(api.browseProducts))).toEqual({
        country: 'MX',
        language: 'EN',
      }),
    );
    await settle();
    expect(screen.getByRole('button', { name: 'MX · MXN · EN' })).toHaveFocus();
    expect(trigger).toBeInTheDocument();
  });

  it('toggles tags from the keyboard, keeping the menu open', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    const trigger = await openMenuWithKeyboard(/^Tags/);
    highlight('Premium', 'menuitemcheckbox');
    press('Enter');
    await settle();
    // Still open, and the tag is checked.
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Premium' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Sport' }),
    ).toHaveAttribute('aria-checked', 'false');
    highlight('Sport', 'menuitemcheckbox');
    press('Enter');
    await waitFor(() =>
      expect(lastCall(api.browseProducts)[0]).toMatchObject({
        query: '(tag:Premium OR tag:Sport)',
      }),
    );
    press('Escape');
    await settle();
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
    expect(selectionCount('0 products selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(searchField()).toHaveFocus();
  });

  it('keeps focus in the search after its ✕ clears it', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await userEvent.type(searchField(), 'snow');
    const clear = within(
      screen.getByRole('search', { name: 'Products' }),
    ).getByRole('button', { name: 'Clear' });
    await userEvent.click(clear);
    expect(searchField()).toHaveValue('');
    expect(searchField()).toHaveFocus();
  });

  it('moves focus to the search after Clear filters', async () => {
    renderPicker();
    await screen.findByText('Alpha board');
    await chooseMenuOption(/^Availability/, 'Available for sale');
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    act(() => clear.focus());
    await userEvent.keyboard('[Enter]');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(searchField()).toHaveFocus();
  });

  it('keeps Load more busy while loading, then focuses the first new item', async () => {
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
    expect(loadMore).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading more products…')).toBeInTheDocument();
    // A second press while loading asks for nothing more.
    await userEvent.keyboard('[Enter]');
    expect(api.browseProducts).toHaveBeenCalledTimes(2);

    await act(async () => finish(page([P3])));
    // The last page: the button leaves, and focus lands on what it loaded.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Charlie board' }),
      ).toHaveFocus(),
    );
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
    expect(searchField()).toHaveFocus();
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
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus(),
    );
    await userEvent.keyboard('[Enter]');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Charlie board' }),
      ).toHaveFocus(),
    );
  });

  it('focuses the first result after Try again succeeds', async () => {
    api.browseProducts.mockRejectedValueOnce(
      new ShopifyClientError('network', 'offline'),
    );
    renderPicker();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    act(() => retry.focus());
    await userEvent.keyboard('[Enter]');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Alpha board' })).toHaveFocus(),
    );
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
    const panel = await findPanel('Multi board');
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
      await screen.findByRole('button', { name: /^Tags: Any/ }),
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
    expect(
      screen.getByRole('button', { name: /^Tags: Any/ }),
    ).toBeInTheDocument();
  });

  it('waits for detection before the Tags filter, then shows it before Vendor', async () => {
    let finish: (value: unknown) => void = () => {};
    api.detectCapabilities.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderProbeStore();
    await screen.findByText('Alpha board');
    expect(screen.queryByRole('button', { name: /^Tags/ })).toBeNull();
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
    const tags = await screen.findByRole('button', { name: /^Tags: Any/ });
    expect(tags).toHaveAttribute('aria-haspopup');
    // In its place: right before the vendor filter.
    expect(
      tags.compareDocumentPosition(
        screen.getByRole('button', { name: /^Vendor: Any/ }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await waitFor(() => expect(api.filterValues).toHaveBeenCalledTimes(1));
  });

  it('drops the Tags filter when detection finds no tag access', async () => {
    api.capabilities = { tags: false, inventory: false, metafields: false };
    api.detectCapabilities.mockRejectedValue(new Error('offline'));
    renderProbeStore();
    await screen.findByText('Alpha board');
    await waitFor(() => expect(api.filterValues).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /^Tags/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The same item in the grid and in the list
// ---------------------------------------------------------------------------

describe('PickerModal: items look the same everywhere', () => {
  it('uses checkboxes in multiple fields and rows that open in single ones', async () => {
    startInListView();
    renderPicker();
    const row = await findCard('Alpha board');
    expect(row).toBeInstanceOf(HTMLInputElement);
    expect(row).toHaveAttribute('type', 'checkbox');
    cleanup();

    const { resolve } = renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({ cardinality: 'single' }),
      }),
    );
    const opening = (await findItem('Alpha board')).querySelector<HTMLElement>(
      '[tabindex="0"]',
    );
    expect(opening).not.toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    if (opening) {
      act(() => opening.focus());
      await userEvent.keyboard('[Enter]');
    }
    expect(lastResult(resolve).selected[0]).toMatchObject({ id: P1.id });
  });

  it("shows the only variant's SKU in the list view", async () => {
    startInListView();
    api.browseProducts.mockResolvedValue(
      page([P1, product(5, { title: 'Echo board', sku: 'BOARD-ECHO' }), MULTI]),
    );
    renderPicker();
    await screen.findByText('Alpha board');
    expect(
      within(item('Echo board')).getByText('BOARD-ECHO'),
    ).toBeInTheDocument();
    expect(within(item('Alpha board')).getByText('No SKU')).toBeVisible();
    // Several variants: the Variants column already counts them.
    expect(within(item('Multi board')).queryByText('No SKU')).toBeNull();
    expect(within(item('Multi board')).getByText('8 variants')).toBeVisible();
  });

  it('shows vendor and product type on grid cards, as in list rows', async () => {
    renderPicker();
    expect(await findItem('Alpha board')).toHaveTextContent(
      'Snowboard Vendor · snowboard',
    );
    cleanup();
    startInListView();
    renderPicker();
    expect(await findItem('Alpha board')).toHaveTextContent(
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
    await userEvent.hover(screen.getByText('Available for sale'));
    // The tooltip gives the reason, without repeating the pill.
    expect(
      await screen.findByText('Set in the field settings.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Available for sale. Set in the field settings.'),
    ).toBeNull();
    expect(screen.queryByText('In stock')).toBeNull();
  });

  it('shortens locked tags on the pill and names them all in its tooltip', async () => {
    renderPicker(
      modalParameters({
        fieldParameters: fieldParameters({
          scope: { tags: ['Accessory', 'Premium', 'Snow'] },
        }),
      }),
    );
    await screen.findByText('Alpha board');
    await userEvent.hover(screen.getByText('Tags: Accessory +2'));
    expect(
      await screen.findByText(
        'Accessory, Premium or Snow. Set in the field settings.',
      ),
    ).toBeInTheDocument();
  });
});
