import { describe, expect, it } from 'vitest';
import { buildLegacyProductJson, legacyJsonDrift } from '../src/lib/legacy';
import {
  EXAMPLE_CAPTURED_AT,
  StoredValueBuildError,
  buildExampleStoredValue,
  buildReferenceDocument,
  canStoreEntries,
  canonicalGid,
  dedupeEntries,
  describeStoredValueError,
  detectHandleDrift,
  entryFallbackLabel,
  entryFromNode,
  moveEntry,
  parseStoredValue,
  serializeStoredValue,
  snapshotFromNode,
  storeEntriesProblem,
} from '../src/lib/references';
import type {
  CollectionSummary,
  FieldParametersV1,
  FieldType,
  LegacyProductJson,
  LegacyProductNode,
  ProductSummary,
  ShopifyKind,
  ShopifyNode,
  StorageFormat,
  StoredEntry,
  StoredValueErrorCode,
  VariantSummary,
} from '../src/types';
import legacy1xText from './fixtures/legacy-1x-product.json?raw';
import legacyNode from './fixtures/legacy-product-node-2026-10.json';
import legacyBase64Text from './fixtures/legacy-base64-id.json?raw';
import legacyCropCenterText from './fixtures/legacy-crop-center-image.json?raw';

/** The recorded 1.x value exactly as 1.x wrote it (compact JSON). */
const LEGACY_1X_COMPACT = JSON.stringify(JSON.parse(legacy1xText));
const SHOP = 'datocms-demo.myshopify.com';
const PRODUCT_ID = 'gid://shopify/Product/10080752009562';
const PRODUCT_2_ID = 'gid://shopify/Product/10080752337242';
const VARIANT_ID = 'gid://shopify/ProductVariant/50698337681754';
const VARIANT_2_ID = 'gid://shopify/ProductVariant/50698338337114';
const COLLECTION_ID = 'gid://shopify/Collection/645260968282';
const PRODUCT_BASE64 = btoa(PRODUCT_ID);

function params(overrides: Partial<FieldParametersV1> = {}): FieldParametersV1 {
  return {
    paramsVersion: '1',
    kind: 'product',
    cardinality: 'single',
    format: 'reference',
    snapshot: false,
    ...overrides,
  };
}

function parse(
  rawValue: unknown,
  fieldType: FieldType,
  overrides: Partial<FieldParametersV1> = {},
  shopDomain: string | null = SHOP,
) {
  return parseStoredValue(rawValue, {
    fieldType,
    fieldParameters: params(overrides),
    shopDomain,
  });
}

function productNode(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    __typename: 'Product',
    id: PRODUCT_ID,
    handle: 'the-complete-snowboard',
    title: 'The Complete Snowboard',
    vendor: 'Snowboard Vendor',
    productType: 'snowboard',
    availableForSale: true,
    onlineStoreUrl: null,
    updatedAt: '2026-07-18T23:38:42Z',
    featuredImage: { url: 'https://cdn.shopify.com/board.jpg', altText: null },
    priceRange: {
      minVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
      maxVariantPrice: { amount: '799.95', currencyCode: 'EUR' },
    },
    compareAtPriceRange: {
      maxVariantPrice: { amount: '0.0', currencyCode: 'EUR' },
    },
    variantsCount: { count: 5 },
    sku: null,
    ...overrides,
  };
}

function variantNode(overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    __typename: 'ProductVariant',
    id: VARIANT_ID,
    title: 'Ice',
    sku: 'SKU-ICE',
    barcode: null,
    availableForSale: true,
    currentlyNotInStock: false,
    selectedOptions: [{ name: 'Color', value: 'Ice' }],
    price: { amount: '699.95', currencyCode: 'EUR' },
    compareAtPrice: null,
    image: { url: 'https://cdn.shopify.com/ice.jpg', altText: null },
    product: {
      id: PRODUCT_ID,
      handle: 'the-complete-snowboard',
      title: 'The Complete Snowboard',
      vendor: 'Snowboard Vendor',
      onlineStoreUrl: null,
      featuredImage: {
        url: 'https://cdn.shopify.com/board.jpg',
        altText: null,
      },
    },
    ...overrides,
  };
}

function collectionNode(
  overrides: Partial<CollectionSummary> = {},
): CollectionSummary {
  return {
    __typename: 'Collection',
    id: COLLECTION_ID,
    handle: 'frontpage',
    title: 'Home page',
    updatedAt: '2026-07-19T00:46:43Z',
    onlineStoreUrl: null,
    image: null,
    ...overrides,
  };
}

const productRef = { id: PRODUCT_ID, handle: 'the-complete-snowboard' };
const productRef2 = {
  id: PRODUCT_2_ID,
  handle: 'the-collection-snowboard-liquid',
};
const variantRef = {
  id: VARIANT_ID,
  productId: PRODUCT_ID,
  productHandle: 'the-complete-snowboard',
};
const collectionRef = { id: COLLECTION_ID, handle: 'frontpage' };

function doc(kind: ShopifyKind, references: unknown[], shop = SHOP) {
  return { version: 1, shop, kind, references };
}

function expectError(
  result: ReturnType<typeof parseStoredValue>,
  code: StoredValueErrorCode,
  rawValue: unknown,
) {
  expect(result).toEqual({
    ok: false,
    code,
    message: describeStoredValueError(code),
    rawValue,
  });
}

// ---------------------------------------------------------------------------

describe('parseStoredValue: empty values', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '  \n '],
  ])('treats %s as empty in both field types', (_label, raw) => {
    for (const fieldType of ['string', 'json'] as const) {
      expect(parse(raw, fieldType, { kind: 'collection' })).toEqual({
        ok: true,
        format: null,
        kind: 'collection',
        shop: null,
        entries: [],
        legacyProduct: null,
      });
    }
  });

  it('treats serialized JSON null as empty', () => {
    expect(parse('null', 'json')).toMatchObject({ ok: true, format: null });
  });
});

describe('parseStoredValue: string fields', () => {
  it('reads a 1.x handle exactly as stored', () => {
    expect(
      parse('the-complete-snowboard', 'string', { format: 'handle' }),
    ).toEqual({
      ok: true,
      format: 'handle',
      kind: 'product',
      shop: null,
      entries: [
        {
          key: 'handle:the-complete-snowboard',
          kind: 'product',
          id: null,
          handle: 'the-complete-snowboard',
        },
      ],
      legacyProduct: null,
    });

    const padded = parse(' padded-handle ', 'string', { format: 'handle' });
    expect(padded).toMatchObject({
      ok: true,
      entries: [{ handle: ' padded-handle ', key: 'handle: padded-handle ' }],
    });
  });

  it('reads collection handles in collection fields', () => {
    expect(
      parse('frontpage', 'string', { kind: 'collection', format: 'handle' }),
    ).toMatchObject({
      ok: true,
      format: 'handle',
      kind: 'collection',
      entries: [{ kind: 'collection', handle: 'frontpage', id: null }],
    });
  });

  it('detects GIDs and base64 GIDs whatever the configured format', () => {
    for (const raw of [PRODUCT_ID, PRODUCT_BASE64, ` ${PRODUCT_ID} `]) {
      expect(parse(raw, 'string', { format: 'handle' })).toEqual({
        ok: true,
        format: 'gid',
        kind: 'product',
        shop: null,
        entries: [
          { key: PRODUCT_ID, kind: 'product', id: PRODUCT_ID, handle: null },
        ],
        legacyProduct: null,
      });
    }
  });

  it('reads GIDs in the canonical form Shopify returns as node.id', () => {
    // Shopify answers all of these with `gid://shopify/Product/10080752009562`.
    for (const raw of [
      `${PRODUCT_ID}?variant=50698337681754`,
      'gid://shopify/Product/010080752009562',
      btoa(`${PRODUCT_ID}?x=1`),
    ]) {
      expect(parse(raw, 'string', { format: 'gid' })).toEqual({
        ok: true,
        format: 'gid',
        kind: 'product',
        shop: null,
        entries: [
          { key: PRODUCT_ID, kind: 'product', id: PRODUCT_ID, handle: null },
        ],
        legacyProduct: null,
      });
    }
  });

  it('reads variant and collection GIDs', () => {
    expect(
      parse(VARIANT_ID, 'string', { kind: 'variant', format: 'gid' }),
    ).toMatchObject({
      ok: true,
      format: 'gid',
      kind: 'variant',
      entries: [
        {
          key: VARIANT_ID,
          kind: 'variant',
          id: VARIANT_ID,
          handle: null,
          productId: null,
        },
      ],
    });
    expect(
      parse(btoa(COLLECTION_ID), 'string', {
        kind: 'collection',
        format: 'gid',
      }),
    ).toMatchObject({
      ok: true,
      format: 'gid',
      entries: [{ id: COLLECTION_ID, kind: 'collection' }],
    });
  });

  it('rejects GIDs of another kind, and handles in variant fields', () => {
    expectError(
      parse(VARIANT_ID, 'string', { format: 'gid' }),
      'kind-mismatch',
      VARIANT_ID,
    );
    expectError(
      parse(PRODUCT_ID, 'string', { kind: 'collection', format: 'handle' }),
      'kind-mismatch',
      PRODUCT_ID,
    );
    expectError(
      parse('gid://shopify/Order/1', 'string', { format: 'gid' }),
      'kind-mismatch',
      'gid://shopify/Order/1',
    );
    expectError(
      parse('the-complete-snowboard', 'string', {
        kind: 'variant',
        format: 'gid',
      }),
      'kind-mismatch',
      'the-complete-snowboard',
    );
  });

  it('rejects non-string values', () => {
    expectError(parse(42, 'string'), 'invalid-shape', 42);
    expectError(parse({ handle: 'x' }, 'string'), 'invalid-shape', {
      handle: 'x',
    });
  });
});

describe('parseStoredValue: legacy product JSON', () => {
  const legacy1x = JSON.parse(legacy1xText) as LegacyProductJson;

  it('reads the recorded 1.x value from a JSON string', () => {
    expect(
      parse(legacy1xText, 'json', { format: 'legacyProductJson' }),
    ).toEqual({
      ok: true,
      format: 'legacyProductJson',
      kind: 'product',
      shop: null,
      entries: [
        {
          key: PRODUCT_ID,
          kind: 'product',
          id: PRODUCT_ID,
          handle: 'the-complete-snowboard',
        },
      ],
      legacyProduct: legacy1x,
    });
  });

  it('accepts already-parsed objects and keeps them as-is', () => {
    const result = parse(legacy1x, 'json', { format: 'legacyProductJson' });
    expect(result.ok && result.legacyProduct).toBe(legacy1x);
  });

  it('decodes base64 ids and keeps the original object', () => {
    const result = parse(legacyBase64Text, 'json', {
      format: 'legacyProductJson',
    });
    expect(result).toMatchObject({
      ok: true,
      format: 'legacyProductJson',
      entries: [{ key: PRODUCT_ID, id: PRODUCT_ID }],
      legacyProduct: { id: PRODUCT_BASE64 },
    });
  });

  it('canonicalizes the id but keeps the original object', () => {
    const raw = {
      id: `${PRODUCT_ID}?variant=50698337681754`,
      handle: 'the-complete-snowboard',
    };
    expect(parse(raw, 'json')).toMatchObject({
      ok: true,
      format: 'legacyProductJson',
      entries: [{ key: PRODUCT_ID, id: PRODUCT_ID }],
      legacyProduct: { id: raw.id },
    });
  });

  it('reads old values with 200x200 crop_center images and no preview keys', () => {
    const result = parse(legacyCropCenterText, 'json', {
      format: 'legacyProductJson',
    });
    expect(result).toMatchObject({ ok: true, format: 'legacyProductJson' });
    expect(result.ok && result.legacyProduct?.imageUrl).toMatch(
      /_200x200_crop_center\.jpg/,
    );
  });

  it('accepts values with missing optional keys', () => {
    expect(
      parse({ handle: 'the-complete-snowboard' }, 'json', {
        format: 'legacyProductJson',
      }),
    ).toMatchObject({
      ok: true,
      format: 'legacyProductJson',
      entries: [
        {
          key: 'handle:the-complete-snowboard',
          id: null,
          handle: 'the-complete-snowboard',
        },
      ],
    });
    expect(
      parse(JSON.stringify({ id: PRODUCT_BASE64, title: 'Old' }), 'json'),
    ).toMatchObject({
      ok: true,
      format: 'legacyProductJson',
      entries: [{ key: PRODUCT_ID, id: PRODUCT_ID, handle: null }],
    });
    // The 1.x README's numeric id isn't a GID: the handle identifies it.
    expect(
      parse({ id: '1234567890', handle: 'classic-tee' }, 'json'),
    ).toMatchObject({
      ok: true,
      entries: [{ id: null, handle: 'classic-tee' }],
    });
  });

  it('is recognized in a field configured for reference documents', () => {
    expect(parse(legacy1xText, 'json', { format: 'reference' })).toMatchObject({
      ok: true,
      format: 'legacyProductJson',
    });
  });

  it('is a kind mismatch outside product fields', () => {
    expectError(
      parse(legacy1xText, 'json', { kind: 'variant' }),
      'kind-mismatch',
      legacy1xText,
    );
  });

  it('rejects objects that identify nothing', () => {
    for (const raw of [
      {},
      { title: 'No handle' },
      { handle: '' },
      { id: VARIANT_ID },
      { references: [productRef] },
    ]) {
      expectError(parse(raw, 'json'), 'invalid-shape', raw);
    }
  });
});

describe('parseStoredValue: reference documents', () => {
  it('reads product, variant and collection documents', () => {
    const product = JSON.stringify(doc('product', [productRef]), null, 2);
    expect(parse(product, 'json')).toEqual({
      ok: true,
      format: 'reference',
      kind: 'product',
      shop: SHOP,
      entries: [
        {
          key: PRODUCT_ID,
          kind: 'product',
          id: PRODUCT_ID,
          handle: 'the-complete-snowboard',
        },
      ],
      legacyProduct: null,
    });

    expect(
      parse(doc('variant', [variantRef]), 'json', { kind: 'variant' }),
    ).toMatchObject({
      ok: true,
      kind: 'variant',
      entries: [
        {
          key: VARIANT_ID,
          kind: 'variant',
          id: VARIANT_ID,
          handle: 'the-complete-snowboard',
          productId: PRODUCT_ID,
        },
      ],
    });

    expect(
      parse(doc('collection', [collectionRef]), 'json', { kind: 'collection' }),
    ).toMatchObject({
      ok: true,
      kind: 'collection',
      entries: [{ id: COLLECTION_ID, handle: 'frontpage' }],
    });
  });

  it('keeps editor order and snapshots in multiple fields', () => {
    const snapshot = {
      title: 'Liquid',
      imageUrl: 'https://cdn.shopify.com/liquid.jpg',
      price: { amount: '749.95', currencyCode: 'EUR' },
      capturedAt: EXAMPLE_CAPTURED_AT,
    };
    const result = parse(
      doc('product', [{ ...productRef2, snapshot }, productRef]),
      'json',
      { cardinality: 'multiple' },
    );
    expect(result).toMatchObject({
      ok: true,
      entries: [{ id: PRODUCT_2_ID, snapshot }, { id: PRODUCT_ID }],
    });
    expect(result.ok && 'snapshot' in (result.entries[1] ?? {})).toBe(false);
  });

  it('is recognized in a field configured for legacy JSON', () => {
    expect(
      parse(doc('product', [productRef]), 'json', {
        format: 'legacyProductJson',
      }),
    ).toMatchObject({ ok: true, format: 'reference' });
  });

  it('rejects unsupported versions', () => {
    const raw = JSON.stringify({ ...doc('product', [productRef]), version: 2 });
    expectError(parse(raw, 'json'), 'unsupported-version', raw);
  });

  it.each([
    ['a string version', { ...doc('product', [productRef]), version: '1' }],
    [
      'a missing shop',
      { version: 1, kind: 'product', references: [productRef] },
    ],
    ['an empty shop', doc('product', [productRef], ' ')],
    ['an unknown kind', doc('metaobject' as ShopifyKind, [productRef])],
    ['no references', doc('product', [])],
    [
      'references that are not an array',
      { ...doc('product', []), references: {} },
    ],
    ['an extra document key', { ...doc('product', [productRef]), extra: true }],
    ['an extra reference key', doc('product', [{ ...productRef, title: 'x' }])],
    ['a missing handle', doc('product', [{ id: PRODUCT_ID }])],
    ['an empty handle', doc('product', [{ id: PRODUCT_ID, handle: '' }])],
    [
      'an id of another kind',
      doc('product', [{ ...productRef, id: COLLECTION_ID }]),
    ],
    ['a base64 id', doc('product', [{ ...productRef, id: PRODUCT_BASE64 }])],
    [
      'an id with a query string',
      doc('product', [{ ...productRef, id: `${PRODUCT_ID}?x=1` }]),
    ],
    [
      'an id with a leading zero',
      doc('product', [
        { ...productRef, id: 'gid://shopify/Product/010080752009562' },
      ]),
    ],
    ['a padded id', doc('product', [{ ...productRef, id: ` ${PRODUCT_ID}` }])],
    [
      'a productId with a query string',
      doc('variant', [{ ...variantRef, productId: `${PRODUCT_ID}?x=1` }]),
    ],
    [
      'a variant without productId',
      doc('variant', [{ id: VARIANT_ID, productHandle: 'x' }]),
    ],
    [
      'a variant with a bad productId',
      doc('variant', [{ ...variantRef, productId: VARIANT_ID }]),
    ],
    [
      'a variant shaped like a product',
      doc('variant', [{ id: VARIANT_ID, handle: 'x' }]),
    ],
    ['a non-object reference', doc('product', ['the-complete-snowboard'])],
    [
      'an unknown snapshot key',
      doc('product', [
        {
          ...productRef,
          snapshot: { title: 'x', capturedAt: 'y', vendor: 'z' },
        },
      ]),
    ],
    [
      'a snapshot without capturedAt',
      doc('product', [{ ...productRef, snapshot: { title: 'x' } }]),
    ],
    [
      'a snapshot with a numeric price',
      doc('product', [
        { ...productRef, snapshot: { title: 'x', capturedAt: 'y', price: 10 } },
      ]),
    ],
    [
      'a snapshot price with extra keys',
      doc('product', [
        {
          ...productRef,
          snapshot: {
            title: 'x',
            capturedAt: 'y',
            price: { amount: '1', currencyCode: 'EUR', extra: 1 },
          },
        },
      ]),
    ],
    [
      'a snapshot with a non-string sku',
      doc('product', [
        { ...productRef, snapshot: { title: 'x', capturedAt: 'y', sku: 3 } },
      ]),
    ],
    ['a null snapshot', doc('product', [{ ...productRef, snapshot: null }])],
  ])('rejects %s as invalid-shape', (_label, raw) => {
    expectError(
      parse(raw, 'json', {
        kind: raw.kind === 'variant' ? 'variant' : 'product',
        cardinality: 'multiple',
      }),
      'invalid-shape',
      raw,
    );
  });

  it('rejects documents of another kind', () => {
    const raw = doc('collection', [collectionRef]);
    expectError(parse(raw, 'json'), 'kind-mismatch', raw);
  });

  it('rejects several references in a single field', () => {
    const raw = doc('product', [productRef, productRef2]);
    expectError(parse(raw, 'json'), 'cardinality-mismatch', raw);
    expect(parse(raw, 'json', { cardinality: 'multiple' })).toMatchObject({
      ok: true,
    });
  });

  it('rejects duplicate references', () => {
    const raw = doc('product', [productRef, productRef2, productRef]);
    expectError(
      parse(raw, 'json', { cardinality: 'multiple' }),
      'duplicate-reference',
      raw,
    );
  });

  it('does not accept another spelling of an id as a distinct reference', () => {
    const raw = doc('product', [
      productRef,
      { ...productRef, id: `${PRODUCT_ID}?x=1` },
    ]);
    expectError(
      parse(raw, 'json', { cardinality: 'multiple' }),
      'invalid-shape',
      raw,
    );
  });

  it('rejects documents for another shop, case-insensitively', () => {
    const raw = doc('product', [productRef], 'other.myshopify.com');
    expectError(parse(raw, 'json'), 'shop-mismatch', raw);
    expect(
      parse(doc('product', [productRef], 'DatoCMS-Demo.myshopify.com'), 'json'),
    ).toMatchObject({ ok: true, shop: 'DatoCMS-Demo.myshopify.com' });
    expect(parse(raw, 'json', {}, null)).toMatchObject({
      ok: true,
      shop: 'other.myshopify.com',
    });
  });
});

describe('parseStoredValue: every stored format in every field type', () => {
  const referenceText = JSON.stringify(doc('product', [productRef]), null, 2);
  const samples: Record<StorageFormat, string> = {
    handle: 'the-complete-snowboard',
    gid: PRODUCT_ID,
    legacyProductJson: legacy1xText,
    reference: referenceText,
  };
  const formats: StorageFormat[] = [
    'handle',
    'gid',
    'reference',
    'legacyProductJson',
  ];

  // String fields treat any non-GID text as an opaque handle, as 1.x did.
  const expectedInString: Record<StorageFormat, StorageFormat> = {
    handle: 'handle',
    gid: 'gid',
    legacyProductJson: 'handle',
    reference: 'handle',
  };
  const expectedInJson: Record<StorageFormat, StorageFormat | 'invalid-json'> =
    {
      handle: 'invalid-json',
      gid: 'invalid-json',
      legacyProductJson: 'legacyProductJson',
      reference: 'reference',
    };

  for (const configured of formats) {
    for (const stored of formats) {
      it(`string field set to ${configured}, holding ${stored}`, () => {
        expect(
          parse(samples[stored], 'string', { format: configured }),
        ).toMatchObject({ ok: true, format: expectedInString[stored] });
      });

      it(`JSON field set to ${configured}, holding ${stored}`, () => {
        const result = parse(samples[stored], 'json', { format: configured });
        const expected = expectedInJson[stored];
        if (expected === 'invalid-json') {
          expectError(result, 'invalid-json', samples[stored]);
        } else {
          expect(result).toMatchObject({ ok: true, format: expected });
        }
      });
    }
  }
});

describe('parseStoredValue: invalid JSON values', () => {
  it.each([['{broken'], ['the-complete-snowboard'], ['{"a":']])(
    'reports invalid-json for %s and keeps the raw value',
    (raw) => {
      expectError(parse(raw, 'json'), 'invalid-json', raw);
    },
  );

  it.each([
    ['an array', '[1,2]'],
    ['a number', '42'],
    ['a JSON string', '"the-complete-snowboard"'],
    ['a boolean', 'true'],
  ])('reports invalid-shape for %s', (_label, raw) => {
    expectError(parse(raw, 'json'), 'invalid-shape', raw);
  });

  it('reports invalid-shape for non-string, non-object values', () => {
    expectError(parse(42, 'json'), 'invalid-shape', 42);
    expectError(parse([productRef], 'json'), 'invalid-shape', [productRef]);
  });
});

describe('describeStoredValueError', () => {
  it('has a plain-language message for every code', () => {
    const codes: StoredValueErrorCode[] = [
      'invalid-json',
      'invalid-shape',
      'unsupported-version',
      'kind-mismatch',
      'cardinality-mismatch',
      'shop-mismatch',
      'duplicate-reference',
    ];
    const messages = codes.map(describeStoredValueError);
    expect(new Set(messages).size).toBe(codes.length);
    for (const message of messages) {
      expect(message).toMatch(/^The saved value .+\.$/);
    }
    expect(describeStoredValueError('invalid-json')).toBe(
      "The saved value isn't valid JSON.",
    );
  });
});

// ---------------------------------------------------------------------------

describe('snapshotFromNode and entryFromNode', () => {
  const at = '2026-10-03T12:00:00Z';

  it('snapshots products with the minimum price and featured image', () => {
    const snapshot = snapshotFromNode(productNode(), at);
    expect(snapshot).toEqual({
      title: 'The Complete Snowboard',
      imageUrl: 'https://cdn.shopify.com/board.jpg',
      price: { amount: '699.95', currencyCode: 'EUR' },
      capturedAt: at,
    });
    expect(Object.keys(snapshot)).toEqual([
      'title',
      'imageUrl',
      'price',
      'capturedAt',
    ]);
  });

  it('snapshots variants with the display title, image fallback and sku', () => {
    expect(snapshotFromNode(variantNode(), at)).toEqual({
      title: 'The Complete Snowboard — Ice',
      imageUrl: 'https://cdn.shopify.com/ice.jpg',
      price: { amount: '699.95', currencyCode: 'EUR' },
      sku: 'SKU-ICE',
      capturedAt: at,
    });
    const fallback = snapshotFromNode(
      variantNode({ title: 'Default Title', sku: '', image: null }),
      at,
    );
    expect(fallback).toEqual({
      title: 'The Complete Snowboard',
      imageUrl: 'https://cdn.shopify.com/board.jpg',
      price: { amount: '699.95', currencyCode: 'EUR' },
      capturedAt: at,
    });
  });

  it('omits missing images and prices instead of writing undefined', () => {
    const collection = snapshotFromNode(collectionNode(), at);
    expect(collection).toEqual({ title: 'Home page', capturedAt: at });
    expect(Object.keys(collection)).toEqual(['title', 'capturedAt']);
    const product = snapshotFromNode(productNode({ featuredImage: null }), at);
    expect('imageUrl' in product).toBe(false);
  });

  it('builds entries, with snapshots only on request', () => {
    expect(entryFromNode(productNode())).toEqual({
      key: PRODUCT_ID,
      kind: 'product',
      id: PRODUCT_ID,
      handle: 'the-complete-snowboard',
    });
    expect(entryFromNode(variantNode())).toEqual({
      key: VARIANT_ID,
      kind: 'variant',
      id: VARIANT_ID,
      handle: 'the-complete-snowboard',
      productId: PRODUCT_ID,
    });
    expect(
      entryFromNode(collectionNode(), { snapshot: true, capturedAt: at }),
    ).toEqual({
      key: COLLECTION_ID,
      kind: 'collection',
      id: COLLECTION_ID,
      handle: 'frontpage',
      snapshot: { title: 'Home page', capturedAt: at },
    });
    const stamped = entryFromNode(productNode(), { snapshot: true });
    expect(Number.isNaN(Date.parse(stamped.snapshot?.capturedAt ?? ''))).toBe(
      false,
    );
  });
});

describe('buildReferenceDocument', () => {
  const at = '2026-10-03T12:00:00Z';

  it('builds documents with exact key order', () => {
    const document = buildReferenceDocument(
      'variant',
      SHOP,
      [entryFromNode(variantNode(), { snapshot: true, capturedAt: at })],
      { snapshot: true },
    );
    expect(document).toEqual({
      version: 1,
      shop: SHOP,
      kind: 'variant',
      references: [
        {
          ...variantRef,
          snapshot: {
            title: 'The Complete Snowboard — Ice',
            imageUrl: 'https://cdn.shopify.com/ice.jpg',
            price: { amount: '699.95', currencyCode: 'EUR' },
            sku: 'SKU-ICE',
            capturedAt: at,
          },
        },
      ],
    });
    expect(Object.keys(document ?? {})).toEqual([
      'version',
      'shop',
      'kind',
      'references',
    ]);
    const reference = document?.references[0] ?? {};
    expect(Object.keys(reference)).toEqual([
      'id',
      'productId',
      'productHandle',
      'snapshot',
    ]);
  });

  it('writes product and collection references as id and handle', () => {
    const products = buildReferenceDocument('product', SHOP, [
      entryFromNode(productNode()),
    ]);
    expect(products?.references).toEqual([productRef]);
    expect(Object.keys(products?.references[0] ?? {})).toEqual([
      'id',
      'handle',
    ]);
    expect(
      buildReferenceDocument('collection', SHOP, [
        entryFromNode(collectionNode()),
      ]),
    ).toEqual({
      version: 1,
      shop: SHOP,
      kind: 'collection',
      references: [collectionRef],
    });
  });

  it('includes snapshots only when asked and present', () => {
    const withSnapshot = entryFromNode(productNode(), {
      snapshot: true,
      capturedAt: at,
    });
    expect(
      buildReferenceDocument('product', SHOP, [withSnapshot])?.references,
    ).toEqual([productRef]);
    expect(
      buildReferenceDocument('product', SHOP, [entryFromNode(productNode())], {
        snapshot: true,
      })?.references,
    ).toEqual([productRef]);
  });

  it('returns null for no entries and dedupes keeping the first', () => {
    expect(buildReferenceDocument('product', SHOP, [])).toBeNull();
    const first = entryFromNode(productNode());
    const second = entryFromNode(
      productNode({ id: PRODUCT_2_ID, handle: 'liquid' }),
    );
    const duplicate = { ...first, handle: 'renamed' };
    expect(
      buildReferenceDocument('product', SHOP, [first, second, duplicate])
        ?.references,
    ).toEqual([productRef, { id: PRODUCT_2_ID, handle: 'liquid' }]);
  });

  it('refuses several entries for a single-value field', () => {
    const first = entryFromNode(productNode());
    const second = entryFromNode(productNode({ id: PRODUCT_2_ID }));
    expect(() =>
      buildReferenceDocument('product', SHOP, [first, second], {
        cardinality: 'single',
      }),
    ).toThrow(expect.objectContaining({ code: 'too-many-entries' }));
    expect(
      buildReferenceDocument('product', SHOP, [first, first], {
        cardinality: 'single',
      })?.references,
    ).toEqual([productRef]);
    expect(
      buildReferenceDocument('product', SHOP, [first, second], {
        cardinality: 'multiple',
      })?.references,
    ).toHaveLength(2);
  });

  it('writes canonical ids and dedupes other spellings of them', () => {
    const product = entryFromNode(productNode());
    const suffixed = { ...product, key: 'x', id: `${PRODUCT_ID}?variant=1` };
    expect(
      buildReferenceDocument('product', SHOP, [suffixed, product])?.references,
    ).toEqual([productRef]);
    const variant = {
      ...entryFromNode(variantNode()),
      id: btoa(VARIANT_ID),
      productId: 'gid://shopify/Product/010080752009562',
    };
    expect(
      buildReferenceDocument('variant', SHOP, [variant])?.references,
    ).toEqual([variantRef]);
  });

  it('throws typed errors for incomplete entries', () => {
    const cases: Array<[ShopifyKind, StoredEntry, string]> = [
      [
        'product',
        { key: 'handle:x', kind: 'product', id: null, handle: 'x' },
        'missing-id',
      ],
      [
        'product',
        { key: PRODUCT_ID, kind: 'product', id: PRODUCT_ID, handle: null },
        'missing-handle',
      ],
      [
        'variant',
        {
          key: VARIANT_ID,
          kind: 'variant',
          id: VARIANT_ID,
          handle: 'x',
          productId: null,
        },
        'missing-product-id',
      ],
      [
        'product',
        { key: VARIANT_ID, kind: 'variant', id: VARIANT_ID, handle: 'x' },
        'kind-mismatch',
      ],
      [
        'product',
        { key: COLLECTION_ID, kind: 'product', id: COLLECTION_ID, handle: 'x' },
        'kind-mismatch',
      ],
    ];
    for (const [kind, entry, code] of cases) {
      expect(() => buildReferenceDocument(kind, SHOP, [entry])).toThrow(
        expect.objectContaining({ name: 'StoredValueBuildError', code }),
      );
    }
    expect(() =>
      buildReferenceDocument('product', '', [entryFromNode(productNode())]),
    ).toThrow(StoredValueBuildError);
  });
});

describe('serializeStoredValue', () => {
  const legacyProduct = buildLegacyProductJson(legacyNode as LegacyProductNode);
  const product = entryFromNode(productNode());

  function serialize(
    fieldType: FieldType,
    format: StorageFormat,
    kind: ShopifyKind,
    entries: StoredEntry[],
    extra: {
      snapshot?: boolean;
      cardinality?: FieldParametersV1['cardinality'];
      legacyProduct?: LegacyProductJson | null;
    } = {},
  ) {
    return serializeStoredValue({
      fieldType,
      format,
      kind,
      shop: SHOP,
      entries,
      ...extra,
    });
  }

  it('writes the handle and GID formats as bare strings', () => {
    expect(serialize('string', 'handle', 'product', [product])).toBe(
      'the-complete-snowboard',
    );
    expect(
      serialize('string', 'handle', 'collection', [
        entryFromNode(collectionNode()),
      ]),
    ).toBe('frontpage');
    expect(
      serialize('string', 'gid', 'variant', [entryFromNode(variantNode())]),
    ).toBe(VARIANT_ID);
  });

  it('writes reference documents with two-space indentation', () => {
    const value = serialize('json', 'reference', 'product', [product]);
    expect(value).toBe(JSON.stringify(doc('product', [productRef]), null, 2));
  });

  it('writes legacy JSON compact, byte-identical to 1.x', () => {
    expect(
      serialize('json', 'legacyProductJson', 'product', [product], {
        legacyProduct,
      }),
    ).toBe(LEGACY_1X_COMPACT);
  });

  it('returns null when there is nothing to store', () => {
    for (const format of ['handle', 'gid'] as const) {
      expect(serialize('string', format, 'product', [])).toBeNull();
    }
    for (const format of ['reference', 'legacyProductJson'] as const) {
      expect(serialize('json', format, 'product', [])).toBeNull();
    }
  });

  it('throws typed errors for impossible requests', () => {
    const variant = entryFromNode(variantNode());
    const cases: Array<[() => unknown, string]> = [
      [
        () => serialize('json', 'handle', 'product', [product]),
        'format-mismatch',
      ],
      [
        () => serialize('string', 'reference', 'product', [product]),
        'format-mismatch',
      ],
      [
        () => serialize('string', 'legacyProductJson', 'product', [product]),
        'format-mismatch',
      ],
      [() => serialize('json', 'gid', 'product', [product]), 'format-mismatch'],
      [
        () => serialize('string', 'handle', 'variant', [variant]),
        'format-mismatch',
      ],
      [
        () =>
          serialize('json', 'legacyProductJson', 'variant', [variant], {
            legacyProduct,
          }),
        'format-mismatch',
      ],
      [
        () => serialize('json', 'legacyProductJson', 'product', [product]),
        'missing-legacy-product',
      ],
      [
        () =>
          serialize('string', 'gid', 'product', [
            { ...product, id: null, key: 'handle:x' },
          ]),
        'missing-id',
      ],
      [
        () =>
          serialize('string', 'handle', 'product', [
            { ...product, handle: null },
          ]),
        'missing-handle',
      ],
      [() => serialize('string', 'gid', 'product', [variant]), 'kind-mismatch'],
      [
        () =>
          serialize('string', 'handle', 'product', [
            product,
            entryFromNode(productNode({ id: PRODUCT_2_ID })),
          ]),
        'too-many-entries',
      ],
      [
        () =>
          serialize(
            'json',
            'reference',
            'product',
            [product, entryFromNode(productNode({ id: PRODUCT_2_ID }))],
            { cardinality: 'single' },
          ),
        'too-many-entries',
      ],
    ];
    for (const [run, code] of cases) {
      expect(run).toThrow(expect.objectContaining({ code }));
    }
  });

  it('never writes a document a single-value field would reject', () => {
    // Without the guard this wrote two references, which the parser then
    // rejected as a cardinality mismatch.
    const entries = [product, entryFromNode(productNode({ id: PRODUCT_2_ID }))];
    expect(() =>
      serialize('json', 'reference', 'product', entries, {
        cardinality: 'single',
      }),
    ).toThrow(StoredValueBuildError);
    const multiple = serialize('json', 'reference', 'product', entries, {
      cardinality: 'multiple',
    });
    expect(parse(multiple, 'json', { cardinality: 'multiple' })).toMatchObject({
      ok: true,
      entries: [{ id: PRODUCT_ID }, { id: PRODUCT_2_ID }],
    });
  });

  it('writes GIDs in canonical form', () => {
    expect(
      serialize('string', 'gid', 'product', [
        { ...product, id: `${PRODUCT_ID}?variant=1` },
      ]),
    ).toBe(PRODUCT_ID);
  });

  it('dedupes before checking single formats', () => {
    expect(serialize('string', 'handle', 'product', [product, product])).toBe(
      'the-complete-snowboard',
    );
  });
});

describe('round trips: parseStoredValue(serializeStoredValue(x))', () => {
  const at = '2026-10-03T12:00:00Z';
  const nodes: Record<ShopifyKind, ShopifyNode[]> = {
    product: [
      productNode(),
      productNode({ id: PRODUCT_2_ID, handle: 'liquid', title: 'Liquid' }),
    ],
    variant: [
      variantNode(),
      variantNode({ id: VARIANT_2_ID, title: 'Default Title', sku: null }),
    ],
    collection: [
      collectionNode(),
      collectionNode({
        id: 'gid://shopify/Collection/645261132122',
        handle: 'hydrogen',
        title: 'Hydrogen',
        image: { url: 'https://cdn.shopify.com/h.jpg', altText: null },
      }),
    ],
  };

  const cases: Array<
    [FieldType, StorageFormat, ShopifyKind, boolean, boolean]
  > = [];
  for (const kind of ['product', 'variant', 'collection'] as const) {
    for (const multiple of [false, true]) {
      for (const snapshot of [false, true]) {
        cases.push(['json', 'reference', kind, multiple, snapshot]);
      }
    }
    cases.push(['string', 'gid', kind, false, false]);
    if (kind !== 'variant')
      cases.push(['string', 'handle', kind, false, false]);
  }
  cases.push(['json', 'legacyProductJson', 'product', false, false]);

  it.each(cases)(
    '%s field, %s format, %s (multiple: %s, snapshot: %s)',
    (fieldType, format, kind, multiple, snapshot) => {
      const entries = nodes[kind]
        .slice(0, multiple ? 2 : 1)
        .map((node) => entryFromNode(node, { snapshot, capturedAt: at }));
      const legacyProduct =
        format === 'legacyProductJson'
          ? buildLegacyProductJson(legacyNode as LegacyProductNode)
          : null;
      const serialized = serializeStoredValue({
        fieldType,
        format,
        kind,
        shop: SHOP,
        entries,
        snapshot,
        cardinality: multiple ? 'multiple' : 'single',
        legacyProduct,
      });
      const parsed = parse(serialized, fieldType, {
        kind,
        format,
        cardinality: multiple ? 'multiple' : 'single',
        snapshot,
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.format).toBe(format);
      expect(parsed.kind).toBe(kind);

      const expected = entries.map((entry) => {
        if (format === 'handle') {
          return {
            key: `handle:${entry.handle}`,
            kind,
            id: null,
            handle: entry.handle,
          };
        }
        if (format === 'gid') {
          return kind === 'variant'
            ? {
                key: entry.id,
                kind,
                id: entry.id,
                handle: null,
                productId: null,
              }
            : { key: entry.id, kind, id: entry.id, handle: null };
        }
        if (format === 'legacyProductJson') {
          return { key: entry.id, kind, id: entry.id, handle: entry.handle };
        }
        return entry;
      });
      expect(parsed.entries).toEqual(expected);
      if (format === 'reference') {
        expect(parsed.shop).toBe(SHOP);
        // Serializing the parsed entries again gives the same bytes.
        expect(
          serializeStoredValue({
            fieldType,
            format,
            kind,
            shop: SHOP,
            entries: parsed.entries,
            snapshot,
          }),
        ).toBe(serialized);
      }
      if (format === 'legacyProductJson') {
        expect(parsed.legacyProduct).toEqual(legacyProduct);
      }
    },
  );
});

// ---------------------------------------------------------------------------

describe('canStoreEntries and storeEntriesProblem', () => {
  const product = entryFromNode(productNode());
  const product2 = entryFromNode(productNode({ id: PRODUCT_2_ID }));
  const variant = entryFromNode(variantNode());

  it('accepts entries that fit', () => {
    expect(canStoreEntries(params(), [product])).toBe(true);
    expect(canStoreEntries(params(), [])).toBe(true);
    expect(canStoreEntries(params(), [product, product])).toBe(true);
    expect(
      canStoreEntries(params({ cardinality: 'multiple' }), [product, product2]),
    ).toBe(true);
    expect(
      canStoreEntries(params({ kind: 'variant', format: 'gid' }), [variant]),
    ).toBe(true);
  });

  it('explains why entries do not fit', () => {
    expect(storeEntriesProblem(params(), [product, product2])).toBe(
      'This field holds one product, but the value has 2.',
    );
    expect(
      storeEntriesProblem(
        params({ format: 'handle', cardinality: 'multiple' }),
        [product, product2],
      ),
    ).toBe('This field holds one product, but the value has 2.');
    expect(
      storeEntriesProblem(params({ cardinality: 'multiple', max: 1 }), [
        product,
        product2,
      ]),
    ).toBe('This field holds one product, but the value has 2.');
    expect(
      storeEntriesProblem(
        params({ kind: 'variant', cardinality: 'multiple', max: 2 }),
        [
          variant,
          { ...variant, id: VARIANT_2_ID, key: VARIANT_2_ID },
          { ...variant, id: 'gid://shopify/ProductVariant/3', key: 'x' },
        ],
      ),
    ).toBe('This field holds up to 2 product variants, but the value has 3.');
    expect(storeEntriesProblem(params(), [variant])).toBe(
      "This field picks products, so it can't hold a product variant.",
    );
    expect(
      storeEntriesProblem(params({ kind: 'variant', format: 'handle' }), [
        variant,
      ]),
    ).toMatch(/can't be saved as a handle/);
    expect(
      storeEntriesProblem(
        params({ kind: 'collection', format: 'legacyProductJson' }),
        [entryFromNode(collectionNode())],
      ),
    ).toBe('Legacy product JSON can only hold a product.');
    expect(canStoreEntries(params(), [variant])).toBe(false);
  });
});

describe('canonicalGid', () => {
  it('returns the spelling Shopify uses for node.id', () => {
    expect(canonicalGid(PRODUCT_ID)).toBe(PRODUCT_ID);
    expect(canonicalGid(` ${PRODUCT_ID}?variant=1 `)).toBe(PRODUCT_ID);
    expect(canonicalGid(PRODUCT_BASE64)).toBe(PRODUCT_ID);
    expect(canonicalGid('gid://shopify/Product/010080752009562')).toBe(
      PRODUCT_ID,
    );
    expect(canonicalGid('gid://shopify/Product/0')).toBe(
      'gid://shopify/Product/0',
    );
    expect(canonicalGid('gid://shopify/Order/1?x')).toBe(
      'gid://shopify/Order/1',
    );
  });

  it('returns null for anything else', () => {
    for (const value of [null, 42, '', 'the-complete-snowboard', 'gid://x/1']) {
      expect(canonicalGid(value)).toBeNull();
    }
  });
});

describe('dedupeEntries and moveEntry', () => {
  const a: StoredEntry = {
    key: 'a',
    kind: 'product',
    id: PRODUCT_ID,
    handle: 'a',
  };
  const b: StoredEntry = {
    key: 'handle:b',
    kind: 'product',
    id: null,
    handle: 'b',
  };
  const c: StoredEntry = {
    key: 'c',
    kind: 'product',
    id: PRODUCT_2_ID,
    handle: 'c',
  };

  it('dedupes by GID, or by key without one, keeping the first', () => {
    const sameId = { ...a, key: 'other', handle: 'renamed' };
    const sameHandle = { ...b };
    expect(dedupeEntries([a, b, sameId, c, sameHandle])).toEqual([a, b, c]);
  });

  it('treats other spellings of the same GID as duplicates', () => {
    const suffixed = { ...a, key: 'suffixed', id: `${PRODUCT_ID}?x=1` };
    const encoded = { ...c, key: 'encoded', id: btoa(PRODUCT_2_ID) };
    expect(dedupeEntries([a, suffixed, c, encoded])).toEqual([a, c]);
  });

  it('moves entries without mutating the input', () => {
    const entries = [a, b, c];
    expect(moveEntry(entries, 0, 2)).toEqual([b, c, a]);
    expect(moveEntry(entries, 2, 0)).toEqual([c, a, b]);
    expect(entries).toEqual([a, b, c]);
  });

  it('ignores invalid moves', () => {
    const entries = [a, b, c];
    const moves: Array<[number, number]> = [
      [0, 0],
      [-1, 1],
      [0, 3],
      [3, 0],
      [0.5, 1],
    ];
    for (const [from, to] of moves) {
      const moved = moveEntry(entries, from, to);
      expect(moved).toEqual(entries);
      expect(moved).not.toBe(entries);
    }
  });
});

describe('entryFallbackLabel', () => {
  it('prefers the snapshot title, then the handle, then the id', () => {
    const base: StoredEntry = {
      key: PRODUCT_ID,
      kind: 'product',
      id: PRODUCT_ID,
      handle: 'the-complete-snowboard',
    };
    expect(
      entryFallbackLabel({
        ...base,
        snapshot: { title: 'The Complete Snowboard', capturedAt: 'x' },
      }),
    ).toBe('The Complete Snowboard');
    expect(
      entryFallbackLabel({
        ...base,
        snapshot: { title: ' ', capturedAt: 'x' },
      }),
    ).toBe('the-complete-snowboard');
    expect(entryFallbackLabel(base)).toBe('the-complete-snowboard');
    expect(entryFallbackLabel({ ...base, handle: null })).toBe(PRODUCT_ID);
    expect(
      entryFallbackLabel({
        key: 'handle:',
        kind: 'product',
        id: null,
        handle: '',
      }),
    ).toBe('handle:');
  });
});

describe('detectHandleDrift', () => {
  const stored = entryFromNode(productNode());

  it('returns the live handle when it changed', () => {
    expect(
      detectHandleDrift(stored, productNode({ handle: 'complete-board' })),
    ).toBe('complete-board');
  });

  it('compares variants by their product handle', () => {
    const variant = entryFromNode(variantNode());
    expect(detectHandleDrift(variant, variantNode())).toBeNull();
    expect(
      detectHandleDrift(
        variant,
        variantNode({ product: { ...variantNode().product, handle: 'new' } }),
      ),
    ).toBe('new');
  });

  it('compares handles case-insensitively, as Shopify resolves them', () => {
    const mixedCase = { ...stored, handle: 'The-Complete-Snowboard' };
    expect(detectHandleDrift(mixedCase, productNode())).toBeNull();
    expect(
      detectHandleDrift(mixedCase, productNode({ handle: 'complete-board' })),
    ).toBe('complete-board');
  });

  it('agrees with legacyJsonDrift on the handle', () => {
    const fresh = buildLegacyProductJson(legacyNode as LegacyProductNode);
    for (const handle of [
      'The-Complete-Snowboard',
      ' the-complete-snowboard ',
      'complete-board',
    ]) {
      const entryDrift = detectHandleDrift(
        { ...stored, handle },
        productNode(),
      );
      const jsonDrift = legacyJsonDrift({ ...fresh, handle }, fresh);
      expect(jsonDrift.fields.includes('handle')).toBe(entryDrift !== null);
    }
  });

  it('returns null when equal, padded, or not stored', () => {
    expect(detectHandleDrift(stored, productNode())).toBeNull();
    expect(
      detectHandleDrift(
        { ...stored, handle: ' the-complete-snowboard ' },
        productNode(),
      ),
    ).toBeNull();
    expect(
      detectHandleDrift({ ...stored, handle: null }, productNode()),
    ).toBeNull();
    expect(
      detectHandleDrift(
        entryFromNode(collectionNode()),
        collectionNode({ handle: 'home' }),
      ),
    ).toBe('home');
  });
});

describe('buildExampleStoredValue', () => {
  it('shows a bare handle or GID for string fields', () => {
    expect(
      buildExampleStoredValue('string', params({ format: 'handle' })),
    ).toBe('the-complete-snowboard');
    expect(
      buildExampleStoredValue(
        'string',
        params({ kind: 'collection', format: 'handle' }),
      ),
    ).toBe('frontpage');
    expect(
      buildExampleStoredValue(
        'string',
        params({ kind: 'variant', format: 'gid' }),
      ),
    ).toBe(VARIANT_ID);
  });

  it('shows the full 1.x JSON for legacy fields', () => {
    expect(
      buildExampleStoredValue('json', params({ format: 'legacyProductJson' })),
    ).toBe(LEGACY_1X_COMPACT);
  });

  it('shows two references for multiple fields, with snapshots on request', () => {
    const value = buildExampleStoredValue(
      'json',
      params({ kind: 'variant', cardinality: 'multiple', snapshot: true }),
      'acme.myshopify.com',
    );
    expect(JSON.parse(value)).toEqual({
      version: 1,
      shop: 'acme.myshopify.com',
      kind: 'variant',
      references: [
        {
          id: VARIANT_ID,
          productId: PRODUCT_ID,
          productHandle: 'the-complete-snowboard',
          snapshot: {
            title: 'The Complete Snowboard — Ice',
            imageUrl:
              'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d.jpg?v=1741717811',
            price: { amount: '699.95', currencyCode: 'EUR' },
            capturedAt: EXAMPLE_CAPTURED_AT,
          },
        },
        {
          id: VARIANT_2_ID,
          productId: 'gid://shopify/Product/10080752271706',
          productHandle: 'the-multi-managed-snowboard',
          snapshot: {
            title: 'The Multi-managed Snowboard',
            imageUrl:
              'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_9129b69a-0c7b-4f66-b6cf-c4222f18028a.jpg?v=1741717812',
            price: { amount: '629.95', currencyCode: 'EUR' },
            sku: 'sku-managed-1',
            capturedAt: EXAMPLE_CAPTURED_AT,
          },
        },
      ],
    });
  });

  it('uses the field store, then the demo store', () => {
    expect(
      JSON.parse(
        buildExampleStoredValue(
          'json',
          params({ shopDomain: 'field.myshopify.com' }),
        ),
      ).shop,
    ).toBe('field.myshopify.com');
    expect(JSON.parse(buildExampleStoredValue('json', params())).shop).toBe(
      SHOP,
    );
  });

  it('ignores snapshot for formats that have none and respects max 1', () => {
    expect(
      buildExampleStoredValue(
        'string',
        params({ format: 'gid', snapshot: true }),
      ),
    ).toBe(PRODUCT_ID);
    const single = JSON.parse(
      buildExampleStoredValue(
        'json',
        params({ cardinality: 'multiple', max: 1, kind: 'collection' }),
      ),
    );
    expect(single.references).toEqual([collectionRef]);
  });

  it('returns an empty string for impossible settings', () => {
    expect(
      buildExampleStoredValue(
        'string',
        params({ kind: 'variant', format: 'handle' }),
      ),
    ).toBe('');
    expect(
      buildExampleStoredValue('string', params({ format: 'reference' })),
    ).toBe('');
    expect(
      buildExampleStoredValue(
        'json',
        params({ kind: 'collection', format: 'legacyProductJson' }),
      ),
    ).toBe('');
  });

  function validCombinations(): Array<[FieldType, Partial<FieldParametersV1>]> {
    const combos: Array<[FieldType, Partial<FieldParametersV1>]> = [
      ['json', { format: 'legacyProductJson' }],
    ];
    for (const kind of ['product', 'variant', 'collection'] as const) {
      combos.push(['string', { kind, format: 'gid' }]);
      if (kind !== 'variant')
        combos.push(['string', { kind, format: 'handle' }]);
      for (const cardinality of ['single', 'multiple'] as const) {
        combos.push(['json', { kind, format: 'reference', cardinality }]);
        combos.push([
          'json',
          { kind, format: 'reference', cardinality, snapshot: true },
        ]);
      }
    }
    return combos;
  }

  it.each(validCombinations())(
    'produces a value the parser reads back (%s field, %o)',
    (fieldType, overrides) => {
      const value = buildExampleStoredValue(fieldType, params(overrides));
      expect(value).not.toBe('');
      const parsed = parse(value, fieldType, overrides);
      expect(parsed).toMatchObject({ ok: true, format: overrides.format });
      const entries = parsed.ok ? parsed.entries : [];
      expect(entries).toHaveLength(
        overrides.cardinality === 'multiple' ? 2 : 1,
      );
      const capturedAt = entries.map((entry) => entry.snapshot?.capturedAt);
      expect(capturedAt).toEqual(
        entries.map(() =>
          overrides.snapshot ? EXAMPLE_CAPTURED_AT : undefined,
        ),
      );
    },
  );
});
