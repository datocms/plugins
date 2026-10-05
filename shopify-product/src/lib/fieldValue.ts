/**
 * Pure helpers behind the field editor: copy, limits, picker round trips,
 * row models and the value writes that follow an editor action. Nothing here
 * calls `ctx`; the editor decides when a value is written.
 */

import type {
  Cardinality,
  FieldParametersV1,
  FieldType,
  LegacyProductJson,
  LegacyProductNode,
  PickerModalResult,
  PickerSelectedEntry,
  ShopifyContext,
  ShopifyKind,
  ShopifyNode,
  StorageFormat,
  StoredEntry,
  StoredValueErrorCode,
} from '../types';
import {
  adminUrl,
  adminUrlForNode,
  nodeKind,
  nodeMeta,
  shopSubdomain,
  storefrontUrl,
} from './format';
import { isNonEmptyString, isRecord } from './guards';
import { buildLegacyProductJson, type LegacyDriftField } from './legacy';
import {
  canonicalGid,
  dedupeEntries,
  detectHandleDrift,
  entryFromNode,
  entryKey,
  StoredValueBuildError,
  serializeStoredValue,
  storeEntriesProblem,
} from './references';
import {
  describeError,
  ShopifyClientError,
  type ShopifyErrorCode,
} from './shopifyClient';

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const KIND_NOUNS: Record<ShopifyKind, { one: string; many: string }> = {
  product: { one: 'product', many: 'products' },
  variant: { one: 'variant', many: 'variants' },
  collection: { one: 'collection', many: 'collections' },
};

/** `product` / `products`, `variant` / `variants`, `collection` / `collections`. */
export function kindNoun(kind: ShopifyKind, count = 1): string {
  return count === 1 ? KIND_NOUNS[kind].one : KIND_NOUNS[kind].many;
}

/** "No product selected", "No variants selected". */
export function emptyLabel(
  kind: ShopifyKind,
  cardinality: Cardinality,
): string {
  const noun = cardinality === 'multiple' ? kindNoun(kind, 2) : kindNoun(kind);
  return `No ${noun} selected`;
}

/** The picker modal title: "Choose a product", "Choose variants". */
export function pickerTitle(
  kind: ShopifyKind,
  cardinality: Cardinality,
): string {
  return cardinality === 'multiple'
    ? `Choose ${kindNoun(kind, 2)}`
    : `Choose a ${kindNoun(kind)}`;
}

/** "Add products", "Add variants", "Add collections". */
export function addLabel(kind: ShopifyKind): string {
  return `Add ${kindNoun(kind, 2)}`;
}

/** The tooltip on the inert drag handle of a multiple field holding one item. */
export function reorderUnavailableReason(kind: ShopifyKind): string {
  return `Add another ${kindNoun(kind)} to reorder`;
}

/** "Couldn't load the product", "Couldn't load the collections". */
export function loadErrorTitle(kind: ShopifyKind, count: number): string {
  return `Couldn't load the ${kindNoun(kind, count)}`;
}

export const FORMAT_LABELS: Record<StorageFormat, string> = {
  handle: 'a Shopify handle',
  gid: 'a Shopify ID',
  reference: 'a reference document',
  legacyProductJson: 'legacy product JSON',
};

/** True when a valid value is stored in another format than the field's settings. */
export function isFormatMismatch(
  stored: StorageFormat | null,
  configured: StorageFormat,
): stored is StorageFormat {
  return stored !== null && stored !== configured;
}

/** "Saved as a Shopify handle. This field now saves a reference document." */
export function formatMismatchMessage(
  stored: StorageFormat,
  configured: StorageFormat,
): string {
  return `Saved as ${FORMAT_LABELS[stored]}. This field now saves ${FORMAT_LABELS[configured]}.`;
}

/** "title", "title and price", "title, price and image". */
export function listSentence(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  const head = items.slice(0, -1).join(', ');
  return `${head} and ${items[items.length - 1]}`;
}

const DRIFT_FIELD_ORDER: readonly LegacyDriftField[] = [
  'title',
  'price',
  'image',
  'handle',
];

/** "The saved title and price no longer match Shopify." */
export function legacyDriftSummary(
  fields: readonly LegacyDriftField[],
): string {
  const ordered = DRIFT_FIELD_ORDER.filter((field) => fields.includes(field));
  const verb = ordered.length === 1 ? 'matches' : 'match';
  return `The saved ${listSentence(ordered)} no longer ${verb} Shopify.`;
}

export const UNRESOLVED_MESSAGE =
  'Not visible to the storefront: it may be unpublished from the Headless channel, archived, or deleted.';

/** `UNRESOLVED_MESSAGE` for collections, which can't be archived. */
export const UNRESOLVED_COLLECTION_MESSAGE =
  'Not visible to the storefront: it may be unpublished from the Headless channel, or deleted.';

/**
 * Why an item can't be shown. The field editor, the picker and the field
 * settings use the same sentence.
 */
export function notVisibleMessage(kind: ShopifyKind): string {
  return kind === 'collection'
    ? UNRESOLVED_COLLECTION_MESSAGE
    : UNRESOLVED_MESSAGE;
}

/**
 * Why an entry doesn't resolve. Entries saved only as a handle (1.x string
 * fields, handles in Shopify ID fields) most often broke because the handle
 * was renamed in Shopify, so their copy leads with that.
 */
export function unresolvedMessage(entry: StoredEntry): string {
  if (entry.id !== null || !isNonEmptyString(entry.handle)) {
    return notVisibleMessage(entry.kind);
  }
  const noun = kindNoun(entry.kind);
  const states =
    entry.kind === 'collection'
      ? 'unpublished from the Headless channel, or deleted'
      : 'unpublished from the Headless channel, archived, or deleted';
  return `No ${noun} with this handle is visible to the storefront: the handle may have changed in Shopify, or the ${noun} may be ${states}.`;
}

export const PERSIST_FAILED_MESSAGE = "Couldn't save the Shopify selection!";

export const PICKER_FAILED_MESSAGE = "Couldn't open the Shopify picker!";

export const CLEAR_FAILED_MESSAGE = "Couldn't clear the value!";

/**
 * Escapes text for `ctx.alert` and `ctx.notice`, which render sanitized HTML:
 * Shopify's error messages and saved titles can hold `<`, `>` and `&`.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const INVALID_VALUE_TITLES: Partial<Record<StoredValueErrorCode, string>> = {
  'shop-mismatch': 'Saved for another Shopify store',
  'unsupported-version': 'Saved by a newer plugin version',
};

/** The invalid-value callout's title; the cause follows in its body. */
export function invalidValueTitle(code: StoredValueErrorCode): string {
  return INVALID_VALUE_TITLES[code] ?? "Couldn't read the saved value";
}

const CONNECTION_PROBLEMS: ReadonlySet<ShopifyErrorCode> = new Set([
  'unauthorized',
  'forbidden',
  'store-locked',
  'shop-not-found',
]);

/**
 * A load error that only the plugin settings can fix (the token, its
 * permissions, the store address), so trying again won't help.
 */
export function isConnectionProblem(error: unknown): boolean {
  return (
    error instanceof ShopifyClientError && CONNECTION_PROBLEMS.has(error.code)
  );
}

const CONNECTION_CAUSES: Partial<Record<ShopifyErrorCode, string>> = {
  unauthorized: 'Shopify rejected the Storefront access token.',
  forbidden: "This token isn't allowed to read products.",
};

/**
 * A load error in plain words. Roles that can't open the plugin settings
 * are asked to contact an administrator instead of being told to fix them.
 */
export function loadErrorMessage(
  error: unknown,
  canEditSchema: boolean,
): string {
  if (
    canEditSchema ||
    !isConnectionProblem(error) ||
    !(error instanceof ShopifyClientError)
  ) {
    return describeError(error);
  }
  const cause = CONNECTION_CAUSES[error.code] ?? describeError(error);
  return `${cause} Ask an administrator to check the Shopify connection.`;
}

// Screen-reader announcements after an editor action (a `role="status"` region).

/** "Added 2 products", "Removed 1 product", "Added 1 product and removed 2 products". */
export function selectionChangeMessage(
  kind: ShopifyKind,
  added: number,
  removed: number,
): string | null {
  const addedText = `${added} ${kindNoun(kind, added)}`;
  const removedText = `${removed} ${kindNoun(kind, removed)}`;
  if (added > 0 && removed > 0) {
    return `Added ${addedText} and removed ${removedText}`;
  }
  if (added > 0) return `Added ${addedText}`;
  if (removed > 0) return `Removed ${removedText}`;
  return null;
}

/** How many of `current` are still in `next` (same key or GID). */
export function countKept(
  next: readonly StoredEntry[],
  current: readonly StoredEntry[],
): number {
  return current.filter((entry) => {
    const id = canonicalGid(entry.id);
    return next.some(
      (item) =>
        item.key === entry.key || (id !== null && canonicalGid(item.id) === id),
    );
  }).length;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export type LimitsSummary = {
  /** "3 of 10" with a maximum, "3 selected · at least 2" with only a minimum. */
  counter: string | null;
  /** "Add at least 2 products" while below the minimum. */
  belowMin: string | null;
  /**
   * "Remove 2 products, as this field holds up to 3" when the value holds
   * more than the maximum (the maximum was lowered after it was saved).
   */
  aboveMax: string | null;
  atMax: boolean;
  /** Why "Add" is disabled at the maximum. */
  atMaxReason: string | null;
};

function positiveLimit(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function counterText(
  count: number,
  min: number | null,
  max: number | null,
): string | null {
  if (max !== null) return `${count} of ${max}`;
  if (min !== null) return `${count} selected · at least ${min}`;
  return null;
}

/** Counter, minimum and maximum hints for multiple fields. */
export function limitsSummary(
  params: FieldParametersV1,
  count: number,
): LimitsSummary {
  const none = {
    counter: null,
    belowMin: null,
    aboveMax: null,
    atMax: false,
    atMaxReason: null,
  };
  if (params.cardinality !== 'multiple') return none;
  const min = positiveLimit(params.min);
  const max = positiveLimit(params.max);
  const atMax = max !== null && count >= max;
  const extra = max !== null ? count - max : 0;
  return {
    counter: counterText(count, min, max),
    belowMin:
      min !== null && count < min
        ? `Add at least ${min} ${kindNoun(params.kind, min)}`
        : null,
    aboveMax:
      extra > 0
        ? `Remove ${extra} ${kindNoun(params.kind, extra)}, as this field holds up to ${max}`
        : null,
    atMax,
    atMaxReason: atMax
      ? `You cannot add more ${kindNoun(params.kind, 2)}, as this field holds up to ${max}`
      : null,
  };
}

// ---------------------------------------------------------------------------
// Fallback display for entries Shopify can't show
// ---------------------------------------------------------------------------

export type EntryFallback = {
  /** Snapshot or saved title, else the handle, else the GID. */
  label: string;
  /** The label is a handle or an ID: render it in monospace. */
  labelIsCode: boolean;
  /** A secondary identity line (handle or GID) when the label is a title. */
  identity: string | null;
  imageUrl: string | null;
};

function nonEmpty(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

/**
 * The identities to show, most specific first: products and collections by
 * handle then GID; variants by GID, since their handle is the product's.
 */
function identities(entry: StoredEntry): [string | null, string | null] {
  const handle = nonEmpty(entry.handle);
  return entry.kind === 'variant' ? [entry.id, handle] : [handle, entry.id];
}

/**
 * What to show for an entry without live data: the snapshot title (or the
 * title saved in a 1.x value), else the handle, else the GID.
 */
export function entryFallback(
  entry: StoredEntry,
  legacyProduct?: Partial<LegacyProductJson> | null,
): EntryFallback {
  const title =
    nonEmpty(entry.snapshot?.title) ?? nonEmpty(legacyProduct?.title);
  const imageUrl =
    nonEmpty(entry.snapshot?.imageUrl) ??
    nonEmpty(legacyProduct?.previewImageUrl) ??
    nonEmpty(legacyProduct?.imageUrl);
  const [primary, secondary] = identities(entry);
  if (title) {
    return {
      label: title,
      labelIsCode: false,
      identity: primary ?? secondary,
      imageUrl,
    };
  }
  return {
    label: primary ?? secondary ?? entry.key,
    labelIsCode: true,
    identity: primary ? secondary : null,
    imageUrl,
  };
}

// ---------------------------------------------------------------------------
// Row models
// ---------------------------------------------------------------------------

export type HydrationStatus = 'loading' | 'ready' | 'error';

export type RowState =
  /** Live data is shown. */
  | 'resolved'
  /** Shopify answered `null`: not visible to the storefront. */
  | 'unresolved'
  /** Still loading while other rows are visible. */
  | 'pending'
  /** Loading failed; only the saved data is known. */
  | 'unknown';

export type RowModel = {
  key: string;
  entry: StoredEntry;
  state: RowState;
  node: ShopifyNode | null;
  fallback: EntryFallback;
  /** The live handle (in the shop's primary language) when it differs from the saved one. */
  handleDrift: string | null;
  adminUrl: string | null;
  /** A Shopify admin search for the handle, for entries saved without an ID. */
  adminSearchUrl: string | null;
  storefrontUrl: string | null;
};

export type RowModelOptions = {
  nodes: ReadonlyMap<string, ShopifyNode | null>;
  status: HydrationStatus;
  shopDomain: string;
  legacyProduct?: Partial<LegacyProductJson> | null;
  /** Off for 1.x JSON, whose handle is refreshed with the rest of the blob. */
  checkHandleDrift: boolean;
  /**
   * The same entries loaded with no market, to compare handles against when
   * `nodes` were loaded in a language: Shopify translates handles, and saved
   * handles are always the shop's primary-language ones. Entries missing here
   * (not loaded yet, or not visible without a market) report no drift.
   * Omitted: `nodes` are compared directly.
   */
  handleNodes?: ReadonlyMap<string, ShopifyNode | null>;
};

function rowState(
  nodes: ReadonlyMap<string, ShopifyNode | null>,
  key: string,
  status: HydrationStatus,
): RowState {
  if (nodes.has(key)) return nodes.get(key) ? 'resolved' : 'unresolved';
  return status === 'error' ? 'unknown' : 'pending';
}

function entryAdminUrl(shopDomain: string, entry: StoredEntry): string | null {
  if (!entry.id) return null;
  return adminUrl(shopDomain, {
    kind: entry.kind,
    id: entry.id,
    productId: entry.productId ?? null,
  });
}

/**
 * The Shopify admin's product (or collection) search for an entry saved
 * only as a handle, so editors can find what it was renamed to. Null for
 * entries with an ID, which link to the item itself.
 */
export function adminSearchUrl(
  shopDomain: string,
  entry: StoredEntry,
): string | null {
  const handle = nonEmpty(entry.handle);
  const subdomain = shopSubdomain(shopDomain);
  if (entry.id !== null || entry.kind === 'variant' || !handle || !subdomain) {
    return null;
  }
  const section = entry.kind === 'collection' ? 'collections' : 'products';
  return `https://admin.shopify.com/store/${subdomain}/${section}?query=${encodeURIComponent(handle)}`;
}

function rowHandleDrift(
  entry: StoredEntry,
  node: ShopifyNode | null,
  options: RowModelOptions,
): string | null {
  if (!node || !options.checkHandleDrift) return null;
  if (!options.handleNodes) return detectHandleDrift(entry, node);
  const primary = options.handleNodes.get(entry.key);
  return primary ? detectHandleDrift(entry, primary) : null;
}

export function buildRowModel(
  entry: StoredEntry,
  options: RowModelOptions,
): RowModel {
  const state = rowState(options.nodes, entry.key, options.status);
  const node =
    state === 'resolved' ? (options.nodes.get(entry.key) ?? null) : null;
  return {
    key: entry.key,
    entry,
    state,
    node,
    fallback: entryFallback(entry, options.legacyProduct),
    handleDrift: rowHandleDrift(entry, node, options),
    adminUrl: node
      ? adminUrlForNode(options.shopDomain, node)
      : entryAdminUrl(options.shopDomain, entry),
    adminSearchUrl: node ? null : adminSearchUrl(options.shopDomain, entry),
    storefrontUrl: node ? storefrontUrl(node) : null,
  };
}

/**
 * The row's meta line. Variant titles already carry their option values
 * ("Classic Tee — Black / M"), so variants show the vendor and SKU instead;
 * products show `vendor · product type` and collections their handle, as
 * the picker does (`nodeMeta`).
 */
export function rowMeta(node: ShopifyNode): string {
  if (node.__typename !== 'ProductVariant') return nodeMeta(node);
  const sku = node.sku?.trim();
  return [node.product.vendor.trim(), sku ? `SKU ${sku}` : '']
    .filter(Boolean)
    .join(' · ');
}

/** True when no row has anything to show yet (the first load). */
export function isFirstLoad(rows: readonly RowModel[]): boolean {
  return rows.length > 0 && rows.every((row) => row.state === 'pending');
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * `entries` in the order of `keys`, or null when the keys don't describe the
 * same set of entries (the saved value changed underneath).
 */
export function arrangeByKeys<T extends { key: string }>(
  entries: readonly T[],
  keys: readonly string[] | null,
): T[] | null {
  if (!keys || keys.length !== entries.length) return null;
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  if (byKey.size !== entries.length) return null;
  const arranged: T[] = [];
  for (const key of keys) {
    const entry = byKey.get(key);
    if (!entry) return null;
    arranged.push(entry);
  }
  return arranged;
}

/** Order-independent identity of a set of entries (what hydration depends on). */
export function membershipSignature(entries: readonly StoredEntry[]): string {
  return entries
    .map((entry) => entry.key)
    .sort()
    .join('\n');
}

// ---------------------------------------------------------------------------
// Picker round trip
// ---------------------------------------------------------------------------

/** The picker's view of the current selection, in order. */
export function toPickerSelected(
  rows: readonly RowModel[],
): PickerSelectedEntry[] {
  return rows.map((row) => ({
    key: row.key,
    id: row.node?.id ?? row.entry.id,
    node: row.node,
    fallbackLabel: row.fallback.label,
  }));
}

const NODE_TYPENAMES = new Set(['Product', 'ProductVariant', 'Collection']);

function isShopifyNode(value: unknown): value is ShopifyNode {
  return (
    isRecord(value) &&
    typeof value.__typename === 'string' &&
    NODE_TYPENAMES.has(value.__typename) &&
    typeof value.id === 'string'
  );
}

function isSelectedEntry(value: unknown): value is PickerSelectedEntry {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    (value.id === null || typeof value.id === 'string') &&
    (value.node === null || isShopifyNode(value.node)) &&
    typeof value.fallbackLabel === 'string'
  );
}

function readContext(value: unknown): ShopifyContext | undefined {
  if (!isRecord(value)) return undefined;
  const context: ShopifyContext = {};
  if (typeof value.country === 'string') context.country = value.country;
  if (typeof value.language === 'string') context.language = value.language;
  return context;
}

/** The picker's answer, or null for cancel (✕, Esc, `null`) and junk. */
export function readPickerResult(value: unknown): PickerModalResult | null {
  if (!isRecord(value) || !Array.isArray(value.selected)) return null;
  const context = readContext(value.context);
  return {
    selected: value.selected.filter(isSelectedEntry),
    ...(context ? { context } : {}),
  };
}

export type SelectionOptions = {
  kind: ShopifyKind;
  /** The field's snapshot setting (reference documents only). */
  snapshot: boolean;
  capturedAt: string;
};

function findCurrent(
  current: readonly StoredEntry[],
  item: PickerSelectedEntry,
): StoredEntry | undefined {
  const id = canonicalGid(item.id);
  return current.find(
    (entry) =>
      entry.key === item.key || (id !== null && canonicalGid(entry.id) === id),
  );
}

/**
 * A picked item as a stored entry. Items that were already selected keep
 * what was saved for them: their handle (only "Update" changes it) and any
 * snapshot, whatever the field's snapshot setting is now. Their other parts
 * come from the node, so an item saved as a bare handle or ID gains an ID or
 * handle when the configured format needs one.
 */
function entryFromPicked(
  node: ShopifyNode,
  existing: StoredEntry | undefined,
  options: SelectionOptions,
): StoredEntry {
  const entry = entryFromNode(node, {
    snapshot: options.snapshot && !existing?.snapshot,
    capturedAt: options.capturedAt,
  });
  if (!existing) return entry;
  return {
    ...entry,
    handle: nonEmpty(existing.handle) ? existing.handle : entry.handle,
    ...(existing.snapshot ? { snapshot: existing.snapshot } : {}),
  };
}

/**
 * Maps the picker's selection back to stored entries: picked items from
 * their nodes, unresolved items the editor kept as they were saved.
 */
export function entriesFromSelection(
  selected: readonly PickerSelectedEntry[],
  current: readonly StoredEntry[],
  options: SelectionOptions,
): StoredEntry[] {
  const entries: StoredEntry[] = [];
  for (const item of selected) {
    const existing = findCurrent(current, item);
    if (item.node && nodeKind(item.node) === options.kind) {
      entries.push(entryFromPicked(item.node, existing, options));
    } else if (existing) {
      entries.push(existing);
    }
  }
  return dedupeEntries(entries);
}

/** Nodes the editor picked that weren't already in the field. */
export function newlyPickedNodes(
  selected: readonly PickerSelectedEntry[],
  current: readonly StoredEntry[],
): ShopifyNode[] {
  const nodes: ShopifyNode[] = [];
  for (const item of selected) {
    if (item.node && !findCurrent(current, item)) nodes.push(item.node);
  }
  return nodes;
}

/** The handle a node is stored with: the product handle for variants. */
function storedHandleOf(node: ShopifyNode): string {
  return node.__typename === 'ProductVariant'
    ? node.product.handle
    : node.handle;
}

function withStoredHandle(node: ShopifyNode, handle: string): ShopifyNode {
  if (node.__typename === 'ProductVariant') {
    return { ...node, product: { ...node.product, handle } };
  }
  return { ...node, handle };
}

/**
 * `node` with the handle it has in the shop's primary language, taken from
 * the same item loaded with no market (`primary`, keyed by GID). Shopify
 * translates handles in a language context, and a translated handle only
 * resolves in that language, while frontends and the 1.x format expect the
 * primary one. Nodes `primary` doesn't have keep their handle.
 */
export function withPrimaryHandle(
  node: ShopifyNode,
  primary: ReadonlyMap<string, ShopifyNode | null>,
): ShopifyNode {
  const source = primary.get(node.id);
  if (!source) return node;
  const handle = storedHandleOf(source);
  return handle && handle !== storedHandleOf(node)
    ? withStoredHandle(node, handle)
    : node;
}

/** `withPrimaryHandle` for every node of the picker's selection. */
export function selectionWithPrimaryHandles(
  selected: readonly PickerSelectedEntry[],
  primary: ReadonlyMap<string, ShopifyNode | null>,
): PickerSelectedEntry[] {
  return selected.map((item) =>
    item.node ? { ...item, node: withPrimaryHandle(item.node, primary) } : item,
  );
}

/**
 * Nodes the picker returned, keyed like the entries the written value parses
 * back to: by GID, and for products and collections also by handle, since a
 * value saved as a handle has no GID to key it by.
 */
export function nodesFromSelection(
  selected: readonly PickerSelectedEntry[],
): Map<string, ShopifyNode> {
  const nodes = new Map<string, ShopifyNode>();
  for (const item of selected) {
    const node = item.node;
    if (!node) continue;
    nodes.set(node.id, node);
    if (node.__typename !== 'ProductVariant' && isNonEmptyString(node.handle)) {
      nodes.set(entryKey(null, node.handle), node);
    }
  }
  return nodes;
}

export type ReplaceResult =
  | { ok: true; entries: StoredEntry[] }
  | { ok: false; reason: 'duplicate' | 'out-of-range' };

/** Swaps the entry at `index`, refusing an item that is already elsewhere in the list. */
export function replaceEntryAt(
  entries: readonly StoredEntry[],
  index: number,
  replacement: StoredEntry,
): ReplaceResult {
  if (index < 0 || index >= entries.length) {
    return { ok: false, reason: 'out-of-range' };
  }
  const id = canonicalGid(replacement.id);
  const duplicate = entries.some(
    (entry, position) =>
      position !== index &&
      (entry.key === replacement.key ||
        (id !== null && canonicalGid(entry.id) === id)),
  );
  if (duplicate) return { ok: false, reason: 'duplicate' };
  const next = [...entries];
  next[index] = replacement;
  return { ok: true, entries: next };
}

/** The entries with one entry's handle (the product handle for variants) replaced. */
export function withEntryHandle(
  entries: readonly StoredEntry[],
  key: string,
  handle: string,
): StoredEntry[] {
  return entries.map((entry) =>
    entry.key === key ? { ...entry, handle } : entry,
  );
}

/** Entries rebuilt from live nodes (Convert). Null when any entry has no node. */
export function entriesFromNodes(
  entries: readonly StoredEntry[],
  nodes: ReadonlyMap<string, ShopifyNode | null>,
  options: { snapshot: boolean; capturedAt: string },
): StoredEntry[] | null {
  const result: StoredEntry[] = [];
  for (const entry of entries) {
    const node = nodes.get(entry.key);
    if (!node) return null;
    result.push(entryFromNode(node, options));
  }
  return result;
}

/**
 * Why "Convert to new format" can't run yet, or null when it can: the field's
 * structural limits first, then live data for every entry.
 */
export function convertProblem(
  params: FieldParametersV1,
  rows: readonly RowModel[],
): string | null {
  const structural = storeEntriesProblem(
    params,
    rows.map((row) => row.entry),
  );
  if (structural) return structural;
  if (rows.some((row) => row.state === 'unresolved')) {
    return `You cannot convert the value while a ${kindNoun(params.kind)} isn't visible to the storefront`;
  }
  if (rows.some((row) => row.state !== 'resolved')) {
    return 'You cannot convert the value until the Shopify data has loaded';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Writing values
// ---------------------------------------------------------------------------

export type WriteTarget = {
  fieldType: FieldType;
  format: StorageFormat;
  kind: ShopifyKind;
  shop: string;
  cardinality: Cardinality;
  /** Include the snapshots the entries carry (reference documents only). */
  snapshot: boolean;
};

/** Fetches the 1.x source data (`client.legacyProduct`). */
export type LegacyProductLoader = (ref: {
  id: string | null;
  handle: string | null;
}) => Promise<LegacyProductNode | null>;

async function freshLegacyProduct(
  entries: readonly StoredEntry[],
  loadLegacyProduct: LegacyProductLoader,
): Promise<LegacyProductJson | null> {
  const [entry] = entries;
  if (!entry) return null;
  const node = await loadLegacyProduct({ id: entry.id, handle: entry.handle });
  if (!node) {
    throw new StoredValueBuildError(
      'missing-legacy-product',
      "Shopify didn't return this product's data.",
    );
  }
  return buildLegacyProductJson(node);
}

/**
 * The exact value to write for `entries` in `target`'s format (null when
 * empty). Legacy product JSON is rebuilt from fresh Shopify data. Throws
 * `StoredValueBuildError` when the data can't make a valid value.
 */
export async function serializeEntries(
  target: WriteTarget,
  entries: readonly StoredEntry[],
  loadLegacyProduct: LegacyProductLoader,
): Promise<string | null> {
  if (entries.length === 0) return null;
  const legacyProduct =
    target.format === 'legacyProductJson'
      ? await freshLegacyProduct(entries, loadLegacyProduct)
      : null;
  return serializeStoredValue({
    fieldType: target.fieldType,
    format: target.format,
    kind: target.kind,
    shop: target.shop,
    entries,
    snapshot: target.snapshot,
    cardinality: target.cardinality,
    legacyProduct,
  });
}

// ---------------------------------------------------------------------------
// Invalid values
// ---------------------------------------------------------------------------

/** The stored value as text, exactly as saved (strings stay untouched). */
export function rawValueText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw, null, 2) ?? String(raw);
  } catch {
    return String(raw);
  }
}

export const RAW_PREVIEW_LENGTH = 240;
export const RAW_PREVIEW_LINES = 6;

/**
 * At most `maxLines` lines and `maxLength` characters of `text`, and whether
 * anything was cut.
 */
export function previewText(
  text: string,
  maxLength = RAW_PREVIEW_LENGTH,
  maxLines = RAW_PREVIEW_LINES,
): { text: string; truncated: boolean } {
  const lines = text.split('\n');
  const firstLines =
    lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : text;
  const characters = Array.from(firstLines);
  const cut = characters.length > maxLength || firstLines !== text;
  if (!cut) return { text, truncated: false };
  return {
    text: `${characters.slice(0, maxLength).join('')}…`,
    truncated: true,
  };
}

/** The `shop` of a stored reference document, for the shop-mismatch message. */
export function storedDocumentShop(raw: unknown): string | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isRecord(value) && isNonEmptyString(value.shop) ? value.shop : null;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** The plugin settings page, with the sandbox environment prefix when needed. */
export function pluginSettingsPath(args: {
  pluginId: string;
  environment: string;
  isEnvironmentPrimary: boolean;
}): string {
  const prefix = args.isEnvironmentPrimary
    ? ''
    : `/environments/${args.environment}`;
  return `${prefix}/configuration/plugins/${args.pluginId}/edit`;
}
