import FieldExtension from '../../src/entrypoints/FieldExtension';
import { defineSurface, type SurfaceState } from '../surface';

/**
 * The field editor (renderFieldExtension) against the live demo store
 * (datocms-demo.myshopify.com). IDs and handles below are real demo-store
 * values recorded on 2026-10-03.
 */

const SHOP = 'datocms-demo.myshopify.com';

const P_COMPLETE = {
  id: 'gid://shopify/Product/10080752009562',
  handle: 'the-complete-snowboard',
};
const P_COMPARE = {
  id: 'gid://shopify/Product/10080751911258',
  handle: 'the-compare-at-price-snowboard',
};
const P_OUT_OF_STOCK = {
  id: 'gid://shopify/Product/10080751747418',
  handle: 'the-out-of-stock-snowboard',
};
const P_GIFT_CARD = {
  id: 'gid://shopify/Product/10080751714650',
  handle: 'gift-card',
};
const P_HYDROGEN = {
  id: 'gid://shopify/Product/10080751812954',
  handle: 'the-collection-snowboard-hydrogen',
};
const V_ICE = 'gid://shopify/ProductVariant/50698337681754';
const C_HYDROGEN = {
  id: 'gid://shopify/Collection/645261132122',
  handle: 'hydrogen',
};
const C_FRONTPAGE = {
  id: 'gid://shopify/Collection/645260968282',
  handle: 'frontpage',
};

const IMAGE_BASE =
  'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d';

type LegacyOverrides = Record<string, unknown>;

/** A 1.x JSON value for The Complete Snowboard, as 1.x stored it (compact). */
function legacyJson(overrides: LegacyOverrides = {}): string {
  return JSON.stringify({
    id: P_COMPLETE.id,
    title: 'The Complete Snowboard',
    handle: P_COMPLETE.handle,
    description: 'This PREMIUM snowboard is so SUPERDUPER awesome!',
    onlineStoreUrl: null,
    availableForSale: true,
    productType: 'snowboard',
    priceRange: {
      maxVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
      minVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
    },
    images: {
      edges: [
        {
          node: {
            src: `${IMAGE_BASE}.jpg?v=1741717811`,
            previewSrc: `${IMAGE_BASE}_200x200.jpg?v=1741717811`,
          },
        },
      ],
    },
    imageUrl: `${IMAGE_BASE}.jpg?v=1741717811`,
    previewImageUrl: `${IMAGE_BASE}_200x200.jpg?v=1741717811`,
    ...overrides,
  });
}

function referenceDocument(
  kind: 'product' | 'variant' | 'collection',
  references: unknown[],
  shop = SHOP,
): string {
  return JSON.stringify({ version: 1, shop, kind, references }, null, 2);
}

function fieldParameters(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    paramsVersion: '1',
    kind: 'product',
    cardinality: 'multiple',
    format: 'reference',
    snapshot: false,
    ...overrides,
  };
}

const MULTIPLE = fieldParameters();
const SINGLE_REFERENCE = fieldParameters({ cardinality: 'single' });

const THREE_PRODUCTS = referenceDocument('product', [
  P_COMPLETE,
  P_COMPARE,
  P_OUT_OF_STOCK,
]);

const DEMO_STORE_CONNECTION = {
  shopDomain: SHOP,
  storefrontAccessToken: '6f39fb123179b7d636d84d833d3d3adf',
  tokenless: false,
};

const LONG_INVALID_VALUE = `{"version": 1, "shop": "${SHOP}", "kind": "product", "references": [${Array.from(
  { length: 12 },
  (_, index) =>
    `{"id": "gid://shopify/Product/1008075${index}", "handle": "board-${index}"`,
).join('}, ')}`;

const states: Record<string, SurfaceState> = {
  empty: {
    fieldParameters: MULTIPLE,
    description: 'Multiple products, nothing selected.',
  },
  'empty-single': {
    fieldType: 'string',
    description: 'A 1.x string field (handle), nothing selected.',
  },
  'legacy-handle': {
    fieldType: 'string',
    value: P_COMPLETE.handle,
    description: 'A 1.x string field holding a handle.',
  },
  'legacy-json': {
    value: legacyJson(),
    description: 'A 1.x JSON value that still matches Shopify.',
  },
  'legacy-json-drift': {
    value: legacyJson({
      title: 'The Complete Snowboard (2024)',
      priceRange: {
        maxVariantPrice: { amount: '649.95', currencyCode: 'EUR' },
        minVariantPrice: { amount: '649.95', currencyCode: 'EUR' },
      },
    }),
    description: 'A 1.x JSON value whose title and price changed in Shopify.',
  },
  'legacy-json-base64': {
    value: legacyJson({
      id: 'Z2lkOi8vc2hvcGlmeS9Qcm9kdWN0LzEwMDgwNzUyMDA5NTYy',
    }),
    description: 'A 1.x JSON value saved before 2022-04, with a base64 ID.',
  },
  'legacy-json-crop-center': {
    value: legacyJson({
      images: {
        edges: [
          {
            node: {
              src: `${IMAGE_BASE}_200x200_crop_center.jpg?v=1741717811`,
            },
          },
        ],
      },
      imageUrl: `${IMAGE_BASE}_200x200_crop_center.jpg?v=1741717811`,
      previewImageUrl: undefined,
    }),
    description:
      'A 1.x JSON value with a _crop_center thumbnail: no drift from the image size alone.',
  },
  'gid-product': {
    fieldType: 'string',
    fieldParameters: fieldParameters({ cardinality: 'single', format: 'gid' }),
    value: P_COMPARE.id,
    description: 'A string field saving a product GID (compare-at price).',
  },
  'gid-variant': {
    fieldType: 'string',
    fieldParameters: fieldParameters({
      kind: 'variant',
      cardinality: 'single',
      format: 'gid',
    }),
    value: V_ICE,
    description: 'A string field saving a variant GID.',
  },
  'gid-collection': {
    fieldType: 'string',
    fieldParameters: fieldParameters({
      kind: 'collection',
      cardinality: 'single',
      format: 'gid',
    }),
    value: C_HYDROGEN.id,
    description: 'A string field saving a collection GID.',
  },
  'reference-single': {
    fieldParameters: SINGLE_REFERENCE,
    value: referenceDocument('product', [P_GIFT_CARD]),
    description: 'A reference document with one product (a price range).',
  },
  'reference-multiple': {
    fieldParameters: MULTIPLE,
    value: THREE_PRODUCTS,
    description: 'Three products, sortable.',
  },
  'reference-collections': {
    fieldParameters: fieldParameters({ kind: 'collection' }),
    value: referenceDocument('collection', [C_FRONTPAGE, C_HYDROGEN]),
    description: 'Two collections.',
  },
  'at-max': {
    fieldParameters: fieldParameters({ max: 3 }),
    value: THREE_PRODUCTS,
    description: 'Max 3: the counter reads "3 of 3" and Add is disabled.',
  },
  'below-min': {
    fieldParameters: fieldParameters({ min: 2, max: 10 }),
    value: referenceDocument('product', [P_HYDROGEN]),
    description:
      'Min 2 with one product: a warning under the list, the handle drawn disabled.',
  },
  'min-only': {
    fieldParameters: fieldParameters({ min: 2 }),
    value: THREE_PRODUCTS,
    description:
      'Min 2 and no max: the counter reads "3 selected · at least 2".',
  },
  'above-max': {
    fieldParameters: fieldParameters({ max: 2 }),
    value: THREE_PRODUCTS,
    description: 'Max lowered to 2 after three were saved: remove one.',
  },
  unresolved: {
    fieldParameters: MULTIPLE,
    value: referenceDocument('product', [
      P_COMPLETE,
      { id: 'gid://shopify/Product/1', handle: 'retired-board' },
      {
        id: 'gid://shopify/Product/2',
        handle: 'summer-board',
        snapshot: {
          title: 'Summer Board',
          capturedAt: '2026-06-01T12:00:00Z',
        },
      },
    ]),
    description:
      'Two products the storefront cannot see, with and without a snapshot.',
  },
  'handle-drift': {
    fieldParameters: SINGLE_REFERENCE,
    value: referenceDocument('product', [
      { id: P_COMPLETE.id, handle: 'complete-snowboard-2024' },
    ]),
    description: 'The saved handle no longer matches Shopify.',
  },
  'mismatch-legacy': {
    fieldParameters: SINGLE_REFERENCE,
    value: legacyJson(),
    description: 'A 1.x JSON value in a field now saving reference documents.',
  },
  'mismatch-handle': {
    fieldType: 'string',
    fieldParameters: fieldParameters({ cardinality: 'single', format: 'gid' }),
    value: P_COMPLETE.handle,
    description: 'A handle in a string field now saving Shopify IDs.',
  },
  'legacy-handle-renamed': {
    fieldType: 'string',
    value: 'the-complete-snowboard-2023',
    description:
      'A 1.x handle that no longer resolves (renamed in Shopify): handle copy and an admin search.',
  },
  'mismatch-blocked': {
    fieldType: 'string',
    fieldParameters: fieldParameters({ cardinality: 'single', format: 'gid' }),
    value: 'retired-board',
    description: 'Convert is disabled: the saved handle resolves to nothing.',
  },
  invalid: {
    value: '{"id": "gid://shopify/Product/1", "title": ',
    description: 'Malformed JSON.',
  },
  'invalid-long': {
    fieldParameters: MULTIPLE,
    value: LONG_INVALID_VALUE,
    description: 'A long malformed value, truncated with "Show full value".',
  },
  'shop-mismatch': {
    fieldParameters: MULTIPLE,
    value: referenceDocument(
      'product',
      [P_COMPLETE],
      'acme-outlet.myshopify.com',
    ),
    description: 'A document saved for another store.',
  },
  'client-error': {
    fieldParameters: MULTIPLE,
    value: THREE_PRODUCTS,
    pluginParameters: {
      paramsVersion: '3',
      stores: [
        {
          ...DEMO_STORE_CONNECTION,
          storefrontAccessToken: 'not-a-real-token-0000',
        },
      ],
      useDemoStore: false,
      autoApplyToFieldsWithApiKey: '',
    },
    description:
      'Shopify rejects the token: an error with "Open plugin settings".',
  },
  'client-error-editor': {
    fieldParameters: MULTIPLE,
    value: THREE_PRODUCTS,
    canEditSchema: false,
    pluginParameters: {
      paramsVersion: '3',
      stores: [
        {
          ...DEMO_STORE_CONNECTION,
          storefrontAccessToken: 'not-a-real-token-0000',
        },
      ],
      useDemoStore: false,
      autoApplyToFieldsWithApiKey: '',
    },
    description:
      'Shopify rejects the token, for a role that cannot edit the schema.',
  },
  'not-configured': {
    pluginParameters: {
      paramsVersion: '3',
      stores: [],
      useDemoStore: false,
      autoApplyToFieldsWithApiKey: '',
    },
    description: 'No store connected; this role can edit the schema.',
  },
  'not-configured-editor': {
    canEditSchema: false,
    pluginParameters: {
      paramsVersion: '3',
      stores: [],
      useDemoStore: false,
      autoApplyToFieldsWithApiKey: '',
    },
    description: 'No store connected; this role cannot edit the schema.',
  },
  'store-missing': {
    fieldParameters: fieldParameters({
      shopDomain: 'acme-outlet.myshopify.com',
    }),
    pluginParameters: {
      paramsVersion: '3',
      stores: [DEMO_STORE_CONNECTION],
      useDemoStore: false,
      autoApplyToFieldsWithApiKey: '',
    },
    description: "The field's store is no longer connected.",
  },
  disabled: {
    fieldParameters: fieldParameters({ max: 5 }),
    value: THREE_PRODUCTS,
    disabled: true,
    description: 'ctx.disabled: read-only rows.',
  },
  'disabled-below-min': {
    fieldParameters: fieldParameters({ min: 2 }),
    value: referenceDocument('product', [P_HYDROGEN]),
    disabled: true,
    description: 'ctx.disabled below the minimum: no hint, no handle.',
  },
  'disabled-empty': {
    fieldParameters: MULTIPLE,
    disabled: true,
    description: 'ctx.disabled with nothing selected.',
  },
  'in-block': {
    fieldParameters: MULTIPLE,
    value: THREE_PRODUCTS,
    background: 'raised',
    description: 'Inside a modular block (surface-raised behind the frame).',
  },
  localized: {
    fieldParameters: MULTIPLE,
    value: THREE_PRODUCTS,
    localized: true,
    description:
      'A localized field: titles in the record locale when the store has it.',
  },
  loading: {
    fieldParameters: MULTIPLE,
    value: THREE_PRODUCTS,
    description:
      'The first load, frozen: Storefront requests from this state never answer.',
  },
  unsupported: {
    description:
      'A field type the editor does not support (Multiple-paragraph text).',
  },
};

/**
 * Holds Storefront API requests open while the `loading` state is shown, so
 * the first-load spinner can be reviewed. Other states use the network.
 */
let holdShopifyRequests = false;

function installRequestGate() {
  const frame = window as Window & { __fieldHarnessGate?: boolean };
  if (frame.__fieldHarnessGate) return;
  frame.__fieldHarnessGate = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (holdShopifyRequests && url.includes('.myshopify.com/api/')) {
      return new Promise<Response>(() => undefined);
    }
    return realFetch(input, init);
  };
}

export default defineSurface({
  id: 'fieldExtension',
  title: 'Field editor',
  kind: 'field',
  description:
    'renderFieldExtension for string and JSON fields, live against the demo store.',
  states,
  render: (ctx, state) => {
    holdShopifyRequests = state.name === 'loading';
    installRequestGate();
    const base = ctx();
    if (state.name !== 'unsupported') return <FieldExtension ctx={base} />;
    // A Multiple-paragraph text field, which the editor doesn't support.
    const field = {
      ...base.field,
      attributes: { ...base.field.attributes, field_type: 'text' },
    } as unknown as typeof base.field;
    return <FieldExtension ctx={ctx({ field })} />;
  },
});
