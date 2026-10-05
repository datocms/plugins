import { describe, expect, it, vi } from 'vitest';
import { hydrateEntries } from '../src/components/field/useHydration';
import {
  addLabel,
  adminSearchUrl,
  arrangeByKeys,
  buildRowModel,
  convertProblem,
  countKept,
  emptyLabel,
  entriesFromNodes,
  entriesFromSelection,
  entryFallback,
  escapeHtml,
  formatMismatchMessage,
  invalidValueTitle,
  isConnectionProblem,
  isFirstLoad,
  isFormatMismatch,
  kindNoun,
  legacyDriftSummary,
  limitsSummary,
  listSentence,
  loadErrorMessage,
  loadErrorTitle,
  membershipSignature,
  newlyPickedNodes,
  nodesFromSelection,
  notVisibleMessage,
  pickerTitle,
  pluginSettingsPath,
  previewText,
  rawValueText,
  readPickerResult,
  reorderUnavailableReason,
  replaceEntryAt,
  rowMeta,
  selectionChangeMessage,
  selectionWithPrimaryHandles,
  serializeEntries,
  storedDocumentShop,
  toPickerSelected,
  UNRESOLVED_COLLECTION_MESSAGE,
  UNRESOLVED_MESSAGE,
  unresolvedMessage,
  withEntryHandle,
  withPrimaryHandle,
  type WriteTarget,
} from '../src/lib/fieldValue';
import {
  buildLegacyProductJson,
  serializeLegacyProductJson,
} from '../src/lib/legacy';
import { StoredValueBuildError } from '../src/lib/references';
import { ShopifyClientError } from '../src/lib/shopifyClient';
import type {
  CollectionSummary,
  FieldParametersV1,
  LegacyProductNode,
  PickerSelectedEntry,
  ProductSummary,
  ShopifyNode,
  StoredEntry,
  VariantSummary,
} from '../src/types';
import legacyNodeFixture from './fixtures/legacy-product-node-2026-10.json';

const SHOP = 'datocms-demo.myshopify.com';
const PRODUCT_ID = 'gid://shopify/Product/10080752009562';
const PRODUCT_2_ID = 'gid://shopify/Product/10080751911258';
const VARIANT_ID = 'gid://shopify/ProductVariant/50698337681754';
const COLLECTION_ID = 'gid://shopify/Collection/645261132122';
const LEGACY_NODE = legacyNodeFixture as LegacyProductNode;

function params(overrides: Partial<FieldParametersV1> = {}): FieldParametersV1 {
  return {
    paramsVersion: '1',
    kind: 'product',
    cardinality: 'multiple',
    format: 'reference',
    snapshot: false,
    ...overrides,
  };
}

function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
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
      maxVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
    },
    compareAtPriceRange: {
      maxVariantPrice: { amount: '0.0', currencyCode: 'EUR' },
    },
    variantsCount: { count: 5 },
    sku: null,
    ...overrides,
  };
}

function variant(overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
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
      id: PRODUCT_ID,
      handle: 'the-complete-snowboard',
      title: 'The Complete Snowboard',
      vendor: 'Snowboard Vendor',
      onlineStoreUrl: null,
      featuredImage: null,
    },
    ...overrides,
  };
}

function collection(
  overrides: Partial<CollectionSummary> = {},
): CollectionSummary {
  return {
    __typename: 'Collection',
    id: COLLECTION_ID,
    handle: 'hydrogen',
    title: 'Hydrogen',
    updatedAt: '2026-07-19T00:46:43Z',
    onlineStoreUrl: null,
    image: null,
    ...overrides,
  };
}

function entry(overrides: Partial<StoredEntry> = {}): StoredEntry {
  return {
    key: PRODUCT_ID,
    kind: 'product',
    id: PRODUCT_ID,
    handle: 'the-complete-snowboard',
    ...overrides,
  };
}

function selected(node: ShopifyNode | null, key?: string): PickerSelectedEntry {
  return {
    key: key ?? node?.id ?? 'unknown',
    id: node?.id ?? null,
    node,
    fallbackLabel: node ? 'label' : (key ?? ''),
  };
}

describe('copy', () => {
  it('names kinds, empty states, picker titles and add buttons', () => {
    expect(kindNoun('product')).toBe('product');
    expect(kindNoun('variant', 3)).toBe('variants');
    expect(emptyLabel('product', 'single')).toBe('No product selected');
    expect(emptyLabel('collection', 'multiple')).toBe(
      'No collections selected',
    );
    expect(pickerTitle('product', 'single')).toBe('Choose a product');
    expect(pickerTitle('product', 'multiple')).toBe('Choose products');
    expect(pickerTitle('variant', 'single')).toBe('Choose a variant');
    expect(pickerTitle('variant', 'multiple')).toBe('Choose variants');
    expect(pickerTitle('collection', 'single')).toBe('Choose a collection');
    expect(pickerTitle('collection', 'multiple')).toBe('Choose collections');
    expect(addLabel('variant')).toBe('Add variants');
    expect(loadErrorTitle('product', 1)).toBe("Couldn't load the product");
    expect(loadErrorTitle('collection', 2)).toBe(
      "Couldn't load the collections",
    );
  });

  it('describes format mismatches', () => {
    expect(isFormatMismatch(null, 'reference')).toBe(false);
    expect(isFormatMismatch('reference', 'reference')).toBe(false);
    expect(isFormatMismatch('handle', 'gid')).toBe(true);
    expect(formatMismatchMessage('handle', 'reference')).toBe(
      'Saved as a Shopify handle. This field now saves a reference document.',
    );
    expect(formatMismatchMessage('legacyProductJson', 'gid')).toBe(
      'Saved as legacy product JSON. This field now saves a Shopify ID.',
    );
  });

  it('lists drifted fields in a fixed order', () => {
    expect(listSentence([])).toBe('');
    expect(listSentence(['title'])).toBe('title');
    expect(listSentence(['title', 'price', 'image'])).toBe(
      'title, price and image',
    );
    expect(legacyDriftSummary(['price'])).toBe(
      'The saved price no longer matches Shopify.',
    );
    expect(legacyDriftSummary(['image', 'title'])).toBe(
      'The saved title and image no longer match Shopify.',
    );
  });
});

describe('limitsSummary', () => {
  it('is empty for single fields', () => {
    expect(limitsSummary(params({ cardinality: 'single' }), 1)).toEqual({
      counter: null,
      belowMin: null,
      aboveMax: null,
      atMax: false,
      atMaxReason: null,
    });
  });

  it('counts against the maximum and explains why Add is disabled', () => {
    expect(limitsSummary(params({ max: 10 }), 3).counter).toBe('3 of 10');
    const full = limitsSummary(params({ max: 3 }), 3);
    expect(full.atMax).toBe(true);
    expect(full.atMaxReason).toBe(
      'You cannot add more products, as this field holds up to 3',
    );
  });

  it('asks for the minimum while below it', () => {
    expect(limitsSummary(params({ min: 2 }), 1).belowMin).toBe(
      'Add at least 2 products',
    );
    expect(limitsSummary(params({ min: 1, kind: 'variant' }), 0).belowMin).toBe(
      'Add at least 1 variant',
    );
    expect(limitsSummary(params({ min: 2 }), 2).belowMin).toBeNull();
    expect(limitsSummary(params(), 0).counter).toBeNull();
  });

  it('counts against the minimum when the field sets no maximum', () => {
    expect(limitsSummary(params({ min: 2 }), 1).counter).toBe(
      '1 selected · at least 2',
    );
    expect(limitsSummary(params({ min: 2 }), 4).counter).toBe(
      '4 selected · at least 2',
    );
    expect(limitsSummary(params({ min: 2, max: 5 }), 4).counter).toBe('4 of 5');
  });

  it('asks to remove the extra items above the maximum', () => {
    const over = limitsSummary(params({ max: 3 }), 5);
    expect(over.counter).toBe('5 of 3');
    expect(over.aboveMax).toBe(
      'Remove 2 products, as this field holds up to 3',
    );
    expect(over.atMax).toBe(true);
    expect(
      limitsSummary(params({ max: 2, kind: 'collection' }), 3).aboveMax,
    ).toBe('Remove 1 collection, as this field holds up to 2');
    expect(limitsSummary(params({ max: 3 }), 3).aboveMax).toBeNull();
  });
});

describe('reorderUnavailableReason', () => {
  it('names the kind', () => {
    expect(reorderUnavailableReason('product')).toBe(
      'Add another product to reorder',
    );
    expect(reorderUnavailableReason('variant')).toBe(
      'Add another variant to reorder',
    );
  });
});

describe('entryFallback', () => {
  it('prefers the snapshot title and keeps the handle as identity', () => {
    const fallback = entryFallback(
      entry({
        snapshot: {
          title: 'Summer Board',
          imageUrl: 'https://cdn.shopify.com/summer.jpg',
          capturedAt: '2026-06-01T12:00:00Z',
        },
      }),
    );
    expect(fallback).toEqual({
      label: 'Summer Board',
      labelIsCode: false,
      identity: 'the-complete-snowboard',
      imageUrl: 'https://cdn.shopify.com/summer.jpg',
    });
  });

  it('uses the title and preview image saved in a 1.x value', () => {
    const fallback = entryFallback(entry(), {
      title: 'Old title',
      previewImageUrl: 'https://cdn.shopify.com/board_200x200.jpg',
      imageUrl: 'https://cdn.shopify.com/board.jpg',
    });
    expect(fallback.label).toBe('Old title');
    expect(fallback.imageUrl).toBe('https://cdn.shopify.com/board_200x200.jpg');
  });

  it('falls back to the handle, then the GID, in monospace', () => {
    expect(entryFallback(entry())).toMatchObject({
      label: 'the-complete-snowboard',
      labelIsCode: true,
      identity: PRODUCT_ID,
    });
    expect(entryFallback(entry({ handle: null }))).toMatchObject({
      label: PRODUCT_ID,
      labelIsCode: true,
      identity: null,
    });
  });

  it('names variants by their GID, since their handle is the product’s', () => {
    expect(
      entryFallback(
        entry({
          key: VARIANT_ID,
          kind: 'variant',
          id: VARIANT_ID,
          productId: PRODUCT_ID,
        }),
      ),
    ).toMatchObject({ label: VARIANT_ID, identity: 'the-complete-snowboard' });
  });
});

describe('buildRowModel', () => {
  const options = {
    status: 'ready' as const,
    shopDomain: SHOP,
    checkHandleDrift: true,
  };

  it('resolves rows with links and no drift', () => {
    const row = buildRowModel(entry(), {
      ...options,
      nodes: new Map([[PRODUCT_ID, product()]]),
    });
    expect(row.state).toBe('resolved');
    expect(row.handleDrift).toBeNull();
    expect(row.adminUrl).toBe(
      'https://admin.shopify.com/store/datocms-demo/products/10080752009562',
    );
    expect(row.storefrontUrl).toBeNull();
  });

  it('compares handles with the primary-language nodes when given', () => {
    // Loaded in Italian: Shopify answers with the translated handle.
    const nodes = new Map([
      [PRODUCT_ID, product({ handle: 'lo-snowboard-completo' })],
    ]);
    const unchanged = buildRowModel(entry(), {
      ...options,
      nodes,
      handleNodes: new Map([[PRODUCT_ID, product()]]),
    });
    expect(unchanged.handleDrift).toBeNull();
    const renamed = buildRowModel(entry(), {
      ...options,
      nodes,
      handleNodes: new Map([[PRODUCT_ID, product({ handle: 'renamed' })]]),
    });
    expect(renamed.handleDrift).toBe('renamed');
    // Not loaded yet, or not visible without a market: no drift.
    expect(
      buildRowModel(entry(), { ...options, nodes, handleNodes: new Map() })
        .handleDrift,
    ).toBeNull();
  });

  it('links entries saved as a handle to an admin search', () => {
    const handleEntry = entry({
      key: 'handle:retired-board',
      id: null,
      handle: 'retired-board',
    });
    const row = buildRowModel(handleEntry, {
      ...options,
      nodes: new Map([['handle:retired-board', null]]),
    });
    expect(row.adminUrl).toBeNull();
    expect(row.adminSearchUrl).toBe(
      'https://admin.shopify.com/store/datocms-demo/products?query=retired-board',
    );
    expect(adminSearchUrl(SHOP, { ...handleEntry, kind: 'collection' })).toBe(
      'https://admin.shopify.com/store/datocms-demo/collections?query=retired-board',
    );
    expect(adminSearchUrl(SHOP, entry())).toBeNull();
    expect(adminSearchUrl('acme.example.com', handleEntry)).toBeNull();
  });

  it('reports a changed handle unless drift checks are off', () => {
    const nodes = new Map([[PRODUCT_ID, product({ handle: 'new-handle' })]]);
    expect(buildRowModel(entry(), { ...options, nodes }).handleDrift).toBe(
      'new-handle',
    );
    expect(
      buildRowModel(entry(), { ...options, nodes, checkHandleDrift: false })
        .handleDrift,
    ).toBeNull();
  });

  it('marks null nodes unresolved and keeps an admin link from the saved ID', () => {
    const row = buildRowModel(entry(), {
      ...options,
      nodes: new Map([[PRODUCT_ID, null]]),
    });
    expect(row.state).toBe('unresolved');
    expect(row.node).toBeNull();
    expect(row.adminUrl).toContain('/products/10080752009562');
  });

  it('is pending while loading and unknown after an error', () => {
    const nodes = new Map<string, ShopifyNode | null>();
    expect(
      buildRowModel(entry(), { ...options, nodes, status: 'loading' }).state,
    ).toBe('pending');
    expect(
      buildRowModel(entry(), { ...options, nodes, status: 'error' }).state,
    ).toBe('unknown');
  });

  it('detects the first load', () => {
    const pending = buildRowModel(entry(), {
      ...options,
      nodes: new Map(),
      status: 'loading',
    });
    expect(isFirstLoad([pending])).toBe(true);
    expect(isFirstLoad([])).toBe(false);
  });
});

describe('rowMeta', () => {
  it('shows vendor and SKU for variants, whose title has the options', () => {
    expect(rowMeta(variant())).toBe('Snowboard Vendor · SKU BOARD-ICE');
    expect(rowMeta(variant({ sku: null }))).toBe('Snowboard Vendor');
    expect(rowMeta(product())).toBe('Snowboard Vendor · snowboard');
    expect(rowMeta(collection())).toBe(collection().handle);
  });
});

describe('ordering', () => {
  it('arranges entries by keys and rejects mismatched sets', () => {
    const a = entry();
    const b = entry({ key: PRODUCT_2_ID, id: PRODUCT_2_ID });
    expect(arrangeByKeys([a, b], [PRODUCT_2_ID, PRODUCT_ID])).toEqual([b, a]);
    expect(arrangeByKeys([a, b], null)).toBeNull();
    expect(arrangeByKeys([a, b], [PRODUCT_ID])).toBeNull();
    expect(arrangeByKeys([a, b], [PRODUCT_ID, 'other'])).toBeNull();
  });

  it('ignores order in the membership signature', () => {
    const a = entry();
    const b = entry({ key: PRODUCT_2_ID, id: PRODUCT_2_ID });
    expect(membershipSignature([a, b])).toBe(membershipSignature([b, a]));
  });
});

describe('picker round trip', () => {
  it('passes hydrated nodes and fallback labels to the picker', () => {
    const rows = [
      buildRowModel(entry(), {
        nodes: new Map([[PRODUCT_ID, product()]]),
        status: 'ready',
        shopDomain: SHOP,
        checkHandleDrift: true,
      }),
      buildRowModel(entry({ key: 'handle:gone', id: null, handle: 'gone' }), {
        nodes: new Map([['handle:gone', null]]),
        status: 'ready',
        shopDomain: SHOP,
        checkHandleDrift: true,
      }),
    ];
    expect(toPickerSelected(rows)).toEqual([
      {
        key: PRODUCT_ID,
        id: PRODUCT_ID,
        node: product(),
        fallbackLabel: 'the-complete-snowboard',
      },
      { key: 'handle:gone', id: null, node: null, fallbackLabel: 'gone' },
    ]);
  });

  it('reads the picker result and ignores cancel and junk', () => {
    expect(readPickerResult(null)).toBeNull();
    expect(readPickerResult(undefined)).toBeNull();
    expect(readPickerResult({ selected: 'nope' })).toBeNull();
    const result = readPickerResult({
      selected: [selected(product()), { key: 1 }, selected(null, 'handle:x')],
      context: { country: 'IT', language: 'IT' },
    });
    expect(result?.selected).toHaveLength(2);
    expect(result?.context).toEqual({ country: 'IT', language: 'IT' });
  });

  it('builds entries from nodes and keeps unresolved ones as saved', () => {
    const unresolved = entry({
      key: 'gid://shopify/Product/1',
      id: 'gid://shopify/Product/1',
      handle: 'retired',
    });
    const entries = entriesFromSelection(
      [selected(null, unresolved.key), selected(product())],
      [unresolved],
      { kind: 'product', snapshot: false, capturedAt: '2026-10-03T12:00:00Z' },
    );
    expect(entries).toEqual([
      unresolved,
      {
        key: PRODUCT_ID,
        kind: 'product',
        id: PRODUCT_ID,
        handle: 'the-complete-snowboard',
      },
    ]);
  });

  it('keeps the snapshot of items that were already selected', () => {
    const snapshot = {
      title: 'Original',
      capturedAt: '2026-01-01T00:00:00Z',
    };
    const [kept, added] = entriesFromSelection(
      [selected(product()), selected(product({ id: PRODUCT_2_ID }))],
      [entry({ snapshot })],
      { kind: 'product', snapshot: true, capturedAt: '2026-10-03T12:00:00Z' },
    );
    expect(kept?.snapshot).toEqual(snapshot);
    expect(added?.snapshot?.capturedAt).toBe('2026-10-03T12:00:00Z');
  });

  it('keeps what was saved for items already in the field, whatever the snapshot setting', () => {
    const snapshot = { title: 'Summer Board', capturedAt: '2026-06-01' };
    const drifted = entry({ handle: 'old-handle', snapshot });
    const [kept, added] = entriesFromSelection(
      [selected(product()), selected(product({ id: PRODUCT_2_ID }))],
      [drifted],
      { kind: 'product', snapshot: false, capturedAt: 'x' },
    );
    // Only "Update" changes a saved handle; a new pick has no snapshot.
    expect(kept).toEqual(drifted);
    expect(added?.snapshot).toBeUndefined();
  });

  it('fills in what an item saved as an ID lacks', () => {
    const [kept] = entriesFromSelection(
      [selected(product())],
      [entry({ handle: null })],
      { kind: 'product', snapshot: false, capturedAt: 'x' },
    );
    expect(kept?.handle).toBe('the-complete-snowboard');
  });

  it('finds the items that are new to the field', () => {
    const second = product({ id: PRODUCT_2_ID });
    expect(
      newlyPickedNodes(
        [selected(product()), selected(second), selected(null, 'handle:x')],
        [entry()],
      ),
    ).toEqual([second]);
  });

  it('swaps in the handles a context-free frontend sees', () => {
    const italian = product({ handle: 'lo-snowboard-completo' });
    const italianVariant = variant({
      product: { ...variant().product, handle: 'lo-snowboard-completo' },
    });
    const primary = new Map<string, ShopifyNode | null>([
      [PRODUCT_ID, product()],
      [VARIANT_ID, variant()],
      [PRODUCT_2_ID, null],
    ]);
    expect(withPrimaryHandle(italian, primary)).toEqual(product());
    expect(withPrimaryHandle(italianVariant, primary)).toEqual(variant());
    // Not visible without a market: the handle it came with.
    const hidden = product({ id: PRODUCT_2_ID, handle: 'nascosto' });
    expect(withPrimaryHandle(hidden, primary)).toBe(hidden);
    expect(
      selectionWithPrimaryHandles(
        [selected(italian), selected(null, 'handle:x')],
        primary,
      ).map((item) => item.node),
    ).toEqual([product(), null]);
  });

  it('drops nodes of another kind and duplicates', () => {
    const entries = entriesFromSelection(
      [selected(product()), selected(collection()), selected(product())],
      [],
      { kind: 'product', snapshot: false, capturedAt: 'x' },
    );
    expect(entries).toHaveLength(1);
  });

  it('collects the returned nodes by ID, and by handle for handle values', () => {
    const nodes = nodesFromSelection([
      selected(product()),
      selected(collection()),
      selected(variant()),
      selected(null, 'x'),
    ]);
    expect([...nodes.keys()]).toEqual([
      PRODUCT_ID,
      'handle:the-complete-snowboard',
      COLLECTION_ID,
      'handle:hydrogen',
      VARIANT_ID,
    ]);
    // A variant's handle is its product's: it never stands for the variant.
    expect(nodes.get('handle:the-complete-snowboard')?.__typename).toBe(
      'Product',
    );
  });
});

describe('editing entries', () => {
  const a = entry();
  const b = entry({ key: PRODUCT_2_ID, id: PRODUCT_2_ID, handle: 'b' });

  it('replaces in place and refuses duplicates', () => {
    const c = entry({
      key: 'gid://shopify/Product/3',
      id: 'gid://shopify/Product/3',
    });
    expect(replaceEntryAt([a, b], 1, c)).toEqual({ ok: true, entries: [a, c] });
    expect(replaceEntryAt([a, b], 1, a)).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    expect(replaceEntryAt([a, b], 0, a)).toEqual({ ok: true, entries: [a, b] });
    expect(replaceEntryAt([a], 4, c)).toEqual({
      ok: false,
      reason: 'out-of-range',
    });
  });

  it('updates one handle', () => {
    expect(withEntryHandle([a, b], PRODUCT_2_ID, 'new')).toEqual([
      a,
      { ...b, handle: 'new' },
    ]);
  });

  it('rebuilds entries from live nodes, or null when one is missing', () => {
    const nodes = new Map<string, ShopifyNode | null>([
      [PRODUCT_ID, product({ handle: 'renamed' })],
      [PRODUCT_2_ID, null],
    ]);
    expect(
      entriesFromNodes([a], nodes, { snapshot: false, capturedAt: 'x' }),
    ).toEqual([{ ...a, handle: 'renamed' }]);
    expect(
      entriesFromNodes([a, b], nodes, { snapshot: false, capturedAt: 'x' }),
    ).toBeNull();
  });
});

describe('convertProblem', () => {
  const resolved = buildRowModel(entry(), {
    nodes: new Map([[PRODUCT_ID, product()]]),
    status: 'ready',
    shopDomain: SHOP,
    checkHandleDrift: true,
  });
  const unresolved = buildRowModel(entry(), {
    nodes: new Map([[PRODUCT_ID, null]]),
    status: 'ready',
    shopDomain: SHOP,
    checkHandleDrift: true,
  });
  const pending = buildRowModel(entry(), {
    nodes: new Map(),
    status: 'loading',
    shopDomain: SHOP,
    checkHandleDrift: true,
  });
  const single = params({ cardinality: 'single', format: 'gid' });

  it('allows converting resolved entries', () => {
    expect(convertProblem(single, [resolved])).toBeNull();
  });

  it('explains structural limits, unresolved entries and loading', () => {
    const other = buildRowModel(
      entry({ key: PRODUCT_2_ID, id: PRODUCT_2_ID }),
      {
        nodes: new Map([[PRODUCT_2_ID, product({ id: PRODUCT_2_ID })]]),
        status: 'ready',
        shopDomain: SHOP,
        checkHandleDrift: true,
      },
    );
    expect(convertProblem(single, [resolved, other])).toBe(
      'This field holds one product, but the value has 2.',
    );
    expect(convertProblem(single, [unresolved])).toBe(
      "You cannot convert the value while a product isn't visible to the storefront",
    );
    expect(convertProblem(single, [pending])).toBe(
      'You cannot convert the value until the Shopify data has loaded',
    );
  });
});

describe('serializeEntries', () => {
  const target: WriteTarget = {
    fieldType: 'json',
    format: 'reference',
    kind: 'product',
    shop: SHOP,
    cardinality: 'multiple',
    snapshot: false,
  };
  const noLegacy = vi.fn();

  it('returns null for no entries', async () => {
    await expect(serializeEntries(target, [], noLegacy)).resolves.toBeNull();
  });

  it('writes a reference document', async () => {
    const value = await serializeEntries(target, [entry()], noLegacy);
    expect(JSON.parse(value ?? '')).toEqual({
      version: 1,
      shop: SHOP,
      kind: 'product',
      references: [{ id: PRODUCT_ID, handle: 'the-complete-snowboard' }],
    });
    expect(noLegacy).not.toHaveBeenCalled();
  });

  it('writes handles and GIDs as plain strings', async () => {
    const stringTarget = {
      ...target,
      fieldType: 'string' as const,
      cardinality: 'single' as const,
    };
    await expect(
      serializeEntries(
        { ...stringTarget, format: 'handle' },
        [entry()],
        noLegacy,
      ),
    ).resolves.toBe('the-complete-snowboard');
    await expect(
      serializeEntries({ ...stringTarget, format: 'gid' }, [entry()], noLegacy),
    ).resolves.toBe(PRODUCT_ID);
  });

  it('rebuilds 1.x JSON from fresh data', async () => {
    const load = vi.fn().mockResolvedValue(LEGACY_NODE);
    const value = await serializeEntries(
      { ...target, format: 'legacyProductJson', cardinality: 'single' },
      [entry()],
      load,
    );
    expect(load).toHaveBeenCalledWith({
      id: PRODUCT_ID,
      handle: 'the-complete-snowboard',
    });
    expect(value).toBe(
      serializeLegacyProductJson(buildLegacyProductJson(LEGACY_NODE)),
    );
  });

  it('throws when Shopify has no 1.x data for the product', async () => {
    await expect(
      serializeEntries(
        { ...target, format: 'legacyProductJson', cardinality: 'single' },
        [entry()],
        vi.fn().mockResolvedValue(null),
      ),
    ).rejects.toBeInstanceOf(StoredValueBuildError);
  });
});

describe('invalid values', () => {
  it('shows strings as saved and other values as JSON', () => {
    expect(rawValueText('{"broken"')).toBe('{"broken"');
    expect(rawValueText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(rawValueText(42)).toBe('42');
  });

  it('previews long values by length and by lines', () => {
    expect(previewText('short')).toEqual({ text: 'short', truncated: false });
    const long = 'x'.repeat(300);
    expect(previewText(long).truncated).toBe(true);
    expect(previewText(long).text).toHaveLength(241);
    const tall = Array.from({ length: 10 }, (_, line) => `line ${line}`).join(
      '\n',
    );
    const preview = previewText(tall);
    expect(preview.truncated).toBe(true);
    expect(preview.text.split('\n')).toHaveLength(6);
  });

  it('reads the shop of a saved document', () => {
    expect(storedDocumentShop('{"shop":"acme.myshopify.com"}')).toBe(
      'acme.myshopify.com',
    );
    expect(storedDocumentShop({ shop: 'acme.myshopify.com' })).toBe(
      'acme.myshopify.com',
    );
    expect(storedDocumentShop('{nope')).toBeNull();
    expect(storedDocumentShop('{}')).toBeNull();
  });
});

describe('pluginSettingsPath', () => {
  it('adds the sandbox environment prefix', () => {
    expect(
      pluginSettingsPath({
        pluginId: '42',
        environment: 'main',
        isEnvironmentPrimary: true,
      }),
    ).toBe('/configuration/plugins/42/edit');
    expect(
      pluginSettingsPath({
        pluginId: '42',
        environment: 'feature-x',
        isEnvironmentPrimary: false,
      }),
    ).toBe('/environments/feature-x/configuration/plugins/42/edit');
  });
});

describe('hydrateEntries', () => {
  function client(nodes: Record<string, ShopifyNode | null>) {
    return {
      loadNodes: vi.fn(async (ids: string[]) =>
        ids.map((id) => nodes[id] ?? null),
      ),
      productByHandle: vi.fn(async (handle: string) =>
        handle === 'the-complete-snowboard' ? product() : null,
      ),
      collectionByHandle: vi.fn(async (handle: string) =>
        handle === 'hydrogen' ? collection() : null,
      ),
    };
  }

  it('loads every ID in one call and handles by handle', async () => {
    const fake = client({ [PRODUCT_2_ID]: product({ id: PRODUCT_2_ID }) });
    const found = await hydrateEntries(
      fake,
      [
        entry({ key: PRODUCT_2_ID, id: PRODUCT_2_ID }),
        entry({
          key: 'gid://shopify/Product/1',
          id: 'gid://shopify/Product/1',
        }),
        entry({ key: 'handle:the-complete-snowboard', id: null }),
        entry({
          key: 'handle:hydrogen',
          kind: 'collection',
          id: null,
          handle: 'hydrogen',
        }),
      ],
      { handleFallback: false },
    );
    expect(fake.loadNodes).toHaveBeenCalledOnce();
    expect(fake.loadNodes.mock.calls[0]?.[0]).toEqual([
      PRODUCT_2_ID,
      'gid://shopify/Product/1',
    ]);
    expect(found.get(PRODUCT_2_ID)?.id).toBe(PRODUCT_2_ID);
    expect(found.get('gid://shopify/Product/1')).toBeNull();
    expect(found.get('handle:the-complete-snowboard')?.id).toBe(PRODUCT_ID);
    expect(found.get('handle:hydrogen')?.id).toBe(COLLECTION_ID);
    expect(fake.productByHandle).toHaveBeenCalledOnce();
  });

  it('falls back to the handle for 1.x JSON when the ID resolves to nothing', async () => {
    const fake = client({});
    const found = await hydrateEntries(fake, [entry()], {
      handleFallback: true,
    });
    expect(fake.productByHandle).toHaveBeenCalledWith(
      'the-complete-snowboard',
      {
        signal: undefined,
      },
    );
    expect(found.get(PRODUCT_ID)?.id).toBe(PRODUCT_ID);
  });

  it('never looks variants up by handle', async () => {
    const fake = client({});
    const found = await hydrateEntries(
      fake,
      [entry({ key: VARIANT_ID, kind: 'variant', id: VARIANT_ID })],
      { handleFallback: true },
    );
    expect(fake.productByHandle).not.toHaveBeenCalled();
    expect(found.get(VARIANT_ID)).toBeNull();
  });
});

describe('editor feedback', () => {
  it('escapes text for toasts', () => {
    expect(escapeHtml('Tee <XL> & Co')).toBe('Tee &lt;XL&gt; &amp; Co');
  });

  it('describes unresolved entries, leading with a renamed handle', () => {
    expect(unresolvedMessage(entry())).toBe(UNRESOLVED_MESSAGE);
    expect(
      unresolvedMessage(entry({ key: 'handle:x', id: null, handle: 'x' })),
    ).toBe(
      'No product with this handle is visible to the storefront: the handle may have changed in Shopify, or the product may be unpublished from the Headless channel, archived, or deleted.',
    );
  });

  it("doesn't say collections may be archived, which only products can be", () => {
    expect(
      unresolvedMessage(
        entry({ key: COLLECTION_ID, id: COLLECTION_ID, kind: 'collection' }),
      ),
    ).toBe(UNRESOLVED_COLLECTION_MESSAGE);
    expect(UNRESOLVED_COLLECTION_MESSAGE).toBe(
      'Not visible to the storefront: it may be unpublished from the Headless channel, or deleted.',
    );
    expect(
      unresolvedMessage(
        entry({ key: 'handle:x', id: null, handle: 'x', kind: 'collection' }),
      ),
    ).toBe(
      'No collection with this handle is visible to the storefront: the handle may have changed in Shopify, or the collection may be unpublished from the Headless channel, or deleted.',
    );
    expect(notVisibleMessage('variant')).toBe(UNRESOLVED_MESSAGE);
    expect(notVisibleMessage('collection')).toBe(UNRESOLVED_COLLECTION_MESSAGE);
  });

  it('titles invalid values briefly', () => {
    expect(invalidValueTitle('invalid-json')).toBe(
      "Couldn't read the saved value",
    );
    expect(invalidValueTitle('shop-mismatch')).toBe(
      'Saved for another Shopify store',
    );
  });

  it('sends connection problems to the settings, or to an administrator', () => {
    const rejected = new ShopifyClientError('unauthorized', 'HTTP 401');
    const offline = new ShopifyClientError('network', 'Failed to fetch');
    expect(isConnectionProblem(rejected)).toBe(true);
    expect(isConnectionProblem(offline)).toBe(false);
    expect(loadErrorMessage(rejected, true)).toBe(
      'Shopify rejected the Storefront access token. Update it in the plugin settings.',
    );
    expect(loadErrorMessage(rejected, false)).toBe(
      'Shopify rejected the Storefront access token. Ask an administrator to check the Shopify connection.',
    );
    expect(
      loadErrorMessage(
        new ShopifyClientError('shop-not-found', 'HTTP 404', {
          shop: 'acme.myshopify.com',
        }),
        false,
      ),
    ).toBe(
      'No Shopify store found at acme.myshopify.com. Ask an administrator to check the Shopify connection.',
    );
    expect(loadErrorMessage(offline, false)).toBe(
      "Couldn't reach Shopify. Check your connection or ad-blocker.",
    );
  });

  it('says what a pick changed', () => {
    expect(selectionChangeMessage('product', 2, 0)).toBe('Added 2 products');
    expect(selectionChangeMessage('variant', 0, 1)).toBe('Removed 1 variant');
    expect(selectionChangeMessage('collection', 1, 2)).toBe(
      'Added 1 collection and removed 2 collections',
    );
    expect(selectionChangeMessage('product', 0, 0)).toBeNull();
    const a = entry();
    const b = entry({ key: PRODUCT_2_ID, id: PRODUCT_2_ID });
    expect(countKept([b], [a, b])).toBe(1);
  });
});
