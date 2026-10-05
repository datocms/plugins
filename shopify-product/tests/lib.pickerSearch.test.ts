import { describe, expect, it } from 'vitest';
import {
  applicableFilters,
  canSearchSkus,
  collectionClientCheck,
  collectionControls,
  contextLabel,
  dedupeSelection,
  EMPTY_FILTERS,
  effectiveSearch,
  entryForNode,
  entryMatchesNode,
  filterableOptions,
  filterVariantsByOptions,
  hasActiveFilters,
  hasClientCheck,
  hydrateEntries,
  isNodeSelected,
  isNodeUnavailable,
  isSkuCandidate,
  languageFallbackNotice,
  languageOptionLabel,
  matchesClientCheck,
  matchesFilterValue,
  maxReachedMessage,
  pickerLabels,
  readPickerParameters,
  removeEntry,
  selectedVariantsOf,
  selectionCountLabel,
  selectNode,
  skuMatchesSearch,
  soldOutReason,
  sortedCountries,
  tagsLabel,
  textMatchesProduct,
  toggleNode,
  variantDisabledReason,
} from '../src/lib/pickerSearch';
import type { CollectionFilterSupport } from '../src/lib/queryString';
import type {
  CollectionSummary,
  LocalizationInfo,
  PickerSelectedEntry,
  ProductSummary,
  VariantSummary,
} from '../src/types';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    __typename: 'Product',
    id: 'gid://shopify/Product/1',
    handle: 'the-complete-snowboard',
    title: 'The Complete Snowboard',
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
    variantsCount: { count: 5 },
    sku: null,
    ...overrides,
  };
}

function variant(
  id: string,
  options: Array<{ name: string; value: string }>,
  productId = 'gid://shopify/Product/1',
): VariantSummary {
  return {
    __typename: 'ProductVariant',
    id,
    title: options.map((option) => option.value).join(' / '),
    sku: null,
    barcode: null,
    availableForSale: true,
    currentlyNotInStock: false,
    selectedOptions: options,
    price: { amount: '10.0', currencyCode: 'EUR' },
    compareAtPrice: null,
    image: null,
    product: {
      id: productId,
      handle: 'the-complete-snowboard',
      title: 'The Complete Snowboard',
      vendor: 'Snowboard Vendor',
      onlineStoreUrl: null,
      featuredImage: null,
    },
  };
}

const collection: CollectionSummary = {
  __typename: 'Collection',
  id: 'gid://shopify/Collection/9',
  handle: 'hydrogen',
  title: 'Hydrogen',
  updatedAt: '2026-07-18T23:38:42Z',
  onlineStoreUrl: null,
  image: null,
};

function unresolved(key: string, id: string | null = key): PickerSelectedEntry {
  return { key, id, node: null, fallbackLabel: key };
}

const support = (
  overrides: Partial<CollectionFilterSupport> = {},
): CollectionFilterSupport => ({
  availability: true,
  productType: false,
  vendor: false,
  tag: false,
  price: true,
  ...overrides,
});

const validParameters = {
  fieldParameters: {
    paramsVersion: '1',
    kind: 'variant',
    cardinality: 'multiple',
    format: 'reference',
    snapshot: false,
    max: 3,
  },
  fieldType: 'json',
  shopDomain: 'https://admin.shopify.com/store/acme/products',
  selected: [
    {
      key: 'gid://shopify/ProductVariant/7',
      id: 'gid://shopify/ProductVariant/7',
      node: null,
      fallbackLabel: 'Classic Tee — Black / M',
    },
  ],
  context: { country: 'us', language: 'en' },
};

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

describe('readPickerParameters', () => {
  it('reads a valid contract and normalizes the shop and context', () => {
    const params = readPickerParameters(validParameters);
    expect(params).toEqual({
      fieldParameters: {
        paramsVersion: '1',
        kind: 'variant',
        cardinality: 'multiple',
        format: 'reference',
        snapshot: false,
        max: 3,
      },
      fieldType: 'json',
      shopDomain: 'acme.myshopify.com',
      selected: validParameters.selected,
      context: { country: 'US', language: 'EN' },
    });
  });

  it('drops an empty context and accepts a missing selection', () => {
    const params = readPickerParameters({
      ...validParameters,
      selected: undefined,
      context: {},
    });
    expect(params?.selected).toEqual([]);
    expect(params && 'context' in params).toBe(false);
  });

  it('keeps entries whose node does not parse, as unresolved', () => {
    const params = readPickerParameters({
      ...validParameters,
      selected: [{ key: 'k', id: null, node: { nope: true } }],
    });
    expect(params?.selected).toEqual([
      { key: 'k', id: null, node: null, fallbackLabel: 'k' },
    ]);
  });

  it('dedupes selected entries by canonical GID', () => {
    const params = readPickerParameters({
      ...validParameters,
      selected: [
        unresolved('gid://shopify/Product/0012'),
        unresolved('again', 'gid://shopify/Product/12'),
      ],
    });
    expect(params?.selected.map((entry) => entry.key)).toEqual([
      'gid://shopify/Product/0012',
    ]);
  });

  it.each([
    ['not an object', 'nope'],
    ['an unknown field type', { ...validParameters, fieldType: 'text' }],
    ['a custom domain', { ...validParameters, shopDomain: 'www.acme.com' }],
    ['a missing shop', { ...validParameters, shopDomain: undefined }],
    ['a selection that is not a list', { ...validParameters, selected: {} }],
    [
      'an entry without a key',
      { ...validParameters, selected: [{ id: 'gid://shopify/Product/1' }] },
    ],
    [
      'field parameters that are not an object',
      { ...validParameters, fieldParameters: 'x' },
    ],
  ])('rejects %s', (_label, raw) => {
    expect(readPickerParameters(raw)).toBeNull();
  });

  it("reads the field's other items, skipping malformed ones", () => {
    const params = readPickerParameters({
      ...validParameters,
      unavailable: [
        {
          key: 'gid://shopify/ProductVariant/8',
          id: 'gid://shopify/ProductVariant/8',
        },
        { key: 'handle:old-tee', id: null },
        { key: 'no-id' },
        { key: 3, id: 'gid://shopify/ProductVariant/9' },
        { key: 'bad-id', id: 9 },
        'nope',
      ],
    });
    expect(params?.unavailable).toEqual([
      {
        key: 'gid://shopify/ProductVariant/8',
        id: 'gid://shopify/ProductVariant/8',
      },
      { key: 'handle:old-tee', id: null },
    ]);
    // Absent, empty or not a list: no key at all.
    expect(readPickerParameters(validParameters)).not.toHaveProperty(
      'unavailable',
    );
    expect(
      readPickerParameters({ ...validParameters, unavailable: {} }),
    ).not.toHaveProperty('unavailable');
  });

  it('coerces invalid field parameters to the legacy defaults', () => {
    const params = readPickerParameters({
      ...validParameters,
      fieldType: 'string',
      fieldParameters: { paramsVersion: '1', kind: 'nope', format: 'nope' },
    });
    expect(params?.fieldParameters).toMatchObject({
      kind: 'product',
      format: 'handle',
      cardinality: 'single',
    });
  });
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

describe('copy helpers', () => {
  it('labels each kind', () => {
    expect(pickerLabels('product').placeholder).toBe(
      'Search products, or paste a SKU or barcode…',
    );
    expect(pickerLabels('collection').placeholder).toBe('Search collections…');
    expect(pickerLabels('variant').many).toBe('variants');
  });

  it('names results apart from what gets selected', () => {
    // A variant picker browses products and opens them.
    expect(pickerLabels('variant').resultMany).toBe('products');
    expect(pickerLabels('variant').resultOne).toBe('product');
    expect(pickerLabels('product').resultMany).toBe('products');
    expect(pickerLabels('collection').resultMany).toBe('collections');
  });

  it('explains single variant picks, including direct ones', () => {
    expect(pickerLabels('variant').singleHint).toBe(
      'Click a variant to choose it. A product with several variants opens to show them.',
    );
  });

  it('counts the selection', () => {
    expect(selectionCountLabel(3)).toBe('3 selected');
    expect(selectionCountLabel(3, 5)).toBe('3 of 5 selected');
    expect(selectionCountLabel(1, Number.POSITIVE_INFINITY)).toBe('1 selected');
  });

  it('explains the limit', () => {
    expect(maxReachedMessage(5, 'product')).toBe(
      'You can select up to 5 products',
    );
    expect(maxReachedMessage(1, 'collection')).toBe(
      'You can select up to 1 collection',
    );
  });

  it('joins tags with "or"', () => {
    expect(tagsLabel([])).toBe('');
    expect(tagsLabel(['A'])).toBe('A');
    expect(tagsLabel(['A', 'B'])).toBe('A or B');
    expect(tagsLabel(['A', 'B', 'C'])).toBe('A, B or C');
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe('isSkuCandidate', () => {
  it.each([
    ['sku-managed-1', true],
    ['  abc  ', true],
    ['ab', false],
    ['two words', false],
    ['', false],
  ])('%j → %s', (text, expected) => {
    expect(isSkuCandidate(text)).toBe(expected);
  });
});

describe('effectiveSearch', () => {
  it('uses the editor filters without a scope', () => {
    expect(
      effectiveSearch(undefined, {
        ...EMPTY_FILTERS,
        collection: { id: 'gid://shopify/Collection/1', title: 'C' },
        productType: 'snowboard',
        vendor: '  Hydrogen ',
        tags: ['Sport'],
        availableOnly: true,
      }),
    ).toEqual({
      collectionId: 'gid://shopify/Collection/1',
      productType: 'snowboard',
      vendor: 'Hydrogen',
      tags: ['Sport'],
      availableOnly: true,
    });
  });

  it('lets a locked scope win and only narrows locked tags', () => {
    const scope = {
      collectionId: 'gid://shopify/Collection/2',
      productType: 'giftcard',
      vendor: 'Locked Vendor',
      tags: ['Premium', 'Snow'],
      availableOnly: true,
    };
    const result = effectiveSearch(scope, {
      ...EMPTY_FILTERS,
      collection: { id: 'gid://shopify/Collection/1', title: 'C' },
      productType: 'snowboard',
      vendor: 'Other',
      tags: ['snow', 'Winter'],
    });
    expect(result).toEqual({
      collectionId: 'gid://shopify/Collection/2',
      productType: 'giftcard',
      vendor: 'Locked Vendor',
      tags: ['Snow'],
      availableOnly: true,
    });
    expect(effectiveSearch(scope, EMPTY_FILTERS).tags).toEqual([
      'Premium',
      'Snow',
    ]);
  });

  it('reports active filters (sorting does not count)', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, sort: 'newest' })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, vendor: ' ' })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, vendor: 'x' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, tags: ['x'] })).toBe(true);
  });
});

describe('client-side checks', () => {
  it('matches vendors and product types like Shopify (whole words)', () => {
    expect(matchesFilterValue('Hydrogen Vendor', 'hydrogen')).toBe(true);
    expect(matchesFilterValue('Hydrogen Vendor', 'Hydrogen Vendor')).toBe(true);
    expect(matchesFilterValue('Hydrogen Vendor', 'Hydro')).toBe(false);
    expect(matchesFilterValue('Snowboard Vendor', 'Hydrogen')).toBe(false);
    expect(matchesFilterValue('anything', '  ')).toBe(true);
  });

  it('matches free text by word prefix on what a card shows', () => {
    const board = product();
    expect(textMatchesProduct(board, 'compl snow')).toBe(true);
    expect(textMatchesProduct(board, 'SNOWBOARD vendor')).toBe(true);
    expect(textMatchesProduct(board, 'board')).toBe(false);
    expect(textMatchesProduct(board, 'complete-snow')).toBe(true);
    expect(textMatchesProduct(board, '')).toBe(true);
  });

  it('combines the checks', () => {
    const soldOut = product({ availableForSale: false });
    const check = {
      text: null,
      productType: null,
      vendor: 'Snowboard Vendor',
      availableOnly: true,
    };
    expect(hasClientCheck(check)).toBe(true);
    expect(matchesClientCheck(product(), check)).toBe(true);
    expect(matchesClientCheck(soldOut, check)).toBe(false);
    expect(
      matchesClientCheck(product({ productType: 'giftcard' }), {
        ...check,
        productType: 'snowboard',
      }),
    ).toBe(false);
    expect(
      hasClientCheck({
        text: null,
        productType: null,
        vendor: null,
        availableOnly: false,
      }),
    ).toBe(false);
  });

  it('enforces only the locked filters the collection cannot apply', () => {
    const scope = {
      collectionId: 'gid://shopify/Collection/1',
      productType: 'snowboard',
      vendor: 'Hydrogen Vendor',
      availableOnly: true,
    };
    expect(collectionClientCheck(scope, support(), ' snow ')).toEqual({
      text: 'snow',
      productType: 'snowboard',
      vendor: 'Hydrogen Vendor',
      availableOnly: false,
    });
    expect(
      collectionClientCheck(
        scope,
        support({ productType: true, vendor: true, availability: false }),
        '',
      ),
    ).toEqual({
      text: null,
      productType: null,
      vendor: null,
      availableOnly: true,
    });
    // Unknown support: the server filter is sent and trusted for now.
    expect(collectionClientCheck(scope, null, '')).toEqual({
      text: null,
      productType: null,
      vendor: null,
      availableOnly: false,
    });
  });

  it('disables the filters a collection does not support', () => {
    expect(collectionControls(false, support())).toEqual({
      productType: true,
      vendor: true,
      tags: true,
      availability: true,
    });
    expect(collectionControls(true, null).productType).toBe(true);
    expect(collectionControls(true, support())).toEqual({
      productType: false,
      vendor: false,
      tags: false,
      availability: true,
    });
    const filters = {
      ...EMPTY_FILTERS,
      productType: 'snowboard',
      vendor: 'V',
      tags: ['T'],
      availableOnly: true,
    };
    expect(
      applicableFilters(filters, collectionControls(true, support())),
    ).toEqual({
      ...filters,
      productType: null,
      vendor: '',
      tags: [],
    });
  });

  it('keeps SKU hits inside the scope and the editor filters', () => {
    const none = effectiveSearch(undefined, EMPTY_FILTERS);
    expect(skuMatchesSearch(product(), none)).toBe(true);
    expect(
      skuMatchesSearch(
        product(),
        effectiveSearch({ vendor: 'Hydrogen' }, EMPTY_FILTERS),
      ),
    ).toBe(false);
    expect(
      skuMatchesSearch(
        product({ availableForSale: false }),
        effectiveSearch({ availableOnly: true }, EMPTY_FILTERS),
      ),
    ).toBe(false);
    // The editor's own filters count too.
    expect(
      skuMatchesSearch(
        product({ productType: 'giftcard' }),
        effectiveSearch(undefined, {
          ...EMPTY_FILTERS,
          productType: 'snowboard',
        }),
      ),
    ).toBe(false);
    expect(
      skuMatchesSearch(
        product({ availableForSale: false }),
        effectiveSearch(undefined, { ...EMPTY_FILTERS, availableOnly: true }),
      ),
    ).toBe(false);
    expect(
      skuMatchesSearch(
        product(),
        effectiveSearch(undefined, { ...EMPTY_FILTERS, vendor: 'Snowboard' }),
      ),
    ).toBe(true);
  });

  it('skips the SKU lookup when a collection or tags apply, locked or chosen', () => {
    expect(canSearchSkus(effectiveSearch(undefined, EMPTY_FILTERS))).toBe(true);
    expect(
      canSearchSkus(effectiveSearch({ productType: 'x' }, EMPTY_FILTERS)),
    ).toBe(true);
    expect(
      canSearchSkus(
        effectiveSearch(
          { collectionId: 'gid://shopify/Collection/1' },
          EMPTY_FILTERS,
        ),
      ),
    ).toBe(false);
    expect(canSearchSkus(effectiveSearch({ tags: ['x'] }, EMPTY_FILTERS))).toBe(
      false,
    );
    expect(
      canSearchSkus(
        effectiveSearch(undefined, {
          ...EMPTY_FILTERS,
          collection: { id: 'gid://shopify/Collection/1', title: 'Hydrogen' },
        }),
      ),
    ).toBe(false);
    expect(
      canSearchSkus(
        effectiveSearch(undefined, { ...EMPTY_FILTERS, tags: ['Premium'] }),
      ),
    ).toBe(false);
  });

  it('explains why sold-out variants cannot be picked', () => {
    const none = effectiveSearch(undefined, EMPTY_FILTERS);
    const chip = effectiveSearch(undefined, {
      ...EMPTY_FILTERS,
      availableOnly: true,
    });
    const locked = effectiveSearch({ availableOnly: true }, EMPTY_FILTERS);
    expect(soldOutReason(undefined, none)).toBeNull();
    expect(soldOutReason(undefined, chip)).toBe(
      'Sold out: turn off Available for sale to choose it',
    );
    expect(soldOutReason({ availableOnly: true }, locked)).toBe(
      'Sold out: this field only allows variants available for sale',
    );

    const soldOut = {
      ...variant('gid://shopify/ProductVariant/2', []),
      availableForSale: false,
    };
    const available = variant('gid://shopify/ProductVariant/1', []);
    expect(variantDisabledReason(soldOut, 'Sold out', null)).toBe('Sold out');
    expect(variantDisabledReason(available, 'Sold out', null)).toBeNull();
    expect(variantDisabledReason(available, 'Sold out', 'Full')).toBe('Full');
    expect(variantDisabledReason(soldOut, null, 'Full')).toBe('Full');
  });
});

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

describe('markets', () => {
  const localization: LocalizationInfo = {
    country: { isoCode: 'MX' },
    language: { isoCode: 'EN' },
    availableCountries: [
      { isoCode: 'IT', name: 'Italy', currency: { isoCode: 'EUR' } },
      { isoCode: 'MX', name: 'Mexico', currency: { isoCode: 'MXN' } },
    ],
    availableLanguages: [
      { isoCode: 'EN', endonymName: 'English' },
      { isoCode: 'ES', endonymName: 'español' },
    ],
  };

  it('labels the applied market', () => {
    expect(contextLabel(localization)).toBe('MX · MXN · EN');
    expect(languageOptionLabel(localization, 'ES')).toBe('español (ES)');
    expect(languageOptionLabel(localization, 'FR')).toBe('FR');
  });

  it('explains a language fallback', () => {
    expect(languageFallbackNotice({ language: 'FR' }, { language: 'EN' })).toBe(
      "FR isn't published for this market, so Shopify answered in EN",
    );
    expect(languageFallbackNotice({ language: 'EN' }, { language: 'EN' })).toBe(
      null,
    );
    expect(languageFallbackNotice({}, { language: 'EN' })).toBe(null);
    expect(languageFallbackNotice({ language: 'FR' }, null)).toBe(null);
  });

  it('sorts countries by name in the UI locale', () => {
    const countries: LocalizationInfo['availableCountries'] = [
      {
        isoCode: 'AE',
        name: 'United Arab Emirates',
        currency: { isoCode: 'AED' },
      },
      { isoCode: 'AU', name: 'Australia', currency: { isoCode: 'AUD' } },
      { isoCode: 'CH', name: 'Switzerland', currency: { isoCode: 'CHF' } },
      { isoCode: 'IS', name: 'Island', currency: { isoCode: 'ISK' } },
      { isoCode: 'AT', name: 'Österreich', currency: { isoCode: 'EUR' } },
    ];
    expect(sortedCountries(countries, 'en').map((c) => c.isoCode)).toEqual([
      'AU',
      'IS',
      'AT',
      'CH',
      'AE',
    ]);
    // An unknown locale falls back instead of throwing; the input is kept.
    expect(sortedCountries(countries, 'not a locale!')).toHaveLength(5);
    expect(countries[0].isoCode).toBe('AE');
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('selection', () => {
  const a = product({ id: 'gid://shopify/Product/1', handle: 'a' });
  const b = product({ id: 'gid://shopify/Product/2', handle: 'b' });
  const c = product({ id: 'gid://shopify/Product/3', handle: 'c' });

  it('builds entries from nodes', () => {
    expect(entryForNode(a)).toEqual({
      key: 'gid://shopify/Product/1',
      id: 'gid://shopify/Product/1',
      node: a,
      fallbackLabel: 'The Complete Snowboard',
    });
    const v = variant('gid://shopify/ProductVariant/9', [
      { name: 'Color', value: 'Ice' },
    ]);
    expect(entryForNode(v).fallbackLabel).toBe('The Complete Snowboard — Ice');
  });

  it('matches entries by canonical GID, node, or handle', () => {
    expect(entryMatchesNode(unresolved('gid://shopify/Product/01'), a)).toBe(
      true,
    );
    expect(
      entryMatchesNode({ ...entryForNode(a), id: null, key: 'x' }, a),
    ).toBe(true);
    expect(entryMatchesNode(unresolved('handle:A', null), a)).toBe(true);
    expect(entryMatchesNode(unresolved('handle:a', null), collection)).toBe(
      false,
    );
    expect(entryMatchesNode(unresolved('gid://shopify/Product/2'), a)).toBe(
      false,
    );
  });

  it("matches the field's other items by canonical GID or handle", () => {
    const unavailable = [
      { key: 'k', id: 'gid://shopify/Product/0001' },
      { key: 'handle:B', id: null },
    ];
    expect(isNodeUnavailable(unavailable, a)).toBe(true);
    expect(isNodeUnavailable(unavailable, b)).toBe(true);
    expect(isNodeUnavailable(unavailable, c)).toBe(false);
    expect(isNodeUnavailable([], a)).toBe(false);
  });

  it('appends, removes and respects the max (unresolved entries count)', () => {
    const start = [unresolved('gid://shopify/Product/99')];
    const added = toggleNode(start, a, 3);
    expect(added.map((entry) => entry.key)).toEqual([
      'gid://shopify/Product/99',
      'gid://shopify/Product/1',
    ]);
    const full = toggleNode(added, b, 3);
    expect(full).toHaveLength(3);
    expect(toggleNode(full, c, 3)).toEqual(full);
    expect(isNodeSelected(full, b)).toBe(true);
    expect(toggleNode(full, a, 3).map((entry) => entry.key)).toEqual([
      'gid://shopify/Product/99',
      'gid://shopify/Product/2',
    ]);
    expect(removeEntry(full, 'gid://shopify/Product/99')).toHaveLength(2);
  });

  it('adds without toggling, and hydrates the entry already standing for it', () => {
    expect(selectNode([entryForNode(a)], b, 5).map((e) => e.key)).toEqual([
      a.id,
      b.id,
    ]);
    // Already selected but unresolved: filled in, never removed or duplicated.
    const selected = selectNode([unresolved(b.id)], b, 5);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ key: b.id, node: b });
    // Already selected and resolved: unchanged.
    expect(selectNode([entryForNode(b)], b, 5)).toEqual([entryForNode(b)]);
    // At the max nothing is added.
    expect(selectNode([entryForNode(a)], c, 1)).toEqual([entryForNode(a)]);
  });

  it('dedupes keeping the first occurrence', () => {
    expect(
      dedupeSelection([
        entryForNode(a),
        unresolved('again', 'gid://shopify/Product/1'),
        entryForNode(b),
      ]).map((entry) => entry.key),
    ).toEqual(['gid://shopify/Product/1', 'gid://shopify/Product/2']);
  });

  it('hydrates unresolved entries from loaded nodes', () => {
    const entries = [unresolved('gid://shopify/Product/2'), entryForNode(a)];
    const hydrated = hydrateEntries(entries, [b, c]);
    expect(hydrated[0]).toEqual({ ...entries[0], node: b });
    expect(hydrated[1]).toBe(entries[1]);
    expect(hydrateEntries(entries, [c])).toBe(entries);
    const byHandle = hydrateEntries([unresolved('handle:b', null)], [b]);
    expect(byHandle[0]).toMatchObject({ id: b.id, node: b, key: 'handle:b' });
  });

  it('finds the selected variants of a product', () => {
    const ice = variant('gid://shopify/ProductVariant/1', [
      { name: 'Color', value: 'Ice' },
    ]);
    const other = variant(
      'gid://shopify/ProductVariant/2',
      [{ name: 'Color', value: 'Dawn' }],
      'gid://shopify/Product/2',
    );
    const entries = [entryForNode(ice), entryForNode(other), entryForNode(a)];
    expect(selectedVariantsOf(entries, 'gid://shopify/Product/1')).toEqual([
      entries[0],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

describe('variant options', () => {
  const options = [
    {
      name: 'Color',
      optionValues: [{ name: 'Black' }, { name: 'White' }],
    },
    { name: 'Material', optionValues: [{ name: 'Wood' }] },
  ];

  it('offers chips only for long lists and multi-value options', () => {
    expect(filterableOptions(options, 6)).toEqual([]);
    expect(filterableOptions(options, 7)).toEqual([options[0]]);
  });

  it('narrows variants by every chosen option', () => {
    const variants = [
      variant('v1', [
        { name: 'Color', value: 'Black' },
        { name: 'Size', value: 'M' },
      ]),
      variant('v2', [
        { name: 'Color', value: 'White' },
        { name: 'Size', value: 'M' },
      ]),
      variant('v3', [
        { name: 'Color', value: 'Black' },
        { name: 'Size', value: 'L' },
      ]),
    ];
    expect(filterVariantsByOptions(variants, {})).toHaveLength(3);
    expect(
      filterVariantsByOptions(variants, { Color: 'Black' }).map((v) => v.id),
    ).toEqual(['v1', 'v3']);
    expect(
      filterVariantsByOptions(variants, { Color: 'Black', Size: 'M' }).map(
        (v) => v.id,
      ),
    ).toEqual(['v1']);
  });
});
