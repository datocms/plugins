/**
 * Pure helpers for the picker modal: reading its parameters, combining the
 * field's locked scope with the editor's filters, the client-side checks the
 * Storefront API can't do for us, and the staged selection.
 */

import { SKU_SEARCH_MIN_LENGTH } from '../constants';
import type {
  FieldScope,
  FieldType,
  LocalizationInfo,
  PickerModalParameters,
  PickerSelectedEntry,
  PickerUnavailableEntry,
  ProductOption,
  ProductSummary,
  ShopifyContext,
  ShopifyKind,
  ShopifyNode,
  VariantSummary,
} from '../types';
import { nodeTitle } from './format';
import { isNonEmptyString, isRecord } from './guards';
import { sameShopifyHandle } from './legacy';
import { normalizeFieldParameters, normalizeShopDomain } from './parameters';
import type { CollectionFilterSupport, PickerSort } from './queryString';
import { canonicalGid, entryKey } from './references';
import { normalizeNode } from './shopifyClient';

// ---------------------------------------------------------------------------
// Modal parameters
// ---------------------------------------------------------------------------

function readFieldType(value: unknown): FieldType | null {
  return value === 'string' || value === 'json' ? value : null;
}

function readContext(value: unknown): ShopifyContext | undefined {
  if (!isRecord(value)) return undefined;
  const context: ShopifyContext = {};
  if (isNonEmptyString(value.country)) {
    context.country = value.country.trim().toUpperCase();
  }
  if (isNonEmptyString(value.language)) {
    context.language = value.language.trim().toUpperCase();
  }
  return context.country || context.language ? context : undefined;
}

/**
 * One selected entry, or null when its identity is unusable. A node that
 * doesn't parse becomes `null` (shown as "Not visible") instead of dropping
 * the entry, so applying never loses an item the editor didn't remove.
 */
function readSelectedEntry(value: unknown): PickerSelectedEntry | null {
  if (!isRecord(value) || !isNonEmptyString(value.key)) return null;
  const id = isNonEmptyString(value.id) ? value.id : null;
  const node = normalizeNode(value.node);
  const fallbackLabel = isNonEmptyString(value.fallbackLabel)
    ? value.fallbackLabel
    : (id ?? value.key);
  return { key: value.key, id, node, fallbackLabel };
}

function readSelected(value: unknown): PickerSelectedEntry[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const entries: PickerSelectedEntry[] = [];
  for (const item of value) {
    const entry = readSelectedEntry(item);
    if (!entry) return null;
    entries.push(entry);
  }
  return dedupeSelection(entries);
}

/**
 * The field's other items (Replace). Malformed entries are skipped: they only
 * lock items, so losing one never loses data.
 */
function readUnavailable(value: unknown): PickerUnavailableEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: PickerUnavailableEntry[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.key !== 'string') continue;
    if (typeof item.id === 'string' || item.id === null) {
      entries.push({ key: item.key, id: item.id });
    }
  }
  return entries;
}

/**
 * Validates `ctx.parameters` defensively: anything that isn't a picker
 * contract returns null, and the modal shows an error instead of guessing.
 */
export function readPickerParameters(
  raw: unknown,
): PickerModalParameters | null {
  if (!isRecord(raw)) return null;
  const fieldType = readFieldType(raw.fieldType);
  const domain =
    typeof raw.shopDomain === 'string'
      ? normalizeShopDomain(raw.shopDomain)
      : null;
  const selected = readSelected(raw.selected);
  if (!fieldType || !domain?.ok || !selected || !isRecord(raw.fieldParameters))
    return null;
  const context = readContext(raw.context);
  const unavailable = readUnavailable(raw.unavailable);
  return {
    fieldParameters: normalizeFieldParameters(raw.fieldParameters, fieldType),
    fieldType,
    shopDomain: domain.domain,
    selected,
    ...(context ? { context } : {}),
    ...(unavailable.length > 0 ? { unavailable } : {}),
  };
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export type PickerLabels = {
  /** What gets selected: product, variant or collection. */
  one: string;
  many: string;
  /**
   * What the results list: products for the product and variant kinds (a
   * variant picker browses products and opens them), collections otherwise.
   */
  resultOne: string;
  resultMany: string;
  searchLabel: string;
  placeholder: string;
  singleHint: string;
  emptyTitle: string;
  emptyHint: string;
};

const STOREFRONT_PRODUCTS_HINT =
  'Only products published to the Headless storefront this token belongs to are visible. Drafts, archived and unpublished products never show up.';

const LABELS: Record<ShopifyKind, PickerLabels> = {
  product: {
    one: 'product',
    many: 'products',
    resultOne: 'product',
    resultMany: 'products',
    searchLabel: 'Search products',
    placeholder: 'Search products, or paste a SKU or barcode…',
    singleHint: 'Click a product to choose it',
    emptyTitle: 'No products match',
    emptyHint: STOREFRONT_PRODUCTS_HINT,
  },
  variant: {
    one: 'variant',
    many: 'variants',
    resultOne: 'product',
    resultMany: 'products',
    searchLabel: 'Search products and variants',
    placeholder: 'Search products, or paste a SKU or barcode…',
    singleHint:
      'Click a variant to choose it. A product with several variants opens to show them.',
    emptyTitle: 'No products match',
    emptyHint: STOREFRONT_PRODUCTS_HINT,
  },
  collection: {
    one: 'collection',
    many: 'collections',
    resultOne: 'collection',
    resultMany: 'collections',
    searchLabel: 'Search collections',
    placeholder: 'Search collections…',
    singleHint: 'Click a collection to choose it',
    emptyTitle: 'No collections match',
    emptyHint:
      'Only collections published to the Headless storefront this token belongs to are visible.',
  },
};

export function pickerLabels(kind: ShopifyKind): PickerLabels {
  return LABELS[kind];
}

/** `"3 selected"`, or `"3 of 5 selected"` with a max. */
export function selectionCountLabel(count: number, max?: number): string {
  return typeof max === 'number' && Number.isFinite(max)
    ? `${count} of ${max} selected`
    : `${count} selected`;
}

/** Tooltip for items Replace can't pick: the field already has them. */
export const ALREADY_IN_FIELD_MESSAGE = 'Already in this field';

/** Tooltip for items disabled because the selection is full. */
export function maxReachedMessage(max: number, kind: ShopifyKind): string {
  const labels = pickerLabels(kind);
  return `You can select up to ${max} ${max === 1 ? labels.one : labels.many}`;
}

/** `"Accessory"`, `"Accessory or Premium"`, `"Accessory, Premium or Snow"`. */
export function tagsLabel(tags: readonly string[]): string {
  if (tags.length <= 1) return tags[0] ?? '';
  return `${tags.slice(0, -1).join(', ')} or ${tags[tags.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Search input
// ---------------------------------------------------------------------------

/** SKUs and barcodes: at least `SKU_SEARCH_MIN_LENGTH` characters, no spaces. */
export function isSkuCandidate(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= SKU_SEARCH_MIN_LENGTH && !/\s/.test(trimmed);
}

/** What the editor chose in the filter bar (the field's scope is separate). */
export type PickerFilters = {
  collection: { id: string; title: string } | null;
  productType: string | null;
  tags: string[];
  vendor: string;
  availableOnly: boolean;
  sort: PickerSort | null;
};

export const EMPTY_FILTERS: PickerFilters = {
  collection: null,
  productType: null,
  tags: [],
  vendor: '',
  availableOnly: false,
  sort: null,
};

/** True when any editor filter is set (sorting doesn't count). */
export function hasActiveFilters(filters: PickerFilters): boolean {
  return (
    filters.collection !== null ||
    filters.productType !== null ||
    filters.tags.length > 0 ||
    filters.vendor.trim() !== '' ||
    filters.availableOnly
  );
}

/** The filters a query runs with: the locked scope plus the editor's choices. */
export type EffectiveSearch = {
  collectionId: string | null;
  productType: string | null;
  vendor: string | null;
  /** ANY of them. Already narrowed to the scope's tags when it has some. */
  tags: string[];
  availableOnly: boolean;
};

function chosenTags(scope: FieldScope, chosen: readonly string[]): string[] {
  const scopeTags = scope.tags ?? [];
  if (scopeTags.length === 0) return [...chosen];
  const wanted = new Set(chosen.map((tag) => tag.toLowerCase()));
  const narrowed = scopeTags.filter((tag) => wanted.has(tag.toLowerCase()));
  return narrowed.length > 0 ? narrowed : [...scopeTags];
}

/**
 * A locked single-valued scope (collection, product type, vendor) always wins
 * over the editor's choice, editor tags can only narrow locked tags, and a
 * locked "Available for sale" can't be turned off.
 */
export function effectiveSearch(
  scope: FieldScope | undefined,
  filters: PickerFilters,
): EffectiveSearch {
  const locked = scope ?? {};
  const vendor = filters.vendor.trim();
  return {
    collectionId: locked.collectionId ?? filters.collection?.id ?? null,
    productType: locked.productType ?? filters.productType ?? null,
    vendor: locked.vendor ?? (vendor || null),
    tags: chosenTags(locked, filters.tags),
    availableOnly: locked.availableOnly === true || filters.availableOnly,
  };
}

// ---------------------------------------------------------------------------
// Client-side checks
// ---------------------------------------------------------------------------

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Mirrors Shopify's `vendor:` and `product_type:` matching: case-insensitive
 * and by whole words, so `Hydrogen` matches "Hydrogen Vendor".
 */
export function matchesFilterValue(actual: string, wanted: string): boolean {
  const target = wanted.trim().toLowerCase();
  if (!target) return true;
  if (actual.trim().toLowerCase() === target) return true;
  const actualWords = new Set(words(actual));
  const wantedWords = words(target);
  return (
    wantedWords.length > 0 && wantedWords.every((word) => actualWords.has(word))
  );
}

/**
 * Mirrors Shopify's free-text matching on what a product card shows: every
 * word of the text must prefix-match a word of the title, vendor, product
 * type or handle.
 */
export function textMatchesProduct(
  product: ProductSummary,
  text: string,
): boolean {
  const terms = words(text);
  if (terms.length === 0) return true;
  const haystack = [
    ...words(product.title),
    ...words(product.vendor),
    ...words(product.productType),
    ...words(product.handle),
  ];
  return terms.every((term) => haystack.some((word) => word.startsWith(term)));
}

/** The parts of a search that have to be checked in the browser. */
export type ClientCheck = {
  text: string | null;
  productType: string | null;
  vendor: string | null;
  availableOnly: boolean;
};

export function hasClientCheck(check: ClientCheck): boolean {
  return Boolean(
    check.text || check.productType || check.vendor || check.availableOnly,
  );
}

export function matchesClientCheck(
  product: ProductSummary,
  check: ClientCheck,
): boolean {
  if (check.availableOnly && !product.availableForSale) return false;
  if (
    check.productType &&
    !matchesFilterValue(product.productType, check.productType)
  )
    return false;
  if (check.vendor && !matchesFilterValue(product.vendor, check.vendor))
    return false;
  return check.text ? textMatchesProduct(product, check.text) : true;
}

/**
 * What a collection browse has to check itself: `collection.products` can't
 * search text, and Shopify silently ignores the filters the merchant hasn't
 * enabled in Search & Discovery. Locked product type, vendor and stock are
 * enforced here; editor choices for disabled filters aren't applied (their
 * controls are disabled). Tags can't be checked from a product card.
 */
export function collectionClientCheck(
  scope: FieldScope | undefined,
  support: CollectionFilterSupport | null,
  text: string,
): ClientCheck {
  const locked = scope ?? {};
  const unsupported = (key: keyof CollectionFilterSupport) =>
    support !== null && !support[key];
  return {
    text: text.trim() || null,
    productType:
      locked.productType && unsupported('productType')
        ? locked.productType
        : null,
    vendor: locked.vendor && unsupported('vendor') ? locked.vendor : null,
    availableOnly: locked.availableOnly === true && unsupported('availability'),
  };
}

/** The editor-facing state of each filter control inside a collection. */
export type CollectionControls = {
  productType: boolean;
  vendor: boolean;
  tags: boolean;
  availability: boolean;
};

/** All enabled outside a collection, or while its support isn't known yet. */
export function collectionControls(
  inCollection: boolean,
  support: CollectionFilterSupport | null,
): CollectionControls {
  if (!inCollection || !support) {
    return { productType: true, vendor: true, tags: true, availability: true };
  }
  return {
    productType: support.productType,
    vendor: support.vendor,
    tags: support.tag,
    availability: support.availability,
  };
}

/** The editor's filters with the ones a collection can't apply removed. */
export function applicableFilters(
  filters: PickerFilters,
  controls: CollectionControls,
): PickerFilters {
  return {
    ...filters,
    productType: controls.productType ? filters.productType : null,
    vendor: controls.vendor ? filters.vendor : '',
    tags: controls.tags ? filters.tags : [],
    availableOnly: controls.availability ? filters.availableOnly : false,
  };
}

/**
 * SKU hits have to respect the same filters as the results under them: the
 * locked scope and the editor's product type, vendor and "Available for sale".
 */
export function skuMatchesSearch(
  product: ProductSummary,
  search: EffectiveSearch,
): boolean {
  return matchesClientCheck(product, {
    text: null,
    productType: search.productType,
    vendor: search.vendor,
    availableOnly: search.availableOnly,
  });
}

/**
 * A collection or tags (locked or chosen by the editor) can't be verified on
 * SKU hits, so the lookup is skipped instead of pinning items the filters
 * would hide.
 */
export function canSearchSkus(search: EffectiveSearch): boolean {
  return !search.collectionId && search.tags.length === 0;
}

/**
 * Why a sold-out variant can't be picked: the field only allows variants
 * available for sale, or the editor turned "Available for sale" on. Null
 * otherwise.
 */
export function soldOutReason(
  scope: FieldScope | undefined,
  search: EffectiveSearch,
): string | null {
  if (scope?.availableOnly) {
    return 'Sold out: this field only allows variants available for sale';
  }
  return search.availableOnly
    ? 'Sold out: turn off Available for sale to choose it'
    : null;
}

/**
 * Why a variant row can't be picked: sold out while "Available for sale"
 * applies, else
 * the selection is full (`atMax`), else null.
 */
export function variantDisabledReason(
  variant: VariantSummary,
  soldOut: string | null,
  atMax: string | null,
): string | null {
  return soldOut && !variant.availableForSale ? soldOut : atMax;
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

/** `"US · USD · EN"`: the market Shopify applied. */
export function contextLabel(localization: LocalizationInfo): string {
  const country = localization.country.isoCode;
  const currency = localization.availableCountries.find(
    (candidate) => candidate.isoCode === country,
  )?.currency.isoCode;
  return [country, currency, localization.language.isoCode]
    .filter(Boolean)
    .join(' · ');
}

function languageName(localization: LocalizationInfo, code: string): string {
  return (
    localization.availableLanguages.find(
      (language) => language.isoCode === code,
    )?.endonymName ?? code
  );
}

/**
 * When Shopify answered in another language than the one asked for (it falls
 * back silently), a short explanation; otherwise null.
 */
export function languageFallbackNotice(
  requested: ShopifyContext,
  applied: ShopifyContext | null,
): string | null {
  const wanted = requested.language;
  const got = applied?.language;
  if (!wanted || !got || wanted === got) return null;
  return `${wanted} isn't published for this market, so Shopify answered in ${got}`;
}

/** Countries in name order for the given UI locale (Shopify sends ISO order). */
export function sortedCountries(
  countries: LocalizationInfo['availableCountries'],
  locale: string,
): LocalizationInfo['availableCountries'] {
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(locale, { sensitivity: 'base' });
  } catch {
    collator = new Intl.Collator('en', { sensitivity: 'base' });
  }
  return [...countries].sort((a, b) => collator.compare(a.name, b.name));
}

/** The menu label for a language option: `"English (EN)"`. */
export function languageOptionLabel(
  localization: LocalizationInfo,
  code: string,
): string {
  const name = languageName(localization, code);
  return name === code ? code : `${name} (${code})`;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Compares IDs in canonical form (Shopify accepts several spellings). */
function sameId(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  return (canonicalGid(a) ?? a) === (canonicalGid(b) ?? b);
}

function nodeHandle(node: ShopifyNode): string | null {
  return node.__typename === 'ProductVariant' ? null : node.handle;
}

/** True when the entry stands for this node (by GID, else by handle). */
export function entryMatchesNode(
  entry: PickerSelectedEntry,
  node: ShopifyNode,
): boolean {
  if (sameId(entry.id, node.id) || sameId(entry.node?.id, node.id)) return true;
  if (entry.id || entry.node) return false;
  const handle = nodeHandle(node);
  return (
    handle !== null &&
    entry.key.startsWith('handle:') &&
    sameShopifyHandle(entry.key.slice('handle:'.length), handle)
  );
}

export function isNodeSelected(
  entries: readonly PickerSelectedEntry[],
  node: ShopifyNode,
): boolean {
  return entries.some((entry) => entryMatchesNode(entry, node));
}

/**
 * True when the node is one of the field's other items (by GID, or by
 * handle for items saved only as a handle).
 */
export function isNodeUnavailable(
  unavailable: readonly PickerUnavailableEntry[],
  node: ShopifyNode,
): boolean {
  return unavailable.some((item) =>
    entryMatchesNode(
      { key: item.key, id: item.id, node: null, fallbackLabel: '' },
      node,
    ),
  );
}

function entryIdentity(entry: PickerSelectedEntry): string {
  return (
    canonicalGid(entry.id) ??
    canonicalGid(entry.node?.id) ??
    entry.id ??
    entry.key
  );
}

/** Removes later duplicates, keeping order. */
export function dedupeSelection(
  entries: readonly PickerSelectedEntry[],
): PickerSelectedEntry[] {
  const seen = new Set<string>();
  const result: PickerSelectedEntry[] = [];
  for (const entry of entries) {
    const identity = entryIdentity(entry);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(entry);
  }
  return result;
}

/** The entry a picked node becomes. */
export function entryForNode(node: ShopifyNode): PickerSelectedEntry {
  return {
    key: entryKey(node.id, nodeHandle(node)),
    id: node.id,
    node,
    fallbackLabel: nodeTitle(node),
  };
}

/**
 * Adds the node at the end, or removes it when it's already selected. Adding
 * past `max` (unresolved entries count too) returns the entries unchanged.
 */
export function toggleNode(
  entries: readonly PickerSelectedEntry[],
  node: ShopifyNode,
  max: number,
): PickerSelectedEntry[] {
  if (isNodeSelected(entries, node)) {
    return entries.filter((entry) => !entryMatchesNode(entry, node));
  }
  if (entries.length >= max) return [...entries];
  return [...entries, entryForNode(node)];
}

/**
 * Adds the node at the end unless it's already selected; an entry that stands
 * for it but has no node yet gets the node instead (never removed, never
 * duplicated). Adding past `max` returns the entries unchanged.
 */
export function selectNode(
  entries: readonly PickerSelectedEntry[],
  node: ShopifyNode,
  max: number,
): PickerSelectedEntry[] {
  if (isNodeSelected(entries, node)) {
    return hydrateEntries([...entries], [node]);
  }
  if (entries.length >= max) return [...entries];
  return [...entries, entryForNode(node)];
}

/**
 * Fills entries that have no node with matching loaded nodes (by GID, or by
 * handle for handle-only entries), keeping keys and order. Returns the same
 * array when nothing changed.
 */
export function hydrateEntries(
  entries: PickerSelectedEntry[],
  nodes: readonly ShopifyNode[],
): PickerSelectedEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.node) return entry;
    const node = nodes.find((candidate) => entryMatchesNode(entry, candidate));
    if (!node) return entry;
    changed = true;
    return { ...entry, id: entry.id ?? node.id, node };
  });
  return changed ? next : entries;
}

export function removeEntry(
  entries: readonly PickerSelectedEntry[],
  key: string,
): PickerSelectedEntry[] {
  return entries.filter((entry) => entry.key !== key);
}

/** The selected variants that belong to this product (hydrated ones only). */
export function selectedVariantsOf(
  entries: readonly PickerSelectedEntry[],
  productId: string,
): PickerSelectedEntry[] {
  return entries.filter(
    (entry) =>
      entry.node?.__typename === 'ProductVariant' &&
      sameId(entry.node.product.id, productId),
  );
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/** Option chips appear once a product has more variants than this. */
export const OPTION_CHIPS_MIN_VARIANTS = 6;

/** Options worth filtering by: the ones with more than one value. */
export function filterableOptions(
  options: readonly ProductOption[],
  variantsCount: number,
): ProductOption[] {
  if (variantsCount <= OPTION_CHIPS_MIN_VARIANTS) return [];
  return options.filter((option) => option.optionValues.length > 1);
}

/** Variants whose options match every chosen `{ name: value }`. */
export function filterVariantsByOptions(
  variants: readonly VariantSummary[],
  chosen: Readonly<Record<string, string>>,
): VariantSummary[] {
  const entries = Object.entries(chosen);
  if (entries.length === 0) return [...variants];
  return variants.filter((variant) =>
    entries.every(([name, value]) =>
      variant.selectedOptions.some(
        (option) => option.name === name && option.value === value,
      ),
    ),
  );
}
