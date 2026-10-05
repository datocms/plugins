import { type ReactNode, useEffect } from 'react';
import { PICKER_MODAL_ID } from '../../src/constants';
import PickerModal from '../../src/entrypoints/PickerModal';
import type {
  FieldParametersV1,
  PickerModalParameters,
  PickerSelectedEntry,
  ProductSummary,
  VariantSummary,
} from '../../src/types';
import { defineSurface, type SurfaceState } from '../surface';

/**
 * The picker modal (renderModal 'shopifyPicker') against the live demo store.
 * Nodes below were recorded from datocms-demo.myshopify.com on 2026-10-03.
 * Some states drive the UI after it mounts (typing a search, opening a
 * product) so the screenshot shows that state; the picker itself has no
 * such inputs.
 */

const SHOP = 'datocms-demo.myshopify.com';

const COMPLETE: ProductSummary = {
  __typename: 'Product',
  id: 'gid://shopify/Product/10080752009562',
  handle: 'the-complete-snowboard',
  title: 'The Complete Snowboard',
  vendor: 'Snowboard Vendor',
  productType: 'snowboard',
  availableForSale: true,
  onlineStoreUrl: null,
  updatedAt: '2026-07-18T23:38:42Z',
  featuredImage: {
    url: 'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d.jpg?v=1741717811',
    altText: null,
  },
  priceRange: {
    minVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
    maxVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
  },
  compareAtPriceRange: {
    maxVariantPrice: { amount: '0.0', currencyCode: 'EUR' },
  },
  variantsCount: { count: 5 },
  sku: null,
};

const COMPARE: ProductSummary = {
  ...COMPLETE,
  id: 'gid://shopify/Product/10080751911258',
  handle: 'the-compare-at-price-snowboard',
  title: 'The Compare at Price Snowboard',
  vendor: 'DatoCMS Demo',
  featuredImage: {
    url: 'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/snowboard_sky.png?v=1741717812',
    altText: null,
  },
  priceRange: {
    minVariantPrice: { amount: '785.95', currencyCode: 'EUR' },
    maxVariantPrice: { amount: '785.95', currencyCode: 'EUR' },
  },
  compareAtPriceRange: {
    maxVariantPrice: { amount: '885.95', currencyCode: 'EUR' },
  },
  variantsCount: { count: 1 },
};

const HYDROGEN: ProductSummary = {
  ...COMPLETE,
  id: 'gid://shopify/Product/10080751812954',
  handle: 'the-collection-snowboard-hydrogen',
  title: 'The Collection Snowboard: Hydrogen',
  vendor: 'Hydrogen Vendor',
  featuredImage: {
    url: 'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_0a40b01b-5021-48c1-80d1-aa8ab4876d3d.jpg?v=1741717811',
    altText: null,
  },
  priceRange: {
    minVariantPrice: { amount: '600.0', currencyCode: 'EUR' },
    maxVariantPrice: { amount: '600.0', currencyCode: 'EUR' },
  },
  variantsCount: { count: 1 },
};

const ICE: VariantSummary = {
  __typename: 'ProductVariant',
  id: 'gid://shopify/ProductVariant/50698337681754',
  title: 'Ice',
  sku: null,
  barcode: null,
  availableForSale: true,
  currentlyNotInStock: false,
  selectedOptions: [{ name: 'Color', value: 'Ice' }],
  price: { amount: '699.95', currencyCode: 'EUR' },
  compareAtPrice: null,
  image: COMPLETE.featuredImage,
  product: {
    id: COMPLETE.id,
    handle: COMPLETE.handle,
    title: COMPLETE.title,
    vendor: COMPLETE.vendor,
    onlineStoreUrl: null,
    featuredImage: COMPLETE.featuredImage,
  },
};

function entry(node: ProductSummary | VariantSummary): PickerSelectedEntry {
  const title =
    node.__typename === 'ProductVariant'
      ? `${node.product.title} — ${node.title}`
      : node.title;
  return { key: node.id, id: node.id, node, fallbackLabel: title };
}

const UNRESOLVED: PickerSelectedEntry = {
  key: 'gid://shopify/Product/1234567890',
  id: 'gid://shopify/Product/1234567890',
  node: null,
  fallbackLabel: 'Retired limited edition',
};

/** Entries the field couldn't resolve; the picker loads their nodes on open. */
const MINIMAL_UNRESOLVED: PickerSelectedEntry = {
  key: 'gid://shopify/Product/10080751780186',
  id: 'gid://shopify/Product/10080751780186',
  node: null,
  fallbackLabel: 'the-minimal-snowboard',
};

const COMPARE_VARIANT_UNRESOLVED: PickerSelectedEntry = {
  key: 'gid://shopify/ProductVariant/50698337616218',
  id: 'gid://shopify/ProductVariant/50698337616218',
  node: null,
  fallbackLabel: 'The Compare at Price Snowboard',
};

const HYDROGEN_COLLECTION = 'gid://shopify/Collection/645261132122';
const AUTOMATED_COLLECTION = 'gid://shopify/Collection/645261099354';

function field(overrides: Partial<FieldParametersV1>): FieldParametersV1 {
  return {
    paramsVersion: '1',
    kind: 'product',
    cardinality: 'multiple',
    format: 'reference',
    snapshot: false,
    ...overrides,
  };
}

function picker(
  fieldParameters: FieldParametersV1,
  selected: PickerSelectedEntry[] = [],
  extra: Partial<PickerModalParameters> = {},
): Record<string, unknown> {
  const parameters: PickerModalParameters = {
    fieldParameters,
    fieldType: 'json',
    shopDomain: SHOP,
    selected,
    ...extra,
  };
  return parameters;
}

function state(
  description: string,
  modalTitle: string,
  modalParameters: Record<string, unknown>,
  rest: Partial<SurfaceState> = {},
): SurfaceState {
  return { description, modalTitle, modalParameters, ...rest };
}

const BROKEN_TOKEN_STORE = {
  paramsVersion: '3',
  stores: [
    {
      shopDomain: SHOP,
      storefrontAccessToken: '00000000000000000000000000000000',
      tokenless: false,
      capabilities: {
        tags: false,
        inventory: false,
        metafields: false,
        checkedAt: '2026-10-03T12:00:00Z',
      },
    },
  ],
  useDemoStore: false,
  autoApplyToFieldsWithApiKey: '',
};

// ---------------------------------------------------------------------------
// Drivers: put the UI in a state after it mounts (harness only)
// ---------------------------------------------------------------------------

type Driver = {
  type?: string;
  open?: string;
  list?: boolean;
  /** Opens the menu whose trigger text starts with this. */
  menu?: string;
  /** Picks options in order: `[menu trigger text, option text]`. */
  choose?: Array<[string, string]>;
  /** Focuses the first element matching this selector (after the rest). */
  focus?: string;
};

const DRIVERS: Record<string, Driver> = {
  'product-search-sku': { type: 'sku-managed-1' },
  'product-search-empty': { type: 'zzzz nothing here' },
  'variant-expanded': { open: 'The Complete Snowboard' },
  'variant-single-expanded': { open: 'Gift Card' },
  'product-list-view-search': { type: 'snow', list: true },
  'product-replace-list': { list: true },
  'variant-list-expanded': { open: 'The Complete Snowboard', list: true },
  'menu-market': { menu: 'IT' },
  'menu-collection': { menu: 'Collection' },
  'menu-tags': { menu: 'Tags' },
  'product-kept-filter': {
    choose: [
      ['Product type', 'giftcard'],
      ['Collection', 'Hydrogen'],
    ],
  },
  'product-tray-focus': { focus: 'button[aria-label^="Remove"]' },
};

function findMenuTrigger(label: string): HTMLButtonElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup]'),
  ).find((button) => button.textContent?.trim().startsWith(label));
}

/** Clicks the trigger once the menu has something to show. */
function openMenu(label: string): boolean {
  const trigger = findMenuTrigger(label);
  if (!trigger) return false;
  if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  return true;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function findCard(title: string): HTMLButtonElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'),
  ).find((button) => button.textContent?.includes(title));
}

function searchInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('#shopify-picker-search');
}

/** Types into the search; true when it changed the value this time. */
function typeSearch(text: string): boolean {
  const input = searchInput();
  if (!input || input.value === text) return false;
  setInputValue(input, text);
  return true;
}

function showList(list: boolean | undefined): void {
  const button = document.querySelector<HTMLButtonElement>(
    'button[aria-label="List view"]',
  );
  if (list && button && button.getAttribute('aria-pressed') !== 'true') {
    button.click();
  }
}

function openCard(title: string): boolean {
  const card = findCard(title);
  if (!card) return false;
  if (card.getAttribute('aria-expanded') !== 'true') card.click();
  return true;
}

function findOption(text: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"], button, li'),
  ).find((element) => element.textContent?.trim() === text);
}

/** Picks the next option of `choose`; true while some are left. */
function chooseNext(choices: Array<[string, string]>, done: Set<number>) {
  const index = choices.findIndex((_, candidate) => !done.has(candidate));
  if (index < 0) return false;
  const [menu, option] = choices[index];
  const element = findOption(option);
  if (element) {
    element.click();
    done.add(index);
  } else {
    openMenu(menu);
  }
  return true;
}

function focusTarget(selector: string): boolean {
  const element = document.querySelector<HTMLElement>(selector);
  element?.focus();
  return Boolean(element);
}

/** Runs one step; true while the driver still has something to do. */
function pending(driver: Driver, chosen: Set<number>): boolean {
  showList(driver.list);
  if (driver.type && typeSearch(driver.type)) return true;
  if (driver.choose && chooseNext(driver.choose, chosen)) return true;
  if (driver.menu) return !openMenu(driver.menu);
  if (driver.open) return !openCard(driver.open);
  if (driver.focus) return !focusTarget(driver.focus);
  return driver.type ? searchInput()?.value !== driver.type : false;
}

function runDriver(driver: Driver): () => void {
  let stopped = false;
  let attempts = 0;
  const chosen = new Set<number>();
  const tick = () => {
    if (stopped || attempts > 100) return;
    attempts += 1;
    if (pending(driver, chosen)) window.setTimeout(tick, 250);
  };
  window.setTimeout(tick, 100);
  return () => {
    stopped = true;
  };
}

function Driven({ name, children }: { name: string; children: ReactNode }) {
  useEffect(() => {
    const driver = DRIVERS[name];
    return driver ? runDriver(driver) : undefined;
  }, [name]);
  return <>{children}</>;
}

export default defineSurface({
  id: PICKER_MODAL_ID,
  title: 'Picker modal',
  kind: 'modal',
  description:
    'renderModal("shopifyPicker"): browse the demo store and resolve a selection.',
  states: {
    'product-multiple': state(
      'Products, multiple, max 5, two picked plus one the storefront can no longer see.',
      'Choose products',
      picker(field({ max: 5 }), [entry(COMPLETE), entry(COMPARE), UNRESOLVED]),
    ),
    'product-tray-focus': state(
      "Keyboard focus on a tray item's remove button; the Minimal Snowboard (no image, resolved on open) is a blank tile, and the unresolved product an eye-slash tile.",
      'Choose products',
      picker(field({ max: 5 }), [
        entry(COMPLETE),
        MINIMAL_UNRESOLVED,
        entry(COMPARE),
        UNRESOLVED,
      ]),
    ),
    'product-kept-filter': state(
      'Product type chosen, then a collection whose Search & Discovery filters do not include it: the value stays visible, struck.',
      'Choose products',
      picker(field({})),
    ),
    'product-single': state(
      'Products, single: clicking a card picks it.',
      'Choose a product',
      picker(field({ cardinality: 'single' }), [entry(HYDROGEN)]),
    ),
    'product-replace': state(
      "Replace one item: the field's other items show selected and locked (Already in this field).",
      'Choose a product',
      picker(field({ cardinality: 'single' }), [entry(COMPLETE)], {
        unavailable: [
          { key: COMPARE.id, id: COMPARE.id },
          { key: HYDROGEN.id, id: HYDROGEN.id },
        ],
      }),
    ),
    'product-replace-list': state(
      'Replace in the list view, with the SKU column.',
      'Choose a product',
      picker(field({ cardinality: 'single' }), [entry(COMPLETE)], {
        unavailable: [
          { key: COMPARE.id, id: COMPARE.id },
          { key: HYDROGEN.id, id: HYDROGEN.id },
        ],
      }),
    ),
    'product-list-view-search': state(
      'Products in the list view after searching "snow".',
      'Choose products',
      picker(field({}), [entry(COMPLETE)]),
    ),
    'product-search-sku': state(
      'A pasted SKU pins the exact SKU / barcode matches above the results.',
      'Choose products',
      picker(field({})),
    ),
    'product-search-empty': state(
      'A search with no results.',
      'Choose products',
      picker(field({})),
    ),
    'product-max-reached': state(
      'Max 2 and two picked: the rest are disabled with a reason.',
      'Choose products',
      picker(field({ max: 2 }), [entry(COMPLETE), entry(HYDROGEN)]),
    ),
    'product-scoped': state(
      'Locked scope from the field settings: product type, tags, available for sale.',
      'Choose products',
      picker(
        field({
          scope: {
            productType: 'snowboard',
            tags: ['Premium', 'Accessory'],
            availableOnly: true,
          },
        }),
      ),
    ),
    'product-locked-collection': state(
      'Locked to a collection plus a vendor that Search & Discovery does not filter, so the vendor is enforced in the browser.',
      'Choose products',
      picker(
        field({
          scope: {
            collectionId: AUTOMATED_COLLECTION,
            collectionTitle: 'Automated Collection',
            vendor: 'Snowboard Vendor',
          },
        }),
      ),
    ),
    'variant-multiple': state(
      'Variants, multiple: products open into variant tables.',
      'Choose product variants',
      picker(field({ kind: 'variant' }), [entry(ICE)]),
    ),
    'variant-unresolved': state(
      'A selected variant the field could not resolve: its node loads on open, so its single-variant product shows selected.',
      'Choose product variants',
      picker(field({ kind: 'variant' }), [COMPARE_VARIANT_UNRESOLVED]),
    ),
    'variant-expanded': state(
      'Variants, multiple, with The Complete Snowboard open.',
      'Choose product variants',
      picker(field({ kind: 'variant', max: 4 }), [entry(ICE)]),
    ),
    'variant-list-expanded': state(
      'Variants in the list view with The Complete Snowboard open.',
      'Choose product variants',
      picker(field({ kind: 'variant' }), [entry(ICE)]),
    ),
    'variant-single-expanded': state(
      'Variants, single, with the Gift Card open: clicking a row picks it.',
      'Choose a product variant',
      picker(field({ kind: 'variant', cardinality: 'single' })),
    ),
    'collection-multiple': state(
      'Collections, multiple.',
      'Choose collections',
      picker(field({ kind: 'collection' }), [
        {
          key: HYDROGEN_COLLECTION,
          id: HYDROGEN_COLLECTION,
          node: null,
          fallbackLabel: 'hydrogen',
        },
      ]),
    ),
    'collection-single': state(
      'Collections, single.',
      'Choose a collection',
      picker(field({ kind: 'collection', cardinality: 'single' })),
    ),
    'market-context': state(
      'Opened in another market (Mexico, MXN).',
      'Choose products',
      picker(field({}), [], { context: { country: 'MX', language: 'EN' } }),
    ),
    'menu-market': state(
      'The market menu: countries with their currency, then languages.',
      'Choose products',
      picker(field({})),
    ),
    'menu-collection': state(
      'The collection filter menu.',
      'Choose products',
      picker(field({})),
    ),
    'menu-tags': state(
      'The tags filter menu (any of the chosen tags).',
      'Choose products',
      picker(field({})),
    ),
    'error-unauthorized': state(
      'The store token is rejected: an actionable error.',
      'Choose products',
      picker(field({})),
      { pluginParameters: BROKEN_TOKEN_STORE },
    ),
    'invalid-parameters': state(
      'The modal received parameters it does not understand.',
      'Choose products',
      { fieldParameters: 'nope' },
    ),
    'not-configured': state(
      'No store is connected in the plugin settings.',
      'Choose products',
      picker(field({})),
      {
        pluginParameters: {
          paramsVersion: '3',
          stores: [],
          useDemoStore: false,
          autoApplyToFieldsWithApiKey: '',
        },
      },
    ),
    'store-missing': state(
      'The field points to a store that is no longer configured.',
      'Choose products',
      picker(field({}), [], { shopDomain: 'gone-store.myshopify.com' }),
    ),
  },
  render: (ctx, resolved) => (
    <Driven name={resolved.name}>
      <PickerModal ctx={ctx()} />
    </Driven>
  ),
});
