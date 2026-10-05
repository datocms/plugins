/**
 * Stored field values: parse, validate, build and serialize all four formats.
 *
 * - String field, `handle`: `"the-complete-snowboard"` (1.x).
 * - String field, `gid`: `"gid://shopify/ProductVariant/45123"`.
 * - JSON field, `legacyProductJson`: the 1.x product JSON (see `legacy.ts`).
 * - JSON field, `reference`: the versioned reference document.
 *
 * The parser recognizes every format regardless of the field's configured
 * format, which is what lets the editor offer "Convert to new format". Nothing
 * here writes a value on its own: callers pass the serialized result to
 * `ctx.setFieldValue` only when an editor acts.
 */

import {
  DEMO_STORE,
  type Cardinality,
  type CollectionReference,
  type CollectionSummary,
  type FieldParametersV1,
  type FieldType,
  type LegacyProductJson,
  type LegacyProductNode,
  type Money,
  type ParsedStoredValue,
  type ProductReference,
  type ProductSummary,
  type ReferenceDocumentV1,
  type ReferenceSnapshot,
  type ShopifyKind,
  type ShopifyNode,
  type StorageFormat,
  type StoredEntry,
  type StoredValueErrorCode,
  type VariantReference,
  type VariantSummary,
} from '../types';
import { decodeShopifyId, kindOfGid, parseGid } from './gid';
import {
  hasExactKeys,
  hasOnlyKeys,
  isNonEmptyString,
  isRecord,
  normalizedString,
} from './guards';
import {
  fullSizeShopifyImageUrl,
  buildLegacyProductJson,
  sameShopifyHandle,
  serializeLegacyProductJson,
} from './legacy';
import { variantDisplayTitle } from './titles';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const STORED_VALUE_ERROR_MESSAGES: Record<StoredValueErrorCode, string> = {
  'invalid-json': "The saved value isn't valid JSON.",
  'invalid-shape': "The saved value isn't in a format this field recognizes.",
  'unsupported-version':
    'The saved value was written by a newer version of this plugin. Update the plugin to edit it.',
  'kind-mismatch':
    'The saved value holds a different kind of Shopify item than this field picks.',
  'cardinality-mismatch':
    'The saved value holds several Shopify items, but this field takes only one.',
  'shop-mismatch':
    'The saved value points to a different Shopify store than the one this field uses.',
  'duplicate-reference':
    'The saved value lists the same Shopify item more than once.',
};

/** Editor-facing explanation of a parse error. */
export function describeStoredValueError(code: StoredValueErrorCode): string {
  return STORED_VALUE_ERROR_MESSAGES[code];
}

export type StoredValueBuildErrorCode =
  | 'missing-id'
  | 'missing-handle'
  | 'missing-product-id'
  | 'missing-shop'
  | 'missing-legacy-product'
  | 'kind-mismatch'
  | 'format-mismatch'
  | 'too-many-entries';

/** Thrown when a value can't be built from the data given (a caller bug). */
export class StoredValueBuildError extends Error {
  readonly code: StoredValueBuildErrorCode;

  constructor(code: StoredValueBuildErrorCode, message: string) {
    super(message);
    this.name = 'StoredValueBuildError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Canonical IDs
// ---------------------------------------------------------------------------

/**
 * The canonical form of a stored ID, `gid://shopify/{Type}/{number}`: decoded
 * from base64, trimmed, without a `?query` suffix and without leading zeros.
 * Shopify accepts the other spellings but always returns this one as
 * `node.id`, so stored IDs only compare equal to hydrated nodes in this form.
 * Null for anything that isn't a GID.
 */
export function canonicalGid(value: unknown): string | null {
  const decoded = decodeShopifyId(value);
  const parsed = decoded === null ? null : parseGid(decoded);
  if (!parsed) return null;
  const numericId = parsed.numericId.replace(/^0+(?=\d)/, '');
  return `gid://shopify/${parsed.type}/${numericId}`;
}

/** The canonical GID when `value` is an ID of `kind`, else null. */
function canonicalGidOfKind(value: unknown, kind: ShopifyKind): string | null {
  const gid = canonicalGid(value);
  return gid !== null && kindOfGid(gid) === kind ? gid : null;
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<ShopifyKind, { one: string; many: string }> = {
  product: { one: 'product', many: 'products' },
  variant: { one: 'product variant', many: 'product variants' },
  collection: { one: 'collection', many: 'collections' },
};

/** Stable entry key: the GID when known, else `handle:{handle}`. */
export function entryKey(id: string | null, handle: string | null): string {
  return id ?? `handle:${handle ?? ''}`;
}

function gidEntry(kind: ShopifyKind, id: string): StoredEntry {
  return kind === 'variant'
    ? { key: id, kind, id, handle: null, productId: null }
    : { key: id, kind, id, handle: null };
}

function handleEntry(kind: ShopifyKind, handle: string): StoredEntry {
  return { key: entryKey(null, handle), kind, id: null, handle };
}

/**
 * Removes later duplicates: same GID (compared in canonical form), or same key
 * when there is no GID.
 */
export function dedupeEntries<T extends { key: string; id: string | null }>(
  entries: readonly T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const entry of entries) {
    const identity = canonicalGid(entry.id) ?? entry.id ?? entry.key;
    if (!seen.has(identity)) {
      seen.add(identity);
      result.push(entry);
    }
  }
  return result;
}

/** Returns a reordered copy; out-of-range or equal indexes return a plain copy. */
export function moveEntry<T>(
  entries: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const result = [...entries];
  const valid = (index: number) =>
    Number.isInteger(index) && index >= 0 && index < result.length;
  if (!valid(fromIndex) || !valid(toIndex) || fromIndex === toIndex) {
    return result;
  }
  const [moved] = result.splice(fromIndex, 1);
  if (moved !== undefined) {
    result.splice(toIndex, 0, moved);
  }
  return result;
}

/** Label for an entry Shopify can't resolve: snapshot title, handle, then GID. */
export function entryFallbackLabel(entry: StoredEntry): string {
  const title = entry.snapshot?.title;
  if (isNonEmptyString(title)) return title;
  if (isNonEmptyString(entry.handle)) return entry.handle;
  return entry.id ?? entry.key;
}

/**
 * The live handle when it differs from the stored one (variants compare the
 * product handle). Null when they match or nothing was stored. Handles compare
 * the way the Storefront API resolves them (case-insensitive, trailing spaces
 * ignored), so a hand-typed `The-Board` that resolves isn't reported.
 */
export function detectHandleDrift(
  entry: StoredEntry,
  node: ShopifyNode,
): string | null {
  if (entry.handle === null) return null;
  const liveHandle =
    node.__typename === 'ProductVariant' ? node.product.handle : node.handle;
  return sameShopifyHandle(entry.handle, liveHandle) ? null : liveHandle;
}

// ---------------------------------------------------------------------------
// Snapshots and entries from Shopify nodes
// ---------------------------------------------------------------------------

type SnapshotParts = {
  title: string;
  imageUrl?: string | null;
  price?: Money;
  sku?: string | null;
  capturedAt: string;
};

function copyMoney(money: Money): Money {
  return { amount: money.amount, currencyCode: money.currencyCode };
}

/** Canonical key order, and no undefined values. */
function makeSnapshot(parts: SnapshotParts): ReferenceSnapshot {
  return {
    title: parts.title,
    ...(isNonEmptyString(parts.imageUrl)
      ? { imageUrl: fullSizeShopifyImageUrl(parts.imageUrl) }
      : {}),
    ...(parts.price ? { price: copyMoney(parts.price) } : {}),
    ...(isNonEmptyString(parts.sku) ? { sku: parts.sku } : {}),
    capturedAt: parts.capturedAt,
  };
}

/**
 * Display hints captured at selection time. `imageUrl` is the full-size
 * original (not the picker's thumbnail), so frontends can size it themselves.
 */
export function snapshotFromNode(
  node: ShopifyNode,
  capturedAt: string,
): ReferenceSnapshot {
  switch (node.__typename) {
    case 'Product':
      return makeSnapshot({
        title: node.title,
        imageUrl: node.featuredImage?.url,
        price: node.priceRange.minVariantPrice,
        capturedAt,
      });
    case 'ProductVariant':
      return makeSnapshot({
        title: variantDisplayTitle(node.product.title, node.title),
        imageUrl: node.image?.url ?? node.product.featuredImage?.url,
        price: node.price,
        sku: node.sku,
        capturedAt,
      });
    case 'Collection':
      return makeSnapshot({
        title: node.title,
        imageUrl: node.image?.url,
        capturedAt,
      });
  }
}

function baseEntryFromNode(node: ShopifyNode): StoredEntry {
  if (node.__typename === 'ProductVariant') {
    return {
      key: node.id,
      kind: 'variant',
      id: node.id,
      handle: node.product.handle,
      productId: node.product.id,
    };
  }
  return {
    key: node.id,
    kind: node.__typename === 'Product' ? 'product' : 'collection',
    id: node.id,
    handle: node.handle,
  };
}

export function entryFromNode(
  node: ShopifyNode,
  options: { snapshot?: boolean; capturedAt?: string } = {},
): StoredEntry {
  const entry = baseEntryFromNode(node);
  if (!options.snapshot) return entry;
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  return { ...entry, snapshot: snapshotFromNode(node, capturedAt) };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type ParseStoredValueOptions = {
  fieldType: FieldType;
  fieldParameters: FieldParametersV1;
  /** The field's store; documents for another shop are a `shop-mismatch`. */
  shopDomain: string | null;
};

type ParseSuccess = Extract<ParsedStoredValue, { ok: true }>;
type ParseFailure = Extract<ParsedStoredValue, { ok: false }>;

function parseFailure(
  code: StoredValueErrorCode,
  rawValue: unknown,
): ParseFailure {
  return {
    ok: false,
    code,
    message: describeStoredValueError(code),
    rawValue,
  };
}

function parseSuccess(
  format: StorageFormat | null,
  kind: ShopifyKind,
  entries: StoredEntry[],
  extra: { shop?: string; legacyProduct?: Partial<LegacyProductJson> } = {},
): ParseSuccess {
  return {
    ok: true,
    format,
    kind,
    shop: extra.shop ?? null,
    entries,
    legacyProduct: extra.legacyProduct ?? null,
  };
}

function isBlank(rawValue: unknown): boolean {
  return (
    rawValue === null ||
    rawValue === undefined ||
    (typeof rawValue === 'string' && rawValue.trim() === '')
  );
}

/**
 * Parses any stored value. Recognizes all four formats whatever the field is
 * configured to store, and reports the one it found in `format`.
 */
export function parseStoredValue(
  rawValue: unknown,
  options: ParseStoredValueOptions,
): ParsedStoredValue {
  if (isBlank(rawValue)) {
    return parseSuccess(null, options.fieldParameters.kind, []);
  }
  return options.fieldType === 'string'
    ? parseStringValue(rawValue, options.fieldParameters.kind)
    : parseJsonValue(rawValue, options);
}

function parseStringValue(
  rawValue: unknown,
  fieldKind: ShopifyKind,
): ParsedStoredValue {
  if (typeof rawValue !== 'string') {
    return parseFailure('invalid-shape', rawValue);
  }
  const gid = canonicalGid(rawValue);
  if (gid !== null) {
    // Unknown GID types (kindOfGid → null) can't match the field either.
    if (kindOfGid(gid) !== fieldKind) {
      return parseFailure('kind-mismatch', rawValue);
    }
    return parseSuccess('gid', fieldKind, [gidEntry(fieldKind, gid)]);
  }
  if (fieldKind === 'variant') {
    // A handle names a product, never one of its variants.
    return parseFailure('kind-mismatch', rawValue);
  }
  // Keep the string exactly as 1.x stored and used it.
  return parseSuccess('handle', fieldKind, [handleEntry(fieldKind, rawValue)]);
}

type DecodedJson = { ok: true; value: unknown } | { ok: false };

function decodeJson(rawValue: unknown): DecodedJson {
  if (typeof rawValue !== 'string') return { ok: true, value: rawValue };
  try {
    return { ok: true, value: JSON.parse(rawValue) };
  } catch {
    return { ok: false };
  }
}

function parseJsonValue(
  rawValue: unknown,
  options: ParseStoredValueOptions,
): ParsedStoredValue {
  const decoded = decodeJson(rawValue);
  if (!decoded.ok) return parseFailure('invalid-json', rawValue);
  const value = decoded.value;
  if (value === null) {
    return parseSuccess(null, options.fieldParameters.kind, []);
  }
  if (!isRecord(value)) return parseFailure('invalid-shape', rawValue);
  if ('version' in value) {
    return parseReferenceDocumentValue(value, rawValue, options);
  }
  return parseLegacyProductValue(value, rawValue, options.fieldParameters.kind);
}

function parseLegacyProductValue(
  value: Record<string, unknown>,
  rawValue: unknown,
  fieldKind: ShopifyKind,
): ParsedStoredValue {
  const handle = isNonEmptyString(value.handle) ? value.handle : null;
  const id = canonicalGidOfKind(value.id, 'product');
  if (handle === null && id === null) {
    return parseFailure('invalid-shape', rawValue);
  }
  if (fieldKind !== 'product') {
    return parseFailure('kind-mismatch', rawValue);
  }
  const entry: StoredEntry = {
    key: entryKey(id, handle),
    kind: 'product',
    id,
    handle,
  };
  return parseSuccess('legacyProductJson', 'product', [entry], {
    legacyProduct: value as Partial<LegacyProductJson>,
  });
}

function versionProblem(version: unknown): StoredValueErrorCode | null {
  if (version === 1) return null;
  // A later integer version is a newer contract; anything else is garbage.
  return typeof version === 'number' && Number.isInteger(version) && version > 1
    ? 'unsupported-version'
    : 'invalid-shape';
}

function sameShop(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function documentProblem(
  document: ReferenceDocumentV1,
  options: ParseStoredValueOptions,
): StoredValueErrorCode | null {
  const { fieldParameters, shopDomain } = options;
  if (document.kind !== fieldParameters.kind) return 'kind-mismatch';
  if (
    fieldParameters.cardinality === 'single' &&
    document.references.length > 1
  ) {
    return 'cardinality-mismatch';
  }
  const ids = document.references.map((reference) => reference.id);
  if (new Set(ids).size !== ids.length) return 'duplicate-reference';
  if (isNonEmptyString(shopDomain) && !sameShop(document.shop, shopDomain)) {
    return 'shop-mismatch';
  }
  return null;
}

function parseReferenceDocumentValue(
  value: Record<string, unknown>,
  rawValue: unknown,
  options: ParseStoredValueOptions,
): ParsedStoredValue {
  const version = versionProblem(value.version);
  if (version) return parseFailure(version, rawValue);
  const document = readReferenceDocument(value);
  if (!document) return parseFailure('invalid-shape', rawValue);
  const problem = documentProblem(document, options);
  if (problem) return parseFailure(problem, rawValue);
  return parseSuccess(
    'reference',
    document.kind,
    entriesFromDocument(document),
    {
      shop: document.shop,
    },
  );
}

// --- Strict reference document validation ---------------------------------

const DOCUMENT_KEYS = ['version', 'shop', 'kind', 'references'] as const;
const SNAPSHOT_KEYS = [
  'title',
  'imageUrl',
  'price',
  'sku',
  'capturedAt',
] as const;

function isShopifyKind(value: unknown): value is ShopifyKind {
  return value === 'product' || value === 'variant' || value === 'collection';
}

/** Strict: only the canonical spelling Shopify returns is accepted. */
function isGidOfKind(value: unknown, kind: ShopifyKind): value is string {
  return typeof value === 'string' && canonicalGidOfKind(value, kind) === value;
}

function isMoney(value: unknown): value is Money {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['amount', 'currencyCode']) &&
    typeof value.amount === 'string' &&
    typeof value.currencyCode === 'string'
  );
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function optionalKey(
  record: Record<string, unknown>,
  key: string,
  check: (value: unknown) => boolean,
): boolean {
  return !(key in record) || check(record[key]);
}

function readSnapshot(value: unknown): ReferenceSnapshot | null {
  if (!isRecord(value) || !hasOnlyKeys(value, SNAPSHOT_KEYS)) return null;
  const valid =
    isString(value.title) &&
    isString(value.capturedAt) &&
    optionalKey(value, 'imageUrl', isString) &&
    optionalKey(value, 'price', isMoney) &&
    optionalKey(value, 'sku', isString);
  return valid ? makeSnapshot(value as SnapshotParts) : null;
}

/** `{ ok: false }` when a `snapshot` key is present but malformed. */
type SnapshotRead =
  | { ok: true; snapshot: ReferenceSnapshot | null }
  | { ok: false };

function readOptionalSnapshot(record: Record<string, unknown>): SnapshotRead {
  if (!('snapshot' in record)) return { ok: true, snapshot: null };
  const snapshot = readSnapshot(record.snapshot);
  return snapshot ? { ok: true, snapshot } : { ok: false };
}

function hasReferenceKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    hasExactKeys(record, keys) || hasExactKeys(record, [...keys, 'snapshot'])
  );
}

function withSnapshot<T extends object>(
  reference: T,
  snapshot: ReferenceSnapshot | null | undefined,
): T | (T & { snapshot: ReferenceSnapshot }) {
  return snapshot ? { ...reference, snapshot } : reference;
}

function readHandleReference(
  raw: unknown,
  kind: 'product' | 'collection',
): ProductReference | null {
  if (!isRecord(raw) || !hasReferenceKeys(raw, ['id', 'handle'])) return null;
  if (!isGidOfKind(raw.id, kind) || !isNonEmptyString(raw.handle)) return null;
  const snapshot = readOptionalSnapshot(raw);
  if (!snapshot.ok) return null;
  return withSnapshot({ id: raw.id, handle: raw.handle }, snapshot.snapshot);
}

function readVariantReference(raw: unknown): VariantReference | null {
  if (
    !isRecord(raw) ||
    !hasReferenceKeys(raw, ['id', 'productId', 'productHandle'])
  ) {
    return null;
  }
  if (
    !isGidOfKind(raw.id, 'variant') ||
    !isGidOfKind(raw.productId, 'product') ||
    !isNonEmptyString(raw.productHandle)
  ) {
    return null;
  }
  const snapshot = readOptionalSnapshot(raw);
  if (!snapshot.ok) return null;
  return withSnapshot(
    { id: raw.id, productId: raw.productId, productHandle: raw.productHandle },
    snapshot.snapshot,
  );
}

function readAll<T>(
  raws: readonly unknown[],
  read: (raw: unknown) => T | null,
): T[] | null {
  const result: T[] = [];
  for (const raw of raws) {
    const item = read(raw);
    if (item === null) return null;
    result.push(item);
  }
  return result;
}

function readReferenceDocument(
  value: Record<string, unknown>,
): ReferenceDocumentV1 | null {
  const { shop, kind, references } = value;
  if (
    !hasExactKeys(value, DOCUMENT_KEYS) ||
    !isNonEmptyString(shop) ||
    !isShopifyKind(kind) ||
    !Array.isArray(references) ||
    references.length === 0
  ) {
    return null;
  }
  if (kind === 'variant') {
    const variants = readAll(references, readVariantReference);
    return variants ? { version: 1, shop, kind, references: variants } : null;
  }
  const items = readAll(references, (raw) => readHandleReference(raw, kind));
  if (!items) return null;
  return kind === 'product'
    ? { version: 1, shop, kind: 'product', references: items }
    : { version: 1, shop, kind: 'collection', references: items };
}

function entriesFromDocument(document: ReferenceDocumentV1): StoredEntry[] {
  if (document.kind === 'variant') {
    return document.references.map((reference) =>
      withSnapshot(
        {
          key: reference.id,
          kind: 'variant' as const,
          id: reference.id,
          handle: reference.productHandle,
          productId: reference.productId,
        },
        reference.snapshot,
      ),
    );
  }
  const kind = document.kind;
  const references: ProductReference[] = document.references;
  return references.map((reference) =>
    withSnapshot(
      { key: reference.id, kind, id: reference.id, handle: reference.handle },
      reference.snapshot,
    ),
  );
}

// ---------------------------------------------------------------------------
// Building and serializing
// ---------------------------------------------------------------------------

/** The entry's GID in canonical form (what the parser accepts back). */
function requireEntryId(entry: StoredEntry, kind: ShopifyKind): string {
  if (entry.kind !== kind) {
    throw new StoredValueBuildError(
      'kind-mismatch',
      `Can't store a ${KIND_LABELS[entry.kind].one} as a ${KIND_LABELS[kind].one}.`,
    );
  }
  if (entry.id === null) {
    throw new StoredValueBuildError(
      'missing-id',
      `The Shopify ID of "${entryFallbackLabel(entry)}" isn't known yet.`,
    );
  }
  const id = canonicalGidOfKind(entry.id, kind);
  if (id === null) {
    throw new StoredValueBuildError(
      'kind-mismatch',
      `"${entry.id}" isn't a ${KIND_LABELS[kind].one} ID.`,
    );
  }
  return id;
}

function requireEntryHandle(entry: StoredEntry): string {
  if (!isNonEmptyString(entry.handle)) {
    throw new StoredValueBuildError(
      'missing-handle',
      `The Shopify handle of "${entryFallbackLabel(entry)}" isn't known yet.`,
    );
  }
  return entry.handle;
}

function requireProductId(entry: StoredEntry): string {
  const productId = canonicalGidOfKind(entry.productId, 'product');
  if (productId === null) {
    throw new StoredValueBuildError(
      'missing-product-id',
      `The product of variant "${entryFallbackLabel(entry)}" isn't known yet.`,
    );
  }
  return productId;
}

function snapshotFor(
  entry: StoredEntry,
  includeSnapshot: boolean,
): ReferenceSnapshot | null {
  return includeSnapshot && entry.snapshot
    ? makeSnapshot(entry.snapshot)
    : null;
}

function handleReferenceFromEntry(
  entry: StoredEntry,
  kind: 'product' | 'collection',
  includeSnapshot: boolean,
): ProductReference | CollectionReference {
  return withSnapshot(
    { id: requireEntryId(entry, kind), handle: requireEntryHandle(entry) },
    snapshotFor(entry, includeSnapshot),
  );
}

function variantReferenceFromEntry(
  entry: StoredEntry,
  includeSnapshot: boolean,
): VariantReference {
  return withSnapshot(
    {
      id: requireEntryId(entry, 'variant'),
      productId: requireProductId(entry),
      productHandle: requireEntryHandle(entry),
    },
    snapshotFor(entry, includeSnapshot),
  );
}

export type BuildReferenceDocumentOptions = {
  snapshot?: boolean;
  /**
   * The field's cardinality. With `'single'`, more than one entry (after
   * dedupe) throws `too-many-entries`, since the parser would reject that
   * document as a `cardinality-mismatch`. Omitted means no limit.
   */
  cardinality?: Cardinality;
};

function requireCardinality(
  entries: readonly StoredEntry[],
  cardinality: Cardinality | undefined,
): void {
  if (cardinality === 'single' && entries.length > 1) {
    throw new StoredValueBuildError(
      'too-many-entries',
      `A single-value field holds one item, not ${entries.length}.`,
    );
  }
}

/**
 * Builds a reference document (key order `version, shop, kind, references`).
 * Null when there are no entries; later duplicates are dropped. Throws
 * `StoredValueBuildError` when an entry lacks its ID, handle or product, or
 * when a single-value field gets several entries.
 */
export function buildReferenceDocument(
  kind: ShopifyKind,
  shop: string,
  entries: readonly StoredEntry[],
  options: BuildReferenceDocumentOptions = {},
): ReferenceDocumentV1 | null {
  const unique = dedupeEntries(entries);
  if (unique.length === 0) return null;
  requireCardinality(unique, options.cardinality);
  if (!isNonEmptyString(shop)) {
    throw new StoredValueBuildError(
      'missing-shop',
      'A reference document needs the shop domain.',
    );
  }
  const includeSnapshot = options.snapshot === true;
  if (kind === 'variant') {
    const references = unique.map((entry) =>
      variantReferenceFromEntry(entry, includeSnapshot),
    );
    return { version: 1, shop, kind, references };
  }
  const references = unique.map((entry) =>
    handleReferenceFromEntry(entry, kind, includeSnapshot),
  );
  return kind === 'product'
    ? { version: 1, shop, kind: 'product', references }
    : { version: 1, shop, kind: 'collection', references };
}

const FIELD_TYPE_BY_FORMAT: Record<StorageFormat, FieldType> = {
  handle: 'string',
  gid: 'string',
  reference: 'json',
  legacyProductJson: 'json',
};

export type SerializeStoredValueArgs = {
  fieldType: FieldType;
  format: StorageFormat;
  kind: ShopifyKind;
  shop: string;
  entries: readonly StoredEntry[];
  snapshot?: boolean;
  /**
   * The field's cardinality. Pass it so a single-value reference field never
   * gets a document with several references (`too-many-entries`). The
   * handle, GID and legacy formats always hold exactly one item.
   */
  cardinality?: Cardinality;
  /** Required for `legacyProductJson`: the fresh 1.x JSON to write. */
  legacyProduct?: LegacyProductJson | null;
};

function singleEntry(
  entries: readonly StoredEntry[],
  kind: ShopifyKind,
  format: StorageFormat,
): StoredEntry {
  const [entry] = entries;
  if (entries.length !== 1 || entry === undefined) {
    throw new StoredValueBuildError(
      'too-many-entries',
      `The ${format} format holds exactly one item, not ${entries.length}.`,
    );
  }
  if (entry.kind !== kind) {
    throw new StoredValueBuildError(
      'kind-mismatch',
      `Can't store a ${KIND_LABELS[entry.kind].one} as a ${KIND_LABELS[kind].one}.`,
    );
  }
  return entry;
}

function serializeHandle(
  kind: ShopifyKind,
  entries: readonly StoredEntry[],
): string {
  if (kind === 'variant') {
    throw new StoredValueBuildError(
      'format-mismatch',
      "Variants can't be stored as a handle.",
    );
  }
  return requireEntryHandle(singleEntry(entries, kind, 'handle'));
}

function serializeLegacyProduct(
  kind: ShopifyKind,
  entries: readonly StoredEntry[],
  legacyProduct: LegacyProductJson | null | undefined,
): string {
  if (kind !== 'product') {
    throw new StoredValueBuildError(
      'format-mismatch',
      'Legacy product JSON can only hold a product.',
    );
  }
  singleEntry(entries, kind, 'legacyProductJson');
  if (!legacyProduct) {
    throw new StoredValueBuildError(
      'missing-legacy-product',
      'Legacy product JSON needs the product data to write.',
    );
  }
  return serializeLegacyProductJson(legacyProduct);
}

/**
 * The exact value to pass to `ctx.setFieldValue`, or null when there are no
 * entries. Throws `StoredValueBuildError` when the format doesn't fit the field
 * type or required data is missing.
 */
export function serializeStoredValue(
  args: SerializeStoredValueArgs,
): string | null {
  const { fieldType, format, kind } = args;
  if (FIELD_TYPE_BY_FORMAT[format] !== fieldType) {
    throw new StoredValueBuildError(
      'format-mismatch',
      `A ${fieldType} field can't store the ${format} format.`,
    );
  }
  const entries = dedupeEntries(args.entries);
  if (entries.length === 0) return null;
  switch (format) {
    case 'handle':
      return serializeHandle(kind, entries);
    case 'gid':
      return requireEntryId(singleEntry(entries, kind, 'gid'), kind);
    case 'legacyProductJson':
      return serializeLegacyProduct(kind, entries, args.legacyProduct);
    case 'reference': {
      const document = buildReferenceDocument(kind, args.shop, entries, {
        snapshot: args.snapshot,
        cardinality: args.cardinality,
      });
      return document ? JSON.stringify(document, null, 2) : null;
    }
  }
}

// ---------------------------------------------------------------------------
// Convert checks
// ---------------------------------------------------------------------------

function maxEntriesFor(params: FieldParametersV1): number {
  if (params.format !== 'reference' || params.cardinality === 'single') {
    return 1;
  }
  return typeof params.max === 'number' && params.max > 0
    ? params.max
    : Number.POSITIVE_INFINITY;
}

/**
 * Why `entries` can't be saved with these field settings, or null when they
 * can. Checks structure only (kinds, counts, format limits): IDs and handles
 * missing before hydration are checked when serializing.
 */
export function storeEntriesProblem(
  params: FieldParametersV1,
  entries: readonly StoredEntry[],
): string | null {
  const unique = dedupeEntries(entries);
  const label = KIND_LABELS[params.kind];
  const otherKind = unique.find((entry) => entry.kind !== params.kind);
  if (otherKind) {
    return `This field picks ${label.many}, so it can't hold a ${KIND_LABELS[otherKind.kind].one}.`;
  }
  if (params.format === 'handle' && params.kind === 'variant') {
    return "Product variants can't be saved as a handle. Save them as a Shopify ID instead.";
  }
  if (params.format === 'legacyProductJson' && params.kind !== 'product') {
    return 'Legacy product JSON can only hold a product.';
  }
  const max = maxEntriesFor(params);
  if (unique.length > max) {
    return max === 1
      ? `This field holds one ${label.one}, but the value has ${unique.length}.`
      : `This field holds up to ${max} ${label.many}, but the value has ${unique.length}.`;
  }
  return null;
}

export function canStoreEntries(
  params: FieldParametersV1,
  entries: readonly StoredEntry[],
): boolean {
  return storeEntriesProblem(params, entries) === null;
}

// ---------------------------------------------------------------------------
// Live example for the field config screen
// ---------------------------------------------------------------------------

/** Fixed so the example doesn't change on every render. */
export const EXAMPLE_CAPTURED_AT = '2026-10-03T12:00:00Z';

// Real nodes recorded from the demo store on 2026-10-03 (Storefront 2026-10,
// fragments from queries.ts). Alt texts are left out; values never use them.

const SNOWBOARD_IMAGE =
  'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d';

const EXAMPLE_PRODUCTS: ProductSummary[] = [
  {
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
      url: `${SNOWBOARD_IMAGE}_400x400.jpg?v=1741717811`,
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
  },
  {
    __typename: 'Product',
    id: 'gid://shopify/Product/10080752337242',
    handle: 'the-collection-snowboard-liquid',
    title: 'The Collection Snowboard: Liquid',
    vendor: 'Hydrogen Vendor',
    productType: 'snowboard',
    availableForSale: true,
    onlineStoreUrl: null,
    updatedAt: '2026-07-18T23:38:45Z',
    featuredImage: {
      url: 'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_b13ad453-477c-4ed1-9b43-81f3345adfd6_400x400.jpg?v=1741717812',
      altText: null,
    },
    priceRange: {
      minVariantPrice: { amount: '749.95', currencyCode: 'EUR' },
      maxVariantPrice: { amount: '749.95', currencyCode: 'EUR' },
    },
    compareAtPriceRange: {
      maxVariantPrice: { amount: '0.0', currencyCode: 'EUR' },
    },
    variantsCount: { count: 1 },
    sku: null,
  },
];

const EXAMPLE_VARIANTS: VariantSummary[] = [
  {
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
    image: {
      url: `${SNOWBOARD_IMAGE}_200x200.jpg?v=1741717811`,
      altText: null,
    },
    product: {
      id: 'gid://shopify/Product/10080752009562',
      handle: 'the-complete-snowboard',
      title: 'The Complete Snowboard',
      vendor: 'Snowboard Vendor',
      onlineStoreUrl: null,
      featuredImage: {
        url: `${SNOWBOARD_IMAGE}_200x200.jpg?v=1741717811`,
        altText: null,
      },
    },
  },
  {
    __typename: 'ProductVariant',
    id: 'gid://shopify/ProductVariant/50698338337114',
    title: 'Default Title',
    sku: 'sku-managed-1',
    barcode: null,
    availableForSale: true,
    currentlyNotInStock: false,
    selectedOptions: [{ name: 'Title', value: 'Default Title' }],
    price: { amount: '629.95', currencyCode: 'EUR' },
    compareAtPrice: null,
    image: {
      url: 'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_9129b69a-0c7b-4f66-b6cf-c4222f18028a_200x200.jpg?v=1741717812',
      altText: null,
    },
    product: {
      id: 'gid://shopify/Product/10080752271706',
      handle: 'the-multi-managed-snowboard',
      title: 'The Multi-managed Snowboard',
      vendor: 'Multi-managed Vendor',
      onlineStoreUrl: null,
      featuredImage: {
        url: 'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_9129b69a-0c7b-4f66-b6cf-c4222f18028a_200x200.jpg?v=1741717812',
        altText: null,
      },
    },
  },
];

const EXAMPLE_COLLECTIONS: CollectionSummary[] = [
  {
    __typename: 'Collection',
    id: 'gid://shopify/Collection/645260968282',
    handle: 'frontpage',
    title: 'Home page',
    updatedAt: '2026-07-19T00:46:43Z',
    onlineStoreUrl: null,
    image: null,
  },
  {
    __typename: 'Collection',
    id: 'gid://shopify/Collection/645261132122',
    handle: 'hydrogen',
    title: 'Hydrogen',
    updatedAt: '2026-07-19T00:46:43Z',
    onlineStoreUrl: null,
    image: null,
  },
];

const EXAMPLE_NODES: Record<ShopifyKind, readonly ShopifyNode[]> = {
  product: EXAMPLE_PRODUCTS,
  variant: EXAMPLE_VARIANTS,
  collection: EXAMPLE_COLLECTIONS,
};

/** The Complete Snowboard through the `LegacyProduct` fragment. */
const EXAMPLE_LEGACY_NODE: LegacyProductNode = {
  id: 'gid://shopify/Product/10080752009562',
  title: 'The Complete Snowboard',
  handle: 'the-complete-snowboard',
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
          src: `${SNOWBOARD_IMAGE}.jpg?v=1741717811`,
          previewSrc: `${SNOWBOARD_IMAGE}_200x200.jpg?v=1741717811`,
        },
      },
    ],
  },
};

function exampleCount(params: FieldParametersV1): number {
  if (params.format !== 'reference' || params.cardinality !== 'multiple') {
    return 1;
  }
  return params.max === 1 ? 1 : 2;
}

/**
 * The exact value a field with these settings would store, built from demo
 * store data with the same serializers the editor uses. Returns `''` for
 * settings that can't store anything (for example variants as handles).
 */
export function buildExampleStoredValue(
  fieldType: FieldType,
  params: FieldParametersV1,
  shopDomain?: string,
): string {
  const includeSnapshot = params.format === 'reference' && params.snapshot;
  const entries = EXAMPLE_NODES[params.kind]
    .slice(0, exampleCount(params))
    .map((node) =>
      entryFromNode(node, {
        snapshot: includeSnapshot,
        capturedAt: EXAMPLE_CAPTURED_AT,
      }),
    );
  const shop =
    normalizedString(shopDomain) ||
    normalizedString(params.shopDomain) ||
    DEMO_STORE.shopDomain;
  try {
    return (
      serializeStoredValue({
        fieldType,
        format: params.format,
        kind: params.kind,
        shop,
        entries,
        snapshot: includeSnapshot,
        cardinality: params.cardinality,
        legacyProduct: buildLegacyProductJson(EXAMPLE_LEGACY_NODE),
      }) ?? ''
    );
  } catch (error) {
    if (error instanceof StoredValueBuildError) return '';
    throw error;
  }
}
