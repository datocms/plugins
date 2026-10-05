/**
 * Shopify search syntax for `products(query:)` and `collections(query:)`,
 * plus the picker's sort and collection-filter mapping.
 *
 * Shopify silently ignores what it can't parse and then returns the WHOLE
 * catalog, so user text must never reach the API as syntax. Everything below
 * was checked against the demo store (Storefront API 2026-10) on 2026-10-03.
 *
 * Free text (`products(query:)`, 15 demo products):
 * - Bare words already prefix-match, case-insensitively, across title,
 *   description, vendor, product type, tags, variant titles and SKUs:
 *   `compl` and `COMPLETE` find "The Complete Snowboard", `gif` finds
 *   "Gift Card", `sku-man` finds the product with SKU `sku-managed-1`.
 *   Matching is prefix-only: `board` and `nowboard` find nothing.
 * - Several bare words are ANDed and each one is still a prefix:
 *   `compl snow` and `complete snowb` find "The Complete Snowboard",
 *   `complete board` finds nothing.
 * - `word*` behaves exactly like `word`, so no wildcard is appended.
 * - `title:word*` also prefix-matches but only on the title, so it would lose
 *   the vendor, tag and SKU matches; it is used for collections only.
 * - A double-quoted phrase is exact and loses the prefix match:
 *   `"complete snowboard"` finds 1, `"complete snow"` finds 0, `"snow"` only
 *   matches the four products tagged `Snow`. Phrases are kept for editors who
 *   type quotes themselves, and never added automatically.
 * - Single quotes are phrase delimiters too: `'complete snow'` finds 0.
 * - Syntax that falls back to the whole catalog when typed raw: `"`, `'`,
 *   `\`, `(`, `)`, `()`, `-`, `*`, `AND`, `OR`, `foo:bar`, `sku:xyz`,
 *   `created_at:>2020`. `NOT gift` negates (14 results) and `-snow` negates
 *   (1 result), `vendor:Hydrogen` filters by vendor.
 * - Backslash-escaping fixes all of them while keeping the prefix match:
 *   `\"`, `\'`, `\\`, `\(\)`, `\-`, `\*`, `foo\:bar`, `sku\:xyz`,
 *   `created_at\:>2020` and `vendor\:Hydrogen` all return 0 results instead
 *   of the catalog, and `\-snow`, `\(snow`, `multi\-loc` and
 *   `Snowboard\: Hydr` still prefix-match their words.
 * - Operators are uppercase only: `Not`, `nOT`, `and`, `or` are plain words.
 *   Lowercasing `AND`/`OR`/`NOT` keeps them literal (matching is
 *   case-insensitive).
 * - `<` and `>` are range operators after a field (see Filters and
 *   Collections). In free text they are harmless (`<5`, `\<5` and `5` all
 *   return the same 15), but they are backslash-escaped anyway because the
 *   same escaping feeds `title:` terms.
 * - Other punctuation (`{ [ ~ ^ = ! + & | ? / . ,`) is harmless: alone it
 *   returns 0 results, inside a word it is ignored.
 *
 * Filters:
 * - `product_type:`, `vendor:` and `tag:` match whole words, case-insensitively
 *   (`vendor:Hydrogen` matches "Hydrogen Vendor"); a quoted value matches the
 *   phrase (`vendor:"DatoCMS Demo"`). `tag:Spo*` doesn't prefix-match.
 * - A bare value starting with `<`, `>`, `<=` or `>=` becomes a range:
 *   `vendor:>Hydrogen` returns the whole catalog (15, `vendor:Hydrogen` is 3),
 *   `product_type:<snowboard` returns 2 (12 for `snowboard`), and `tag:<1kg`,
 *   `tag_not:<1kg` and `tag:>=Premium` fail with INTERNAL_SERVER_ERROR.
 *   Quoted they are literal (`vendor:">Hydrogen"` is 3, `tag:"<1kg"` is 0,
 *   `tag_not:"<1kg"` is 15). Values containing `<` or `>` anywhere are quoted;
 *   inner ones behave the same bare or quoted (`vendor:Hydrogen<Z` is 0 both
 *   ways). A sweep of `! ~ ^ { } [ ] + & | ? / . , ; = # % @ $` and backtick
 *   as a leading character gave the same result bare and quoted.
 * - Tags mean ANY of them, as they do inside a collection (see below):
 *   `(tag:Accessory OR tag:Premium)` returns 12 (8 + 4) and still combines
 *   with AND (`vendor:Hydrogen AND (tag:Accessory OR tag:Premium)` is 3).
 *   The parentheses are required: `vendor:Hydrogen AND tag:Premium OR tag:Snow`
 *   returns 0, not 4. `tag:Accessory AND tag:Premium` would mean ALL (0).
 * - Several `tag_not:` clauses joined with AND exclude every listed tag.
 * - `available_for_sale:true` drops sold-out products. `available_for_sale:false`
 *   is NOT the opposite: it returns the same 13 products, so it is never sent.
 *
 * Collection filters (`collection.products(filters:)`):
 * - Filters of the same type are ORed: on `automated-collection` (7 products,
 *   all in stock) `[{available:false}]` returns 0, but
 *   `[{available:true},{available:false}]` returns 7 in either order. So
 *   several `{tag}` filters mean ANY tag, never ALL.
 * - Filters the merchant hasn't enabled in Search & Discovery are silently
 *   ignored (`[{tag:"nonexistent"}]` returns all 7).
 *
 * Collections (`collections(query:)`, 3 demo collections):
 * - `title:hy*` finds "Hydrogen", `title:automated* AND title:coll*` finds
 *   "Automated Collection", `title:"automated coll"*` finds nothing, and
 *   `title:\(*`, `title:\"*`, `title:\:*`, `title:\**` find nothing.
 * - A leading `<` or `>` turns the term into a title range: `title:>*`,
 *   `title:>a*` and `title:<z*` return all 3, `title:<h*` returns
 *   "Automated Collection". Escaped they are literal: `title:\>a*` returns
 *   "Automated Collection" (like `title:a*`), `title:\<z*` and `title:\>*`
 *   return 0. A leading `=` is harmless (`title:=h*` equals `title:h*`).
 */

import type {
  CollectionSortKey,
  ProductFilterInput,
  ProductSortKey,
  ShopifyFilter,
} from '../types';

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/** Words Shopify reads as boolean operators (uppercase only). */
const OPERATOR_WORDS: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT']);

/**
 * Characters that turn a filter value into syntax unless it is quoted.
 * `<` and `>` start a range (`vendor:>x`), so they are quoted too.
 */
const VALUE_SYNTAX = /[\s:()"'\\*<>]/;

/** Characters escaped with a backslash inside a bare search term. */
const TERM_SYNTAX = /[\\"':()*<>]/g;

/**
 * Escapes a filter value (`vendor:…`, `tag:…`): backslashes and double quotes
 * are escaped, and the value is double-quoted when it contains whitespace or
 * any search syntax (`: ( ) " ' \ * < >`, a leading `-`, or a bare operator),
 * so it can never become `field:value`, range or boolean syntax.
 */
export function escapeSearchValue(value: string): string {
  const escaped = value.replace(/[\\"]/g, '\\$&');
  const needsQuotes =
    value.length === 0 ||
    VALUE_SYNTAX.test(value) ||
    value.startsWith('-') ||
    OPERATOR_WORDS.has(value);
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Escapes one free-text word so it stays a literal prefix term. */
function escapeTerm(word: string): string {
  if (OPERATOR_WORDS.has(word)) return word.toLowerCase();
  const escaped = word.replace(TERM_SYNTAX, '\\$&');
  return escaped.startsWith('-') ? `\\${escaped}` : escaped;
}

/** A double-quoted phrase, with only `\` and `"` escaped. */
function quotePhrase(phrase: string): string {
  return `"${phrase.replace(/[\\"]/g, '\\$&')}"`;
}

type TextToken = { kind: 'word' | 'phrase'; value: string };

/**
 * Splits editor text into bare words and balanced `"…"` phrases. Stray or
 * unbalanced quotes stay inside words, where they get escaped.
 */
function tokenizeText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  for (const match of text.matchAll(/"([^"]*)"|(\S+)/g)) {
    const [, phrase, word] = match;
    if (word !== undefined) {
      tokens.push({ kind: 'word', value: word });
      continue;
    }
    const normalized = (phrase ?? '').trim().replace(/\s+/g, ' ');
    if (normalized) tokens.push({ kind: 'phrase', value: normalized });
  }
  return tokens;
}

/** Free text as literal prefix terms (implicit AND) and exact phrases. */
function freeTextQuery(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const parts = tokenizeText(text).map((token) =>
    token.kind === 'phrase'
      ? quotePhrase(token.value)
      : escapeTerm(token.value),
  );
  return parts.length > 0 ? parts.join(' ') : undefined;
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

export type ProductSearchInput = {
  text?: string;
  productType?: string;
  vendor?: string;
  tags?: string[];
  tagsNot?: string[];
  availableOnly?: boolean;
};

function cleanValue(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Trimmed, non-empty, de-duplicated (case-insensitively, like Shopify). */
function cleanValues(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const trimmed = cleanValue(value);
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function fieldClause(field: string, value: string | undefined): string[] {
  const cleaned = cleanValue(value);
  return cleaned ? [`${field}:${escapeSearchValue(cleaned)}`] : [];
}

function fieldClauses(field: string, values: string[] | undefined): string[] {
  return cleanValues(values).map(
    (value) => `${field}:${escapeSearchValue(value)}`,
  );
}

/** ANY of the tags: `tag:A`, or `(tag:A OR tag:B)` for several. */
function anyTagClause(tags: string[] | undefined): string[] {
  const clauses = fieldClauses('tag', tags);
  if (clauses.length < 2) return clauses;
  return [`(${clauses.join(' OR ')})`];
}

/**
 * Shopify search syntax for `products(query:)`, built only from these
 * structured filters plus literal free text, joined with ` AND `.
 * Returns undefined when there is nothing to filter on.
 *
 * `tags` means ANY of them, exactly like `buildCollectionProductFilters`
 * (Shopify ORs same-type collection filters), so a tag selection returns the
 * same products with or without a collection. `tagsNot` excludes every one
 * of its tags. Merge a field's locked scope tags with `mergeScopeTags` first:
 * adding tags to an ANY list widens it.
 */
export function buildProductSearchQuery(
  input: ProductSearchInput,
): string | undefined {
  const text = freeTextQuery(input.text);
  const clauses = [
    ...(text ? [text] : []),
    ...fieldClause('product_type', input.productType),
    ...fieldClause('vendor', input.vendor),
    ...anyTagClause(input.tags),
    ...fieldClauses('tag_not', input.tagsNot),
    ...(input.availableOnly ? ['available_for_sale:true'] : []),
  ];
  return clauses.length > 0 ? clauses.join(' AND ') : undefined;
}

/**
 * Title prefix search for `collections(query:)`: each word becomes
 * `title:word*` and each quoted phrase `title:"phrase"`, joined with ` AND `.
 */
export function buildCollectionSearchQuery(text: string): string | undefined {
  const clauses = tokenizeText(text).map((token) =>
    token.kind === 'phrase'
      ? `title:${quotePhrase(token.value)}`
      : `title:${escapeTerm(token.value)}*`,
  );
  return clauses.length > 0 ? clauses.join(' AND ') : undefined;
}

// ---------------------------------------------------------------------------
// Collection filters (Search & Discovery)
// ---------------------------------------------------------------------------

/** Which `collection.products(filters:)` inputs the merchant enabled. */
export type CollectionFilterSupport = {
  availability: boolean;
  productType: boolean;
  vendor: boolean;
  tag: boolean;
  price: boolean;
};

type SupportKey = keyof CollectionFilterSupport;

/**
 * Search & Discovery filter IDs. `filter.v.availability` and `filter.v.price`
 * are verified live (the only ones enabled by default, on every demo
 * collection); the `filter.p.*` IDs follow Shopify's documented naming.
 */
const SUPPORT_BY_FILTER_ID: Record<string, SupportKey> = {
  'filter.v.availability': 'availability',
  'filter.v.price': 'price',
  'filter.p.product_type': 'productType',
  'filter.p.vendor': 'vendor',
  'filter.p.tag': 'tag',
};

/** Keys of each value's `input` JSON, e.g. `{"available":true}`. */
const SUPPORT_BY_INPUT_KEY: Record<string, SupportKey> = {
  available: 'availability',
  price: 'price',
  productType: 'productType',
  productVendor: 'vendor',
  tag: 'tag',
};

function inputKeys(input: string): string[] {
  try {
    const parsed: unknown = JSON.parse(input);
    return typeof parsed === 'object' && parsed !== null
      ? Object.keys(parsed)
      : [];
  } catch {
    return [];
  }
}

function supportKeysOf(filter: ShopifyFilter): SupportKey[] {
  const keys: SupportKey[] = [];
  const byId = SUPPORT_BY_FILTER_ID[filter.id];
  if (byId) keys.push(byId);
  for (const value of filter.values ?? []) {
    for (const key of inputKeys(value.input)) {
      const byInput = SUPPORT_BY_INPUT_KEY[key];
      if (byInput) keys.push(byInput);
    }
  }
  return keys;
}

/**
 * Reads a collection's `products.filters` to find which filters Shopify
 * will actually apply. Verified live: filters that aren't enabled are
 * silently ignored and the unfiltered collection comes back.
 */
export function enabledCollectionFilters(
  filters: ShopifyFilter[],
): CollectionFilterSupport {
  const support: CollectionFilterSupport = {
    availability: false,
    productType: false,
    vendor: false,
    tag: false,
    price: false,
  };
  for (const filter of filters) {
    for (const key of supportKeysOf(filter)) support[key] = true;
  }
  return support;
}

export type CollectionProductFilterInput = {
  availableOnly?: boolean;
  productType?: string;
  vendor?: string;
  tags?: string[];
};

/**
 * `ProductFilter` inputs for `collection.products(filters:)`. Pass `enabled`
 * (from `enabledCollectionFilters`) to drop filters Shopify would ignore.
 *
 * Shopify ORs filters of the same type, so several tags mean ANY of them
 * (the same meaning `buildProductSearchQuery` gives `tags`). Merge a field's
 * locked scope tags with `mergeScopeTags` first. A dropped filter is not
 * applied at all: when it comes from a locked scope, the caller has to
 * enforce it another way or tell the editor.
 */
export function buildCollectionProductFilters(
  input: CollectionProductFilterInput,
  enabled?: CollectionFilterSupport,
): ProductFilterInput[] {
  const allows = (key: SupportKey) => !enabled || enabled[key];
  const filters: ProductFilterInput[] = [];
  if (input.availableOnly && allows('availability')) {
    filters.push({ available: true });
  }
  const productType = cleanValue(input.productType);
  if (productType && allows('productType')) filters.push({ productType });
  const vendor = cleanValue(input.vendor);
  if (vendor && allows('vendor')) filters.push({ productVendor: vendor });
  if (allows('tag')) {
    for (const tag of cleanValues(input.tags)) filters.push({ tag });
  }
  return filters;
}

/**
 * The ANY-tag list to pass to either builder when a field's locked scope
 * lists tags, so the editor's tags can only narrow it: the chosen tags that
 * are in the scope (compared case-insensitively, scope casing kept), or the
 * whole scope when none of them is. Tags outside the scope are dropped, since
 * ANY(scope) AND ANY(chosen) can't be expressed with collection filters.
 * Without scope tags, the chosen tags are returned as they are.
 */
export function mergeScopeTags(
  scopeTags: string[] | undefined,
  chosenTags: string[] | undefined,
): string[] {
  const scope = cleanValues(scopeTags);
  const chosen = cleanValues(chosenTags);
  if (scope.length === 0) return chosen;
  const wanted = new Set(chosen.map((tag) => tag.toLowerCase()));
  const narrowed = scope.filter((tag) => wanted.has(tag.toLowerCase()));
  return narrowed.length > 0 ? narrowed : scope;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type PickerSort =
  | 'relevance'
  | 'collection-default'
  | 'best-selling'
  | 'newest'
  | 'updated'
  | 'title-asc'
  | 'price-asc'
  | 'price-desc';

export const PICKER_SORT_OPTIONS: Array<{ value: PickerSort; label: string }> =
  [
    { value: 'relevance', label: 'Relevance' },
    { value: 'collection-default', label: 'Collection order' },
    { value: 'best-selling', label: 'Best selling' },
    { value: 'newest', label: 'Newest' },
    { value: 'updated', label: 'Recently updated' },
    { value: 'title-asc', label: 'Title A–Z' },
    { value: 'price-asc', label: 'Price low → high' },
    { value: 'price-desc', label: 'Price high → low' },
  ];

export type SortContext = { inCollection: boolean; hasText: boolean };

/**
 * Relevance needs a text query, collection order needs a collection, and
 * "Recently updated" isn't possible inside a collection because
 * `ProductCollectionSortKeys` has no `UPDATED` key.
 */
export function isSortAvailable(
  sort: PickerSort,
  context: SortContext,
): boolean {
  switch (sort) {
    case 'relevance':
      return context.hasText;
    case 'collection-default':
      return context.inCollection;
    case 'updated':
      return !context.inCollection;
    default:
      return true;
  }
}

export function defaultSort(context: SortContext): PickerSort {
  if (context.hasText) return 'relevance';
  if (context.inCollection) return 'collection-default';
  return 'title-asc';
}

/** `sort` when it is available in `context`, otherwise the default. */
export function resolveSort(
  sort: PickerSort,
  context: SortContext,
): PickerSort {
  return isSortAvailable(sort, context) ? sort : defaultSort(context);
}

type SortSpec<Key> = { sortKey: Key; reverse: boolean };

/**
 * Verified live: `reverse: false` is ascending for CREATED_AT, UPDATED_AT,
 * PRICE and TITLE (oldest, least recently updated, cheapest, A first), so
 * newest, recently updated and price high → low use `reverse: true`.
 */
const PRODUCT_SORTS: Record<
  Exclude<PickerSort, 'relevance' | 'collection-default'>,
  SortSpec<ProductSortKey>
> = {
  'best-selling': { sortKey: 'BEST_SELLING', reverse: false },
  newest: { sortKey: 'CREATED_AT', reverse: true },
  updated: { sortKey: 'UPDATED_AT', reverse: true },
  'title-asc': { sortKey: 'TITLE', reverse: false },
  'price-asc': { sortKey: 'PRICE', reverse: false },
  'price-desc': { sortKey: 'PRICE', reverse: true },
};

/** Same directions as products, verified live on `automated-collection`. */
const COLLECTION_SORTS: Record<
  Exclude<PickerSort, 'updated'>,
  SortSpec<CollectionSortKey>
> = {
  relevance: { sortKey: 'RELEVANCE', reverse: false },
  'collection-default': { sortKey: 'COLLECTION_DEFAULT', reverse: false },
  'best-selling': { sortKey: 'BEST_SELLING', reverse: false },
  newest: { sortKey: 'CREATED', reverse: true },
  'title-asc': { sortKey: 'TITLE', reverse: false },
  'price-asc': { sortKey: 'PRICE', reverse: false },
  'price-desc': { sortKey: 'PRICE', reverse: true },
};

/**
 * `ProductSortKeys` for `products(sortKey:, reverse:)`. Sorts that don't
 * apply outside a collection fall back to relevance with text, else title.
 */
export function toProductSort(
  sort: PickerSort,
  hasText: boolean,
): SortSpec<ProductSortKey> {
  if (sort === 'relevance' || sort === 'collection-default') {
    return hasText
      ? { sortKey: 'RELEVANCE', reverse: false }
      : { ...PRODUCT_SORTS['title-asc'] };
  }
  return { ...PRODUCT_SORTS[sort] };
}

/**
 * `ProductCollectionSortKeys` for `collection.products(sortKey:, reverse:)`.
 * "Recently updated" has no collection key and falls back to collection order.
 */
export function toCollectionSort(
  sort: PickerSort,
): SortSpec<CollectionSortKey> {
  if (sort === 'updated') return { ...COLLECTION_SORTS['collection-default'] };
  return { ...COLLECTION_SORTS[sort] };
}
