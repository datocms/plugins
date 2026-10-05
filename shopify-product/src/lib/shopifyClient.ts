/**
 * Storefront API client.
 *
 * - Talks to `https://{shop}/api/{SHOPIFY_STOREFRONT_API_VERSION}/graphql.json`
 *   directly: the Storefront API allows CORS, so there is no proxy.
 * - Dedupes identical in-flight requests and lets every caller abort without
 *   cancelling the request for other callers.
 * - Batches `loadNode(s)` calls made in the same tick into `nodes(ids:)`
 *   requests of at most 250 IDs (DataLoader style).
 * - Caches results in memory plus `sessionStorage`, namespaced by shop, API
 *   version, credential (a hash, never the token) and market context, each
 *   capped at `CACHE_MAX_ENTRIES`. Errors are never cached.
 * - ACCESS_DENIED on an optional scope (tags, inventory) never throws: the
 *   capability is dropped for the session and, when Shopify nulled the whole
 *   response, the query is resent without it. Detected capabilities are
 *   cached like responses, so a new iframe of the same tab doesn't re-probe.
 * - Maps every failure to a typed `ShopifyClientError` with editor-facing copy.
 *   Messages never contain the access token.
 */
import {
  CACHE_MAX_ENTRIES,
  NODE_CACHE_TTL_MS,
  PICKER_PAGE_SIZE,
  SEARCH_CACHE_TTL_MS,
  SHOPIFY_MAX_PAGE_SIZE,
  SHOPIFY_STOREFRONT_API_VERSION,
  VARIANT_PAGE_SIZE,
} from '../constants';
import type {
  CollectionSortKey,
  CollectionSummary,
  ConnectionTestResult,
  LegacyProductNode,
  LocalizationInfo,
  Money,
  Page,
  PageInfo,
  ProductFilterInput,
  ProductOption,
  ProductSortKey,
  ProductSummary,
  ShopifyContext,
  ShopifyFilter,
  ShopifyImage,
  ShopifyKind,
  ShopifyNode,
  StoreCapabilities,
  StoreConnection,
  VariantSummary,
} from '../types';
import { decodeShopifyId, kindOfGid } from './gid';
import { isRecord, normalizedString } from './guards';
import { normalizeCapabilities } from './parameters';
import {
  BASE_FEATURES,
  browseCollectionProductsQuery,
  browseProductsQuery,
  COLLECTION_BY_HANDLE_QUERY,
  COLLECTIONS_QUERY,
  CONNECTION_TEST_QUERY,
  filterValuesQuery,
  hydrateQuery,
  LEGACY_PRODUCT_BY_HANDLE_QUERY,
  LEGACY_PRODUCT_BY_ID_QUERY,
  LOCALIZATION_QUERY,
  PROBE_INVENTORY_QUERY,
  PROBE_TAGS_QUERY,
  productByHandleQuery,
  productVariantsQuery,
  type QueryFeatures,
  skuMatchesQuery,
} from './queries';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ShopifyErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'shop-not-found'
  | 'store-locked'
  | 'shop-unavailable'
  | 'security-rejection'
  | 'throttled'
  | 'graphql'
  | 'network'
  | 'aborted'
  | 'invalid-response';

/** Editor-facing copy per code. `{shop}` is replaced with the shop domain. */
export const SHOPIFY_ERROR_MESSAGES: Record<ShopifyErrorCode, string> = {
  unauthorized:
    'Shopify rejected the Storefront access token. Update it in the plugin settings.',
  forbidden:
    'This token isn\'t allowed to read products. In Shopify → Headless → Storefront API permissions, enable "Read products, variants, and collections".',
  'shop-not-found': 'No Shopify store found at {shop}.',
  'store-locked':
    'This store is password-protected, so the plugin needs a Storefront access token.',
  'shop-unavailable': 'This Shopify store is frozen or locked.',
  'security-rejection':
    'Shopify temporarily blocked these requests. Wait a minute and try again.',
  throttled: 'Shopify is rate-limiting requests. Try again shortly.',
  graphql: 'Shopify returned an error.',
  network: "Couldn't reach Shopify. Check your connection or ad-blocker.",
  aborted: 'The request was cancelled.',
  'invalid-response':
    'Shopify returned an unexpected response. Try again shortly.',
};

export const GENERIC_ERROR_MESSAGE =
  'Something went wrong while talking to Shopify.';

const STORE_LOCKED_MESSAGE = 'Online Store channel is locked';

const CREDENTIAL_HEADER_PATTERN =
  /((?:X-Shopify-Storefront-Access-Token|Shopify-Storefront-Private-Token|storefrontAccessToken|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi;
const BEARER_PATTERN = /(Bearer\s+)[^\s"',;}]+/gi;
const ADMIN_TOKEN_PATTERN = /\bshp(?:at|ca|pa|ss)_[A-Za-z0-9]+/g;
const MIN_REDACTABLE_TOKEN_LENGTH = 4;

/** Removes access tokens from any text that could reach a message or a log. */
export function redactCredentials(text: string, token?: string): string {
  let redacted = text
    .replace(CREDENTIAL_HEADER_PATTERN, '$1[REDACTED]')
    .replace(BEARER_PATTERN, '$1[REDACTED]')
    .replace(ADMIN_TOKEN_PATTERN, '[REDACTED]');
  const secret = token?.trim() ?? '';
  if (secret.length >= MIN_REDACTABLE_TOKEN_LENGTH) {
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

function userMessageFor(code: ShopifyErrorCode, shop?: string): string {
  return SHOPIFY_ERROR_MESSAGES[code].replace(
    '{shop}',
    shop && shop.length > 0 ? shop : 'this address',
  );
}

export type ShopifyClientErrorOptions = {
  status?: number | null;
  shop?: string;
  /** Overrides the standard copy (GraphQL errors show Shopify's message). */
  userMessage?: string;
  /** Redacted from `message` and `userMessage`. */
  token?: string;
  cause?: unknown;
};

export class ShopifyClientError extends Error {
  readonly code: ShopifyErrorCode;
  readonly status: number | null;
  readonly userMessage: string;

  constructor(
    code: ShopifyErrorCode,
    message: string,
    options: ShopifyClientErrorOptions = {},
  ) {
    super(redactCredentials(message, options.token));
    // Aborts keep the standard name so generic `name === 'AbortError'`
    // checks (and `isAbortError`) recognise them.
    this.name = code === 'aborted' ? 'AbortError' : 'ShopifyClientError';
    this.code = code;
    this.status = options.status ?? null;
    this.userMessage = redactCredentials(
      options.userMessage ?? userMessageFor(code, options.shop),
      options.token,
    );
    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        value: options.cause,
      });
    }
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof ShopifyClientError) {
    return error.code === 'aborted';
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

/** The editor-facing message for anything a client call can throw. */
export function describeError(error: unknown): string {
  if (error instanceof ShopifyClientError) {
    return error.userMessage;
  }
  if (isAbortError(error)) {
    return SHOPIFY_ERROR_MESSAGES.aborted;
  }
  return GENERIC_ERROR_MESSAGE;
}

function createAbortError(): ShopifyClientError {
  return new ShopifyClientError('aborted', 'The request was aborted.');
}

function invalidResponse(detail: string): ShopifyClientError {
  return new ShopifyClientError(
    'invalid-response',
    `Shopify returned an unexpected response: ${detail}.`,
  );
}

// ---------------------------------------------------------------------------
// API version warnings
// ---------------------------------------------------------------------------

export type ApiVersionWarning = { pinned: string; responded: string };

const apiVersionListeners = new Set<(info: ApiVersionWarning) => void>();
let apiVersionWarned = false;

/**
 * Called whenever `X-Shopify-API-Version` differs from the pinned version.
 * Browsers only expose that header when Shopify lists it in
 * `Access-Control-Expose-Headers`, so `connectionTest().apiVersionOutdated`
 * (which also checks `publicApiVersions`) is the reliable signal.
 */
export function onApiVersionWarning(
  listener: (info: ApiVersionWarning) => void,
): () => void {
  apiVersionListeners.add(listener);
  return () => {
    apiVersionListeners.delete(listener);
  };
}

function reportApiVersion(responded: string | null): void {
  if (!responded || responded === SHOPIFY_STOREFRONT_API_VERSION) {
    return;
  }
  const info = { pinned: SHOPIFY_STOREFRONT_API_VERSION, responded };
  if (!apiVersionWarned) {
    apiVersionWarned = true;
    console.warn(
      `Shopify answered with Storefront API ${responded} instead of ${SHOPIFY_STOREFRONT_API_VERSION}. Update the Shopify plugin.`,
    );
  }
  for (const listener of apiVersionListeners) {
    try {
      listener(info);
    } catch {
      // A broken listener must not break requests.
    }
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export type RequestOptions = { signal?: AbortSignal };

export type ClientOptions = {
  store: StoreConnection;
  /** Omitted: the store's default market (`defaultCountry` / `defaultLanguage`). */
  context?: ShopifyContext;
  fetchImpl?: typeof fetch;
  /** Omitted: `sessionStorage` when available. `null` keeps the cache in memory only. */
  storage?: Storage | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export type EffectiveCapabilities = Omit<StoreCapabilities, 'checkedAt'>;

type Capability = keyof EffectiveCapabilities;

type GraphqlVariables = Record<string, unknown>;

type GraphqlResult = {
  data: Record<string, unknown>;
  /** Field names Shopify answered with ACCESS_DENIED. */
  deniedFields: string[];
  /**
   * Shopify answered `data: null` because a non-null capability field (such
   * as `productTags`) was denied; `data` is then `{}`.
   */
  dataDropped: boolean;
  /** `extensions.context`: the market Shopify actually applied. */
  appliedContext: ShopifyContext | null;
  /** `X-Shopify-API-Version`, when the browser can read it. */
  apiVersion: string | null;
};

/** A fixed document, or one built for the store's current capabilities. */
type QueryDocument = string | ((features: QueryFeatures) => string);

function buildDocument(
  document: QueryDocument,
  features: QueryFeatures,
): string {
  return typeof document === 'string' ? document : document(features);
}

type InFlightRequest = {
  promise: Promise<GraphqlResult>;
  controller: AbortController;
  consumers: number;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type NodeBatch = {
  controller: AbortController;
  consumers: number;
  entries: Map<string, Deferred<ShopifyNode | null>>;
};

type QueryOperation<T> = {
  name: string;
  query: QueryDocument;
  variables: GraphqlVariables;
  ttl: number;
  /** `features`: the capability flags the document was built with. */
  normalize: (data: Record<string, unknown>, features: QueryFeatures) => T;
  /** Nodes to seed into the node cache after a fresh fetch. */
  nodes?: (value: T) => Array<ShopifyNode | null>;
};

export type SkuMatch = { product: ProductSummary; variants: VariantSummary[] };

const MAX_THROTTLE_RETRIES = 3;
const THROTTLE_BASE_DELAY_MS = 500;
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;

/**
 * Detected capabilities, cached per store connection (the cache scope holds
 * shop, API version and credential). Context-scoped keys all contain `|`.
 */
const CAPABILITIES_CACHE_KEY = 'capabilities';
/** Scopes change rarely; settings re-checks overwrite the entry anyway. */
const CAPABILITIES_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Asked without custom headers, so the browser sends it without a CORS
 * preflight (see `ShopifyTransport.unreachableError`).
 */
const SHOP_LOOKUP_QUERY = '{shop{name}}';

const CAPABILITY_BY_FIELD = new Map<string, Capability>([
  ['totalInventory', 'inventory'],
  ['quantityAvailable', 'inventory'],
  ['tags', 'tags'],
  ['productTags', 'tags'],
]);

const HTTP_ERROR_CODES = new Map<number, ShopifyErrorCode>([
  [401, 'unauthorized'],
  [402, 'shop-unavailable'],
  [403, 'forbidden'],
  [404, 'shop-not-found'],
  [423, 'shop-unavailable'],
  [429, 'throttled'],
  [430, 'security-rejection'],
]);

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nobody may be listening any more (every caller aborted).
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/**
 * Follows a shared promise on behalf of one caller. The caller's abort rejects
 * only its own promise; `release(true)` lets the owner cancel shared work once
 * nobody is left.
 */
function subscribe<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  release: (aborted: boolean) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (aborted: boolean): boolean => {
      if (settled) {
        return false;
      }
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      release(aborted);
      return true;
    };
    const onAbort = () => {
      if (finish(true)) {
        reject(createAbortError());
      }
    };
    promise.then(
      (value) => {
        if (finish(false)) {
          resolve(value);
        }
      },
      (error: unknown) => {
        if (finish(false)) {
          reject(error);
        }
      },
    );
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function sleepWithSignal(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    sleep(ms).then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    // Sandboxed iframes can throw on access.
    return null;
  }
}

function clampFirst(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), 1), SHOPIFY_MAX_PAGE_SIZE);
}

function optionalCursor(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function featuresKey(features: QueryFeatures): string {
  return `i${Number(features.inventory)}t${Number(features.tags)}`;
}

// ---------------------------------------------------------------------------
// Market context
// ---------------------------------------------------------------------------

function normalizeContext(context?: ShopifyContext): ShopifyContext {
  const country = normalizedString(context?.country).toUpperCase();
  const language = normalizedString(context?.language).toUpperCase();
  const normalized: ShopifyContext = {};
  if (country) {
    normalized.country = country;
  }
  if (language) {
    normalized.language = language;
  }
  return normalized;
}

function storeDefaultContext(store: StoreConnection): ShopifyContext {
  return normalizeContext({
    country: store.defaultCountry,
    language: store.defaultLanguage,
  });
}

function contextKey(context: ShopifyContext): string {
  return `${context.country ?? '-'}:${context.language ?? '-'}`;
}

// ---------------------------------------------------------------------------
// Response normalizers
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function recordsOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function nodesOf(connection: unknown): unknown[] {
  return isRecord(connection) && Array.isArray(connection.nodes)
    ? connection.nodes
    : [];
}

function stringNodes(connection: unknown): string[] {
  return nodesOf(connection).filter(
    (value): value is string =>
      typeof value === 'string' && value.trim().length > 0,
  );
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidResponse(`missing ${label}`);
  }
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidResponse(`missing ${label}`);
  }
  return value;
}

function readMoney(value: unknown): Money | null {
  if (!isRecord(value) || typeof value.currencyCode !== 'string') {
    return null;
  }
  const amount =
    typeof value.amount === 'number' ? String(value.amount) : value.amount;
  return typeof amount === 'string'
    ? { amount, currencyCode: value.currencyCode }
    : null;
}

function readImage(value: unknown): ShopifyImage | null {
  if (!isRecord(value) || typeof value.url !== 'string') {
    return null;
  }
  return { url: value.url, altText: nullableStr(value.altText) };
}

function readCount(value: unknown): { count: number } | null {
  const count = isRecord(value) ? nullableNumber(value.count) : null;
  return count === null ? null : { count };
}

function readPageInfo(value: unknown): PageInfo {
  const info = isRecord(value) ? value : {};
  return {
    hasNextPage: info.hasNextPage === true,
    endCursor: nullableStr(info.endCursor),
  };
}

const KIND_BY_TYPENAME = new Map<string, ShopifyKind>([
  ['Product', 'product'],
  ['ProductVariant', 'variant'],
  ['Collection', 'collection'],
]);

/** A GID of the expected kind, with a matching `__typename` when present. */
function identity(
  value: unknown,
  typename: string,
): (Record<string, unknown> & { id: string }) | null {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null;
  }
  if (value.__typename !== undefined && value.__typename !== typename) {
    return null;
  }
  return kindOfGid(value.id) === KIND_BY_TYPENAME.get(typename)
    ? { ...value, id: value.id }
    : null;
}

function readPriceRange(value: unknown): ProductSummary['priceRange'] | null {
  const range = isRecord(value) ? value : {};
  const minVariantPrice = readMoney(range.minVariantPrice);
  const maxVariantPrice = readMoney(range.maxVariantPrice);
  return minVariantPrice && maxVariantPrice
    ? { minVariantPrice, maxVariantPrice }
    : null;
}

function readCompareAtRange(
  value: unknown,
  fallbackCurrency: string,
): ProductSummary['compareAtPriceRange'] {
  const range = isRecord(value) ? value : {};
  return {
    maxVariantPrice: readMoney(range.maxVariantPrice) ?? {
      amount: '0.0',
      currencyCode: fallbackCurrency,
    },
  };
}

/**
 * The SKU of a single-variant product: from the card's `firstVariant`, or
 * the `sku` of a product normalized before (picker parameters re-read them).
 */
function readProductSku(
  raw: Record<string, unknown>,
  variantsCount: { count: number } | null,
): string | null {
  if (variantsCount?.count !== 1) {
    return null;
  }
  if (!isRecord(raw.firstVariant)) {
    return normalizedString(raw.sku) || null;
  }
  const [first] = recordsOf(raw.firstVariant.nodes);
  return normalizedString(first?.sku) || null;
}

export function normalizeProduct(value: unknown): ProductSummary | null {
  const raw = identity(value, 'Product');
  const priceRange = raw ? readPriceRange(raw.priceRange) : null;
  if (!raw || !priceRange) {
    return null;
  }
  const variantsCount = readCount(raw.variantsCount);
  const product: ProductSummary = {
    __typename: 'Product',
    id: raw.id,
    handle: str(raw.handle),
    title: str(raw.title),
    vendor: str(raw.vendor),
    productType: str(raw.productType),
    availableForSale: raw.availableForSale === true,
    onlineStoreUrl: nullableStr(raw.onlineStoreUrl),
    updatedAt: str(raw.updatedAt),
    featuredImage: readImage(raw.featuredImage),
    priceRange,
    compareAtPriceRange: readCompareAtRange(
      raw.compareAtPriceRange,
      priceRange.maxVariantPrice.currencyCode,
    ),
    variantsCount,
    sku: readProductSku(raw, variantsCount),
  };
  if ('totalInventory' in raw) {
    product.totalInventory = nullableNumber(raw.totalInventory);
  }
  return product;
}

function readVariantProduct(value: unknown): VariantSummary['product'] | null {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null;
  }
  return {
    id: value.id,
    handle: str(value.handle),
    title: str(value.title),
    vendor: str(value.vendor),
    onlineStoreUrl: nullableStr(value.onlineStoreUrl),
    featuredImage: readImage(value.featuredImage),
  };
}

function readSelectedOptions(
  value: unknown,
): VariantSummary['selectedOptions'] {
  return recordsOf(value)
    .filter(
      (option) =>
        typeof option.name === 'string' && typeof option.value === 'string',
    )
    .map((option) => ({ name: str(option.name), value: str(option.value) }));
}

export function normalizeVariant(value: unknown): VariantSummary | null {
  const raw = identity(value, 'ProductVariant');
  const price = raw ? readMoney(raw.price) : null;
  const product = raw ? readVariantProduct(raw.product) : null;
  if (!raw || !price || !product) {
    return null;
  }
  const variant: VariantSummary = {
    __typename: 'ProductVariant',
    id: raw.id,
    title: str(raw.title),
    sku: nullableStr(raw.sku),
    barcode: nullableStr(raw.barcode),
    availableForSale: raw.availableForSale === true,
    currentlyNotInStock: raw.currentlyNotInStock === true,
    selectedOptions: readSelectedOptions(raw.selectedOptions),
    price,
    compareAtPrice: readMoney(raw.compareAtPrice),
    image: readImage(raw.image),
    product,
  };
  if ('quantityAvailable' in raw) {
    variant.quantityAvailable = nullableNumber(raw.quantityAvailable);
  }
  return variant;
}

export function normalizeCollection(value: unknown): CollectionSummary | null {
  const raw = identity(value, 'Collection');
  if (!raw) {
    return null;
  }
  return {
    __typename: 'Collection',
    id: raw.id,
    handle: str(raw.handle),
    title: str(raw.title),
    updatedAt: str(raw.updatedAt),
    onlineStoreUrl: nullableStr(raw.onlineStoreUrl),
    image: readImage(raw.image),
  };
}

/** Product, variant or collection; `null` for anything else. */
export function normalizeNode(value: unknown): ShopifyNode | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value.__typename) {
    case 'Product':
      return normalizeProduct(value);
    case 'ProductVariant':
      return normalizeVariant(value);
    case 'Collection':
      return normalizeCollection(value);
    default:
      return null;
  }
}

function readLegacyImages(value: unknown): LegacyProductNode['images'] {
  const edges = isRecord(value) ? recordsOf(value.edges) : [];
  return {
    edges: edges
      .map((edge) => (isRecord(edge.node) ? edge.node : null))
      .filter((node): node is Record<string, unknown> => node !== null)
      .map((node) => ({
        node: { src: str(node.src), previewSrc: str(node.previewSrc) },
      })),
  };
}

/** Keys are built in the 1.x order, so serialized values stay byte-compatible. */
export function normalizeLegacyProduct(
  value: unknown,
): LegacyProductNode | null {
  const raw = identity(value, 'Product');
  const range = raw && isRecord(raw.priceRange) ? raw.priceRange : null;
  const maxVariantPrice = range ? readMoney(range.maxVariantPrice) : null;
  const minVariantPrice = range ? readMoney(range.minVariantPrice) : null;
  if (!raw || !maxVariantPrice || !minVariantPrice) {
    return null;
  }
  return {
    id: raw.id,
    title: str(raw.title),
    handle: str(raw.handle),
    description: str(raw.description),
    onlineStoreUrl: nullableStr(raw.onlineStoreUrl),
    availableForSale: raw.availableForSale === true,
    productType: str(raw.productType),
    priceRange: { maxVariantPrice, minVariantPrice },
    images: readLegacyImages(raw.images),
  };
}

function normalizePage<T>(
  connection: unknown,
  normalizeItem: (value: unknown) => T | null,
  label: string,
): Page<T> {
  const raw = requireRecord(connection, label);
  const nodes = requireArray(raw.nodes, `${label}.nodes`)
    .map(normalizeItem)
    .filter((item): item is T => item !== null);
  return { nodes, pageInfo: readPageInfo(raw.pageInfo) };
}

function normalizeFilters(value: unknown): ShopifyFilter[] {
  return recordsOf(value)
    .filter((filter) => typeof filter.id === 'string')
    .map((filter) => ({
      id: str(filter.id),
      label: str(filter.label),
      type: str(filter.type),
      values: recordsOf(filter.values).map((entry) => ({
        id: str(entry.id),
        label: str(entry.label),
        count: nullableNumber(entry.count) ?? 0,
        input:
          typeof entry.input === 'string'
            ? entry.input
            : JSON.stringify(entry.input ?? null),
      })),
    }));
}

function normalizeOptions(value: unknown): ProductOption[] {
  return recordsOf(value)
    .filter((option) => typeof option.name === 'string')
    .map((option) => ({
      name: str(option.name),
      optionValues: recordsOf(option.optionValues)
        .filter((entry) => typeof entry.name === 'string')
        .map((entry) => ({ name: str(entry.name) })),
    }));
}

function isoCodeOf(value: unknown): string {
  return isRecord(value) ? str(value.isoCode) : '';
}

function normalizeLocalization(value: unknown): LocalizationInfo {
  const raw = requireRecord(value, 'localization');
  return {
    country: { isoCode: isoCodeOf(raw.country) },
    language: { isoCode: isoCodeOf(raw.language) },
    availableCountries: recordsOf(raw.availableCountries)
      .filter((country) => typeof country.isoCode === 'string')
      .map((country) => ({
        isoCode: str(country.isoCode),
        name: str(country.name),
        currency: { isoCode: isoCodeOf(country.currency) },
      })),
    availableLanguages: recordsOf(raw.availableLanguages)
      .filter((language) => typeof language.isoCode === 'string')
      .map((language) => ({
        isoCode: str(language.isoCode),
        endonymName: str(language.endonymName),
      })),
  };
}

function emptyPage<T>(): Page<T> {
  return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
}

// ---------------------------------------------------------------------------
// SKU matching
// ---------------------------------------------------------------------------

function matchRank(value: string | null, needle: string): number | null {
  const candidate = value?.trim().toLowerCase() ?? '';
  if (!candidate) {
    return null;
  }
  if (candidate === needle) {
    return 0;
  }
  if (candidate.startsWith(needle)) {
    return 1;
  }
  return candidate.includes(needle) ? 2 : null;
}

function variantMatchRank(
  variant: VariantSummary,
  needle: string,
): number | null {
  const ranks = [
    matchRank(variant.sku, needle),
    matchRank(variant.barcode, needle),
  ].filter((rank): rank is number => rank !== null);
  return ranks.length > 0 ? Math.min(...ranks) : null;
}

type RankedSkuMatch = SkuMatch & { rank: number; index: number };

function rankProductMatch(
  product: ProductSummary,
  variants: VariantSummary[],
  needle: string,
  index: number,
): RankedSkuMatch | null {
  const ranked = variants
    .map((variant, position) => ({
      variant,
      position,
      rank: variantMatchRank(variant, needle),
    }))
    .filter(
      (
        entry,
      ): entry is { variant: VariantSummary; position: number; rank: number } =>
        entry.rank !== null,
    )
    .sort(
      (left, right) => left.rank - right.rank || left.position - right.position,
    );
  if (ranked.length === 0) {
    return null;
  }
  return {
    product,
    variants: ranked.map(({ variant }) => variant),
    rank: ranked[0]?.rank ?? 2,
    index,
  };
}

/** Keeps only variants whose SKU or barcode matches: exact, then prefix, then contains. */
function rankSkuMatches(predictiveSearch: unknown, term: string): SkuMatch[] {
  const needle = term.trim().toLowerCase();
  const products = recordsOf(
    requireRecord(predictiveSearch, 'predictiveSearch').products,
  );
  const matches: RankedSkuMatch[] = [];
  for (const [index, raw] of products.entries()) {
    const product = normalizeProduct(raw);
    const variants = nodesOf(raw.variants)
      .map(normalizeVariant)
      .filter((variant): variant is VariantSummary => variant !== null);
    const match = product
      ? rankProductMatch(product, variants, needle, index)
      : null;
    if (match) {
      matches.push(match);
    }
  }
  return matches
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ product, variants }) => ({ product, variants }));
}

// ---------------------------------------------------------------------------
// Cache: memory + sessionStorage
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'datocms-plugin-shopify-product:cache:';

/**
 * Sweeps trim stored entries this far below `CACHE_MAX_ENTRIES`, so a full
 * cache is swept about once every `STORAGE_SWEEP_SLACK` writes, not on each.
 */
const STORAGE_SWEEP_SLACK = Math.max(1, Math.floor(CACHE_MAX_ENTRIES / 10));

/** Entries are written as `{"e":<expiresAt>,"v":…}`; sweeps read `e` only. */
const STORED_EXPIRY_PATTERN = /^\{"e":(\d+(?:\.\d+)?)[,}]/;

type CacheEntry = { value: unknown; expiresAt: number };

function parseStoredEntry(raw: string | null): CacheEntry | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.e === 'number' && 'v' in parsed) {
      return { value: parsed.v, expiresAt: parsed.e };
    }
  } catch {
    // Corrupt entry: treated as a miss and removed.
  }
  return null;
}

/** The expiry of a stored entry without parsing its value; `null` if corrupt. */
function storedExpiry(raw: string | null): number | null {
  const match = raw === null ? null : STORED_EXPIRY_PATTERN.exec(raw);
  if (match?.[1]) {
    return Number(match[1]);
  }
  return parseStoredEntry(raw)?.expiresAt ?? null;
}

/** FNV-1a: a short, non-reversible tag for a token (never store the token). */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Each token (and tokenless mode) can see a different catalog, so stored
 * entries are never shared between credentials for the same shop.
 */
function credentialScope(store: StoreConnection): string {
  return store.tokenless
    ? 'tokenless'
    : `t${fingerprint(store.storefrontAccessToken.trim())}`;
}

/**
 * Memory plus `sessionStorage`. Memory holds at most `CACHE_MAX_ENTRIES`
 * per store connection; storage holds at most that many entries in total
 * (every scope and every plugin iframe of the tab shares it), soonest to
 * expire evicted first.
 */
class ResponseCache {
  private readonly memory = new Map<string, CacheEntry>();
  private readonly storage: Storage | null;
  private readonly prefix: string;
  private readonly now: () => number;
  private writable = true;
  private writesSinceSweep = 0;

  constructor(storage: Storage | null, scope: string, now: () => number) {
    this.storage = storage;
    this.prefix = `${STORAGE_PREFIX}${scope}|`;
    this.now = now;
    this.sweepStorage();
  }

  get(key: string): unknown {
    const entry = this.memory.get(key) ?? this.readStored(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: unknown, ttl: number): void {
    const entry = { value, expiresAt: this.now() + ttl };
    this.remember(key, entry);
    this.persist(
      this.prefix + key,
      JSON.stringify({ e: entry.expiresAt, v: value }),
    );
  }

  delete(key: string): void {
    this.memory.delete(key);
    this.withStorage((storage) => storage.removeItem(this.prefix + key));
  }

  /** Evicts from memory only: storage keeps its own cap. */
  private remember(key: string, entry: CacheEntry): void {
    this.memory.delete(key);
    this.memory.set(key, entry);
    while (this.memory.size > CACHE_MAX_ENTRIES) {
      const oldest = this.memory.keys().next();
      if (oldest.done) {
        return;
      }
      this.memory.delete(oldest.value);
    }
  }

  private persist(storageKey: string, serialized: string): void {
    if (!this.storage || !this.writable) {
      return;
    }
    if (this.tryWrite(storageKey, serialized)) {
      this.afterWrite();
      return;
    }
    // Usually the quota, which counts bytes (a 250-product page is large):
    // drop half of the stored entries and retry once. If that fails too
    // (privacy mode, sandbox), stop persisting; memory keeps working.
    this.sweepStorage('halve');
    this.writable = this.tryWrite(storageKey, serialized);
  }

  private tryWrite(storageKey: string, serialized: string): boolean {
    try {
      this.storage?.setItem(storageKey, serialized);
      return true;
    } catch {
      return false;
    }
  }

  /** `storage.length` is cheap; the sweep only runs once the tab is over the cap. */
  private afterWrite(): void {
    this.writesSinceSweep += 1;
    if (this.writesSinceSweep <= STORAGE_SWEEP_SLACK) {
      return;
    }
    this.withStorage((storage) => {
      if (storage.length > CACHE_MAX_ENTRIES) {
        this.sweepStorage();
      }
    });
  }

  private readStored(key: string): CacheEntry | undefined {
    const raw = this.readStorageItem(key);
    const entry = parseStoredEntry(raw);
    if (!entry) {
      if (raw !== null) {
        this.delete(key);
      }
      return undefined;
    }
    this.remember(key, entry);
    return entry;
  }

  private readStorageItem(key: string): string | null {
    if (!this.storage) {
      return null;
    }
    try {
      return this.storage.getItem(this.prefix + key);
    } catch {
      return null;
    }
  }

  private withStorage(action: (storage: Storage) => void): void {
    if (!this.storage) {
      return;
    }
    try {
      action(this.storage);
    } catch {
      // Quota, privacy mode or sandbox: the memory cache still works.
    }
  }

  /**
   * Drops expired and corrupt entries of every scope, then the ones that
   * expire soonest: down to a little under the cap, or to half of what is
   * left when the quota is full.
   */
  private sweepStorage(mode: 'cap' | 'halve' = 'cap'): void {
    this.writesSinceSweep = 0;
    this.withStorage((storage) => {
      const now = this.now();
      const live: Array<{ key: string; expiresAt: number }> = [];
      for (const key of storedCacheKeys(storage)) {
        const expiresAt = storedExpiry(storage.getItem(key));
        if (expiresAt === null || expiresAt <= now) {
          storage.removeItem(key);
        } else {
          live.push({ key, expiresAt });
        }
      }
      live.sort((left, right) => left.expiresAt - right.expiresAt);
      const target =
        mode === 'halve'
          ? Math.floor(live.length / 2)
          : CACHE_MAX_ENTRIES - STORAGE_SWEEP_SLACK;
      const excess = live.length - target;
      for (const { key } of live.slice(0, Math.max(0, excess))) {
        storage.removeItem(key);
      }
    });
  }
}

function storedCacheKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Response interpretation
// ---------------------------------------------------------------------------

type GraphqlError = {
  message: string;
  code: string | null;
  path: Array<string | number>;
};

function readGraphqlErrors(value: unknown): GraphqlError[] {
  return recordsOf(value).map((error) => ({
    message: str(error.message),
    code: isRecord(error.extensions)
      ? nullableStr(error.extensions.code)
      : null,
    path: Array.isArray(error.path)
      ? error.path.filter(
          (part): part is string | number =>
            typeof part === 'string' || typeof part === 'number',
        )
      : [],
  }));
}

function deniedFieldName(error: GraphqlError): string {
  const names = error.path.filter(
    (part): part is string => typeof part === 'string',
  );
  return names[names.length - 1] ?? 'unknown';
}

function firstErrorMessage(text: string): string | null {
  try {
    const body: unknown = JSON.parse(text);
    const [first] = isRecord(body) ? readGraphqlErrors(body.errors) : [];
    return first?.message ? first.message : null;
  } catch {
    return null;
  }
}

function responseSnippet(text: string, token: string): string {
  const compact = redactCredentials(text, token).replace(/\s+/g, ' ').trim();
  return compact.length > 300 ? `${compact.slice(0, 300)}…` : compact;
}

function httpErrorCode(status: number, text: string): ShopifyErrorCode {
  if (status === 400 && text.includes(STORE_LOCKED_MESSAGE)) {
    return 'store-locked';
  }
  const mapped = HTTP_ERROR_CODES.get(status);
  if (mapped) {
    return mapped;
  }
  return status < 500 && firstErrorMessage(text)
    ? 'graphql'
    : 'invalid-response';
}

type ErrorContext = { shop: string; token: string };

function httpError(
  status: number,
  text: string,
  context: ErrorContext,
): ShopifyClientError {
  const code = httpErrorCode(status, text);
  const detail = responseSnippet(text, context.token);
  return new ShopifyClientError(
    code,
    `Shopify returned HTTP ${status} for ${context.shop}${detail ? `: ${detail}` : '.'}`,
    {
      status,
      shop: context.shop,
      token: context.token,
      userMessage:
        code === 'graphql' ? (firstErrorMessage(text) ?? undefined) : undefined,
    },
  );
}

function graphqlError(
  errors: GraphqlError[],
  context: ErrorContext,
): ShopifyClientError {
  const first = errors[0];
  const message =
    first?.message || `Shopify returned a ${first?.code ?? 'GraphQL'} error.`;
  return new ShopifyClientError('graphql', message, {
    shop: context.shop,
    token: context.token,
    userMessage: message,
  });
}

/** ACCESS_DENIED (from GraphQL, not HTTP 403) on fields the request needed. */
function deniedError(fields: string[], shop: string): ShopifyClientError {
  return new ShopifyClientError(
    'forbidden',
    fields.length > 0
      ? `Shopify denied access to ${fields.join(', ')}.`
      : 'Shopify denied access to the request.',
    { shop },
  );
}

function readAppliedContext(extensions: unknown): ShopifyContext | null {
  const raw =
    isRecord(extensions) && isRecord(extensions.context)
      ? extensions.context
      : null;
  if (!raw) {
    return null;
  }
  const applied = normalizeContext({
    country: str(raw.country),
    language: str(raw.language),
  });
  return applied.country || applied.language ? applied : null;
}

function interpretBody(
  body: unknown,
  context: ErrorContext,
): Omit<GraphqlResult, 'apiVersion'> {
  if (!isRecord(body)) {
    throw invalidResponse('the body is not a GraphQL response');
  }
  const errors = readGraphqlErrors(body.errors);
  if (errors.some((error) => error.code === 'THROTTLED')) {
    throw new ShopifyClientError(
      'throttled',
      'Shopify throttled the request.',
      {
        shop: context.shop,
      },
    );
  }
  const denied = errors.filter((error) => error.code === 'ACCESS_DENIED');
  const others = errors.filter((error) => error.code !== 'ACCESS_DENIED');
  if (others.length > 0) {
    throw graphqlError(others, context);
  }
  const deniedFields = [...new Set(denied.map(deniedFieldName))];
  const appliedContext = readAppliedContext(body.extensions);
  if (isRecord(body.data)) {
    return {
      data: body.data,
      deniedFields,
      dataDropped: false,
      appliedContext,
    };
  }
  // A denied non-null field nulls the whole response (`data: null`). When
  // only capability fields were denied, report it so the caller can record
  // the missing capability and ask again without them.
  if (
    deniedFields.length > 0 &&
    deniedFields.every((field) => CAPABILITY_BY_FIELD.has(field))
  ) {
    return { data: {}, deniedFields, dataDropped: true, appliedContext };
  }
  throw denied.length > 0
    ? deniedError(deniedFields, context.shop)
    : invalidResponse('the response has no data');
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ShopifyClientError(
      'invalid-response',
      'Shopify returned a response that was not valid JSON.',
      { cause: error },
    );
  }
}

// ---------------------------------------------------------------------------
// Transport (shared by every context of one store connection)
// ---------------------------------------------------------------------------

function latestCapabilities(
  left: StoreCapabilities | null | undefined,
  right: StoreCapabilities | null | undefined,
): StoreCapabilities | null {
  if (!left || !right) {
    return left ?? right ?? null;
  }
  return Date.parse(right.checkedAt) > Date.parse(left.checkedAt)
    ? right
    : left;
}

class ShopifyTransport {
  readonly shopDomain: string;
  readonly cache: ResponseCache;
  readonly now: () => number;
  private store: StoreConnection;
  private detected: StoreCapabilities | null = null;
  private readonly denied = new Set<Capability>();
  private readonly clients = new Map<string, ShopifyClient>();
  private readonly inFlight = new Map<string, InFlightRequest>();
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: ClientOptions) {
    this.store = options.store;
    this.shopDomain = options.store.shopDomain.trim().toLowerCase();
    this.fetchImpl =
      options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    const storage =
      options.storage === undefined ? defaultSessionStorage() : options.storage;
    this.cache = new ResponseCache(
      storage,
      `${this.shopDomain}|${SHOPIFY_STOREFRONT_API_VERSION}|${credentialScope(options.store)}`,
      this.now,
    );
    this.detected =
      normalizeCapabilities(this.cache.get(CAPABILITIES_CACHE_KEY)) ?? null;
  }

  get tokenless(): boolean {
    return this.store.tokenless;
  }

  get defaultContext(): ShopifyContext {
    return storeDefaultContext(this.store);
  }

  private get token(): string {
    return this.store.tokenless ? '' : this.store.storefrontAccessToken;
  }

  updateStore(store: StoreConnection): void {
    this.store = store;
  }

  clientFor(context: ShopifyContext): ShopifyClient {
    const key = contextKey(context);
    const existing = this.clients.get(key);
    if (existing) {
      return existing;
    }
    const client = new ShopifyClient({ store: this.store, context }, this);
    this.clients.set(key, client);
    return client;
  }

  register(client: ShopifyClient): void {
    const key = contextKey(client.context);
    if (!this.clients.has(key)) {
      this.clients.set(key, client);
    }
  }

  /** Saved in the settings, detected in this tab, or tokenless (none to detect). */
  hasKnownCapabilities(): boolean {
    return (
      this.store.tokenless ||
      Boolean(this.store.capabilities) ||
      this.detected !== null
    );
  }

  capabilities(): EffectiveCapabilities {
    const known = this.store.tokenless
      ? null
      : latestCapabilities(this.store.capabilities, this.detected);
    return {
      tags: Boolean(known?.tags) && !this.denied.has('tags'),
      inventory: Boolean(known?.inventory) && !this.denied.has('inventory'),
      metafields: Boolean(known?.metafields) && !this.denied.has('metafields'),
    };
  }

  features(): QueryFeatures {
    const { inventory, tags } = this.capabilities();
    return { inventory, tags };
  }

  applyDetected(capabilities: StoreCapabilities): void {
    this.detected = capabilities;
    this.cache.set(
      CAPABILITIES_CACHE_KEY,
      capabilities,
      CAPABILITIES_CACHE_TTL_MS,
    );
    for (const capability of ['tags', 'inventory', 'metafields'] as const) {
      if (capabilities[capability]) {
        this.denied.delete(capability);
      }
    }
  }

  /** The capability flags a document is built with. */
  featuresFor(document: QueryDocument): QueryFeatures {
    return typeof document === 'string' ? BASE_FEATURES : this.features();
  }

  /**
   * Sends a document built for the current capabilities. When Shopify drops
   * the whole response over a denied capability field, that capability is
   * now marked missing, so the document is rebuilt without it and resent.
   */
  async requestDocument(
    document: QueryDocument,
    variables: GraphqlVariables,
    signal?: AbortSignal,
  ): Promise<{ result: GraphqlResult; features: QueryFeatures }> {
    const features = this.featuresFor(document);
    const query = buildDocument(document, features);
    const result = await this.request(query, variables, signal);
    if (!result.dataDropped) {
      return { result, features };
    }
    // Only worth resending if dropping the denied capability changed the text.
    if (buildDocument(document, this.featuresFor(document)) === query) {
      throw deniedError(result.deniedFields, this.shopDomain);
    }
    return this.requestDocument(document, variables, signal);
  }

  /**
   * Sends (or joins) a request. Denied capability fields come back as data
   * (`dataDropped` when Shopify nulled the whole response); any other
   * ACCESS_DENIED throws `forbidden` unless `allowDenied` is set.
   */
  async request(
    query: string,
    variables: GraphqlVariables,
    signal?: AbortSignal,
    options: { allowDenied?: boolean } = {},
  ): Promise<GraphqlResult> {
    if (signal?.aborted) {
      throw createAbortError();
    }
    const entry = this.inFlightEntry(query, variables);
    entry.consumers += 1;
    const result = await subscribe(entry.promise, signal, (aborted) => {
      entry.consumers -= 1;
      if (aborted && entry.consumers === 0) {
        entry.controller.abort();
      }
    });
    const fatal = result.deniedFields.filter(
      (field) => !CAPABILITY_BY_FIELD.has(field),
    );
    if (!options.allowDenied && fatal.length > 0) {
      throw deniedError(fatal, this.shopDomain);
    }
    return result;
  }

  private inFlightEntry(
    query: string,
    variables: GraphqlVariables,
  ): InFlightRequest {
    const key = stableSerialize({ shop: this.shopDomain, query, variables });
    const existing = this.inFlight.get(key);
    if (existing && !existing.controller.signal.aborted) {
      return existing;
    }
    const controller = new AbortController();
    const entry: InFlightRequest = {
      promise: this.executeWithRetry(query, variables, controller.signal, 0),
      controller,
      consumers: 0,
    };
    this.inFlight.set(key, entry);
    const cleanup = () => {
      if (this.inFlight.get(key) === entry) {
        this.inFlight.delete(key);
      }
    };
    entry.promise.then(cleanup, cleanup);
    return entry;
  }

  private async executeWithRetry(
    query: string,
    variables: GraphqlVariables,
    signal: AbortSignal,
    attempt: number,
  ): Promise<GraphqlResult> {
    try {
      return await this.execute(query, variables, signal);
    } catch (error) {
      const throttled =
        error instanceof ShopifyClientError && error.code === 'throttled';
      if (!throttled || attempt >= MAX_THROTTLE_RETRIES) {
        throw error;
      }
      const delay =
        THROTTLE_BASE_DELAY_MS * 2 ** attempt +
        Math.floor(this.random() * THROTTLE_BASE_DELAY_MS);
      await sleepWithSignal(this.sleep, delay, signal);
      return this.executeWithRetry(query, variables, signal, attempt + 1);
    }
  }

  private async execute(
    query: string,
    variables: GraphqlVariables,
    signal: AbortSignal,
  ): Promise<GraphqlResult> {
    const context = { shop: this.shopDomain, token: this.token };
    const response = await this.send(query, variables, signal);
    const apiVersion = response.headers.get('X-Shopify-API-Version');
    reportApiVersion(apiVersion);
    const text = await this.readText(response, signal);
    if (!response.ok) {
      throw httpError(response.status, text, context);
    }
    const result = interpretBody(parseJsonBody(text), context);
    for (const field of result.deniedFields) {
      const capability = CAPABILITY_BY_FIELD.get(field);
      if (capability) {
        this.denied.add(capability);
      }
    }
    return { ...result, apiVersion };
  }

  private async send(
    query: string,
    variables: GraphqlVariables,
    signal: AbortSignal,
  ): Promise<Response> {
    if (!SHOP_DOMAIN_PATTERN.test(this.shopDomain)) {
      throw new ShopifyClientError(
        'shop-not-found',
        `"${this.shopDomain}" is not a Shopify domain.`,
        { shop: this.shopDomain },
      );
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (!this.store.tokenless) {
      headers['X-Shopify-Storefront-Access-Token'] = this.token;
    }
    try {
      return await this.fetchImpl(this.endpoint(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        signal,
      });
    } catch (error) {
      throw await this.unreachableError(error, signal);
    }
  }

  private endpoint(): string {
    return `https://${this.shopDomain}/api/${SHOPIFY_STOREFRONT_API_VERSION}/graphql.json`;
  }

  /**
   * Why a request never got a response. The JSON POST (custom headers) is
   * preflighted, and Shopify answers the preflight for an unknown shop with
   * a 404, which the browser reports as a bare network failure. A GET
   * without custom headers skips the preflight and its 404 is readable, so
   * one such lookup tells a wrong shop domain apart from a real network or
   * ad-blocker problem. It carries no token.
   */
  private async unreachableError(
    error: unknown,
    signal: AbortSignal,
  ): Promise<ShopifyClientError> {
    const failure = this.transportError(error, signal);
    if (failure.code !== 'network') {
      return failure;
    }
    const status = await this.lookupShopStatus(signal);
    if (signal.aborted) {
      return createAbortError();
    }
    const code = status === null ? undefined : HTTP_ERROR_CODES.get(status);
    if (code !== 'shop-not-found' && code !== 'shop-unavailable') {
      return failure;
    }
    return new ShopifyClientError(
      code,
      `Shopify returned HTTP ${status} for ${this.shopDomain}.`,
      { status, shop: this.shopDomain, cause: error },
    );
  }

  /** The HTTP status of a header-less GET, or null if that fails too. */
  private async lookupShopStatus(signal: AbortSignal): Promise<number | null> {
    try {
      const response = await this.fetchImpl(
        `${this.endpoint()}?query=${encodeURIComponent(SHOP_LOOKUP_QUERY)}`,
        { method: 'GET', signal },
      );
      return response.status;
    } catch {
      return null;
    }
  }

  private async readText(
    response: Response,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      return await response.text();
    } catch (error) {
      throw this.transportError(error, signal);
    }
  }

  private transportError(
    error: unknown,
    signal: AbortSignal,
  ): ShopifyClientError {
    if (signal.aborted || isAbortError(error)) {
      return createAbortError();
    }
    const detail = error instanceof Error ? error.message : String(error);
    return new ShopifyClientError(
      'network',
      `Couldn't reach ${this.shopDomain}: ${detail}`,
      { shop: this.shopDomain, token: this.token, cause: error },
    );
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ShopifyClient {
  readonly shopDomain: string;
  readonly context: ShopifyContext;

  private readonly transport: ShopifyTransport;
  private readonly namespace: string;
  private pendingBatch: NodeBatch | null = null;
  private readonly nodeLoads = new Map<string, NodeBatch>();

  /**
   * `transport` is internal: `withContext` and `getShopifyClient` pass it to
   * share requests, dedupe and capability state between contexts.
   */
  constructor(options: ClientOptions, transport?: ShopifyTransport) {
    this.transport = transport ?? new ShopifyTransport(options);
    this.shopDomain = this.transport.shopDomain;
    this.context = normalizeContext(
      options.context ?? storeDefaultContext(options.store),
    );
    this.namespace = contextKey(this.context);
    this.transport.register(this);
  }

  /** The same store in another market. Omitted: the store's default market. */
  withContext(context?: ShopifyContext): ShopifyClient {
    return this.transport.clientFor(
      normalizeContext(context ?? this.transport.defaultContext),
    );
  }

  /** What this session can use: stored capabilities minus anything Shopify denied. */
  effectiveCapabilities(): EffectiveCapabilities {
    return this.transport.capabilities();
  }

  // -- Hydration --------------------------------------------------------------

  /**
   * Resolves GIDs (or pre-2022-04 base64 IDs) in input order. `null` means not
   * visible to the storefront (unknown, unpublished, deleted) or not a
   * product, variant or collection. Calls made in the same tick share one
   * `nodes(ids:)` request per 250 IDs.
   */
  loadNodes(
    ids: string[],
    options: RequestOptions = {},
  ): Promise<Array<ShopifyNode | null>> {
    const { signal } = options;
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }
    // Old 1.x values can hold base64 IDs; request (and cache) the plain GID.
    const gids = ids.map((id) => decodeShopifyId(id) ?? id);
    const known = new Map<string, ShopifyNode | null>();
    const batches = new Set<NodeBatch>();
    const waits: Array<Promise<void>> = [];
    for (const id of new Set(gids)) {
      const cached = this.cachedNode(id);
      if (cached !== undefined) {
        known.set(id, cached);
        continue;
      }
      const { batch, promise } = this.enqueueNode(id);
      batches.add(batch);
      waits.push(
        promise.then((node) => {
          known.set(id, node);
        }),
      );
    }
    const all = Promise.all(waits).then(() =>
      gids.map((id) => known.get(id) ?? null),
    );
    if (batches.size === 0) {
      return all;
    }
    for (const batch of batches) {
      batch.consumers += 1;
    }
    return subscribe(all, signal, (aborted) => {
      for (const batch of batches) {
        batch.consumers -= 1;
        if (aborted && batch.consumers === 0) {
          batch.controller.abort();
        }
      }
    });
  }

  async loadNode(
    id: string,
    options: RequestOptions = {},
  ): Promise<ShopifyNode | null> {
    const [node] = await this.loadNodes([id], options);
    return node ?? null;
  }

  productByHandle(
    handle: string,
    options: RequestOptions = {},
  ): Promise<ProductSummary | null> {
    const trimmed = handle.trim();
    if (!trimmed) {
      return Promise.resolve(null);
    }
    return this.query(
      {
        name: 'ProductByHandle',
        query: productByHandleQuery,
        variables: { handle: trimmed, ...this.contextVariables() },
        ttl: SEARCH_CACHE_TTL_MS,
        normalize: (data) => normalizeProduct(data.product),
        nodes: (product) => [product],
      },
      options.signal,
    );
  }

  collectionByHandle(
    handle: string,
    options: RequestOptions = {},
  ): Promise<CollectionSummary | null> {
    const trimmed = handle.trim();
    if (!trimmed) {
      return Promise.resolve(null);
    }
    return this.query(
      {
        name: 'CollectionByHandle',
        query: COLLECTION_BY_HANDLE_QUERY,
        variables: { handle: trimmed, ...this.contextVariables() },
        ttl: SEARCH_CACHE_TTL_MS,
        normalize: (data) => normalizeCollection(data.collection),
        nodes: (collection) => [collection],
      },
      options.signal,
    );
  }

  /**
   * The 1.x snapshot source. Looks the product up by ID first (base64 IDs are
   * decoded) and falls back to the handle, so renamed handles keep resolving.
   */
  async legacyProduct(
    ref: { id?: string | null; handle?: string | null },
    options: RequestOptions = {},
  ): Promise<LegacyProductNode | null> {
    const id = decodeShopifyId(ref.id ?? null);
    if (id && kindOfGid(id) === 'product') {
      const byId = await this.query(
        {
          name: 'LegacyProductById',
          query: LEGACY_PRODUCT_BY_ID_QUERY,
          variables: { ids: [id], ...this.contextVariables() },
          ttl: SEARCH_CACHE_TTL_MS,
          normalize: (data) =>
            normalizeLegacyProduct(requireArray(data.nodes, 'nodes')[0]),
        },
        options.signal,
      );
      if (byId) {
        return byId;
      }
    }
    const handle = normalizedString(ref.handle);
    if (!handle) {
      return null;
    }
    return this.query(
      {
        name: 'LegacyProductByHandle',
        query: LEGACY_PRODUCT_BY_HANDLE_QUERY,
        variables: { handle, ...this.contextVariables() },
        ttl: SEARCH_CACHE_TTL_MS,
        normalize: (data) => normalizeLegacyProduct(data.product),
      },
      options.signal,
    );
  }

  // -- Browsing ---------------------------------------------------------------

  browseProducts(
    args: {
      first: number;
      after?: string | null;
      query?: string;
      sortKey?: ProductSortKey;
      reverse?: boolean;
    },
    options: RequestOptions = {},
  ): Promise<Page<ProductSummary>> {
    const search = normalizedString(args.query);
    // RELEVANCE is only valid with a text query.
    const sortKey =
      args.sortKey === 'RELEVANCE' && !search ? null : (args.sortKey ?? null);
    return this.query(
      {
        name: 'BrowseProducts',
        query: browseProductsQuery,
        variables: {
          first: clampFirst(args.first, PICKER_PAGE_SIZE),
          after: optionalCursor(args.after),
          query: search || null,
          sortKey,
          reverse: args.reverse ?? false,
          ...this.contextVariables(),
        },
        ttl: SEARCH_CACHE_TTL_MS,
        normalize: (data) =>
          normalizePage(data.products, normalizeProduct, 'products'),
        nodes: (page) => page.nodes,
      },
      options.signal,
    );
  }

  browseCollectionProducts(
    args: {
      collectionId: string;
      first: number;
      after?: string | null;
      filters?: ProductFilterInput[];
      sortKey?: CollectionSortKey;
      reverse?: boolean;
    },
    options: RequestOptions = {},
  ): Promise<{
    found: boolean;
    page: Page<ProductSummary>;
    filters: ShopifyFilter[];
  }> {
    return this.query(
      {
        name: 'BrowseCollectionProducts',
        query: browseCollectionProductsQuery,
        variables: {
          id: args.collectionId,
          first: clampFirst(args.first, PICKER_PAGE_SIZE),
          after: optionalCursor(args.after),
          filters:
            args.filters && args.filters.length > 0 ? args.filters : null,
          sortKey: args.sortKey ?? null,
          reverse: args.reverse ?? false,
          ...this.contextVariables(),
        },
        ttl: SEARCH_CACHE_TTL_MS,
        normalize: (data) => {
          if (data.collection === null) {
            return {
              found: false,
              page: emptyPage<ProductSummary>(),
              filters: [],
            };
          }
          const products = requireRecord(
            requireRecord(data.collection, 'collection').products,
            'collection.products',
          );
          return {
            found: true,
            page: normalizePage(products, normalizeProduct, 'products'),
            filters: normalizeFilters(products.filters),
          };
        },
        nodes: (result) => result.page.nodes,
      },
      options.signal,
    );
  }

  productVariants(
    args: { productId: string; first?: number; after?: string | null },
    options: RequestOptions = {},
  ): Promise<{
    variantsCount: number;
    options: ProductOption[];
    page: Page<VariantSummary>;
  } | null> {
    return this.query(
      {
        name: 'ProductVariants',
        query: productVariantsQuery,
        variables: {
          id: args.productId,
          first: clampFirst(args.first, VARIANT_PAGE_SIZE),
          after: optionalCursor(args.after),
          ...this.contextVariables(),
        },
        ttl: SEARCH_CACHE_TTL_MS,
        normalize: (data) => {
          if (data.product === null) {
            return null;
          }
          const product = requireRecord(data.product, 'product');
          const page = normalizePage(
            product.variants,
            normalizeVariant,
            'variants',
          );
          return {
            variantsCount:
              readCount(product.variantsCount)?.count ?? page.nodes.length,
            options: normalizeOptions(product.options),
            page,
          };
        },
        nodes: (result) => result?.page.nodes ?? [],
      },
      options.signal,
    );
  }

  /**
   * Product types and (with the tags capability) tags, without empty values.
   * If the tags scope was revoked, Shopify nulls the whole response; the
   * client then drops tags for the session and asks for product types alone.
   */
  filterValues(
    options: RequestOptions = {},
  ): Promise<{ productTypes: string[]; tags: string[] }> {
    return this.query(
      {
        name: 'FilterValues',
        query: filterValuesQuery,
        variables: {},
        ttl: SEARCH_CACHE_TTL_MS,
        normalize: (data, features) => ({
          productTypes: stringNodes(data.productTypes),
          tags: features.tags ? stringNodes(data.productTags) : [],
        }),
      },
      options.signal,
    );
  }

  collections(
    args: { first: number; after?: string | null; query?: string },
    options: RequestOptions = {},
  ): Promise<Page<CollectionSummary>> {
    return this.query(
      {
        name: 'Collections',
        query: COLLECTIONS_QUERY,
        variables: {
          first: clampFirst(args.first, PICKER_PAGE_SIZE),
          after: optionalCursor(args.after),
          query: normalizedString(args.query) || null,
          ...this.contextVariables(),
        },
        ttl: SEARCH_CACHE_TTL_MS,
        normalize: (data) =>
          normalizePage(data.collections, normalizeCollection, 'collections'),
        nodes: (page) => page.nodes,
      },
      options.signal,
    );
  }

  /**
   * Products with a variant whose SKU or barcode matches `q`, each narrowed to
   * the matching variants (exact first, then prefix, then contains).
   */
  skuMatches(q: string, options: RequestOptions = {}): Promise<SkuMatch[]> {
    const term = q.trim();
    if (!term) {
      return Promise.resolve([]);
    }
    return this.query(
      {
        name: 'SkuMatches',
        query: skuMatchesQuery,
        variables: { q: term, ...this.contextVariables() },
        ttl: SEARCH_CACHE_TTL_MS,
        normalize: (data) => rankSkuMatches(data.predictiveSearch, term),
        nodes: (matches) =>
          matches.flatMap(({ product, variants }) => [product, ...variants]),
      },
      options.signal,
    );
  }

  // -- Settings ---------------------------------------------------------------

  async connectionTest(
    options: RequestOptions = {},
  ): Promise<ConnectionTestResult> {
    const { result } = await this.transport.requestDocument(
      CONNECTION_TEST_QUERY,
      {},
      options.signal,
    );
    const shop = requireRecord(result.data.shop, 'shop');
    const publicApiVersions = recordsOf(result.data.publicApiVersions)
      .filter((version) => typeof version.handle === 'string')
      .map((version) => ({
        handle: str(version.handle),
        supported: version.supported === true,
      }));
    const pinnedSupported = publicApiVersions.some(
      (version) =>
        version.handle === SHOPIFY_STOREFRONT_API_VERSION && version.supported,
    );
    const responded = result.apiVersion;
    return {
      shopName: str(shop.name),
      primaryDomainUrl: isRecord(shop.primaryDomain)
        ? str(shop.primaryDomain.url)
        : '',
      localization: normalizeLocalization(result.data.localization),
      publicApiVersions,
      respondedApiVersion: responded,
      apiVersionOutdated:
        !pinnedSupported ||
        (responded !== null && responded !== SHOPIFY_STOREFRONT_API_VERSION),
    };
  }

  /** Markets for the context switcher; `country`/`language` are what Shopify applied. */
  localization(options: RequestOptions = {}): Promise<LocalizationInfo> {
    return this.query(
      {
        name: 'Localization',
        query: LOCALIZATION_QUERY,
        variables: this.contextVariables(),
        ttl: NODE_CACHE_TTL_MS,
        normalize: (data) => normalizeLocalization(data.localization),
      },
      options.signal,
    );
  }

  /**
   * The market Shopify applied to this client's requests (`extensions.context`),
   * which can differ from `context`: languages a market doesn't publish fall
   * back silently, e.g. `{ country: 'US', language: 'FR' }` is answered in
   * `EN`. `null` until a priced request of this context has reached Shopify
   * (cached results remember it for `NODE_CACHE_TTL_MS`).
   */
  appliedContext(): ShopifyContext | null {
    const raw = this.transport.cache.get(this.appliedContextKey());
    if (!isRecord(raw)) {
      return null;
    }
    const applied = normalizeContext({
      country: str(raw.country),
      language: str(raw.language),
    });
    return applied.country || applied.language ? applied : null;
  }

  /**
   * Whether the capabilities are known without probing: saved in the
   * settings, detected in this tab (cached for 30 minutes), or tokenless.
   * When false, the picker calls `detectCapabilities` before relying on them.
   */
  hasKnownCapabilities(): boolean {
    return this.transport.hasKnownCapabilities();
  }

  /**
   * Probes the optional scopes, always over the network (settings re-checks
   * rely on that), and caches the result for this store connection.
   * ACCESS_DENIED or an empty-by-policy answer means `false`; tokenless
   * stores have none. `metafields` is always `false`: the Storefront API has
   * no metafields scope to detect (see queries.ts), and the key stays because
   * saved capabilities require it.
   */
  async detectCapabilities(
    options: RequestOptions = {},
  ): Promise<StoreCapabilities> {
    const checkedAt = new Date(this.transport.now()).toISOString();
    if (this.transport.tokenless) {
      return { tags: false, inventory: false, metafields: false, checkedAt };
    }
    const [tags, inventory] = await Promise.all([
      this.probe(PROBE_TAGS_QUERY, 'productTags', options.signal),
      this.probe(PROBE_INVENTORY_QUERY, 'totalInventory', options.signal),
    ]);
    const capabilities: StoreCapabilities = {
      tags: tags.granted && stringNodes(tags.data.productTags).length > 0,
      inventory:
        inventory.granted && nodesOf(inventory.data.products).length > 0,
      metafields: false,
      checkedAt,
    };
    this.transport.applyDetected(capabilities);
    return capabilities;
  }

  // -- Internals --------------------------------------------------------------

  private contextVariables(): {
    country: string | null;
    language: string | null;
  } {
    return {
      country: this.context.country ?? null,
      language: this.context.language ?? null,
    };
  }

  /**
   * Whether the token can read `field`. A denied field, or a GraphQL
   * ACCESS_DENIED that nulls the whole probe, means no; HTTP errors, network
   * failures and aborts propagate, since they say nothing about the scope.
   */
  private async probe(
    query: string,
    field: string,
    signal?: AbortSignal,
  ): Promise<{ granted: boolean; data: Record<string, unknown> }> {
    try {
      const result = await this.transport.request(query, {}, signal, {
        allowDenied: true,
      });
      return {
        granted: !result.deniedFields.includes(field),
        data: result.data,
      };
    } catch (error) {
      if (
        error instanceof ShopifyClientError &&
        error.code === 'forbidden' &&
        error.status === null
      ) {
        return { granted: false, data: {} };
      }
      throw error;
    }
  }

  private cacheKey(
    name: string,
    features: QueryFeatures,
    variables: GraphqlVariables,
  ): string {
    return [
      this.namespace,
      name,
      featuresKey(features),
      stableSerialize(variables),
    ].join('|');
  }

  private async query<T>(
    operation: QueryOperation<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      throw createAbortError();
    }
    const requested = this.transport.featuresFor(operation.query);
    const cached = this.readCached(
      this.cacheKey(operation.name, requested, operation.variables),
      (data) => operation.normalize(data, requested),
    );
    if (cached) {
      return cached.value;
    }
    // The capabilities can shrink during the request (ACCESS_DENIED), so the
    // result is cached under the ones it was actually fetched with.
    const { result, features } = await this.transport.requestDocument(
      operation.query,
      operation.variables,
      signal,
    );
    const value = operation.normalize(result.data, features);
    this.transport.cache.set(
      this.cacheKey(operation.name, features, operation.variables),
      result.data,
      operation.ttl,
    );
    this.rememberAppliedContext(result.appliedContext);
    for (const node of operation.nodes?.(value) ?? []) {
      if (node) {
        this.writeNode(node);
      }
    }
    return value;
  }

  private appliedContextKey(): string {
    return `${this.namespace}|applied-context`;
  }

  private rememberAppliedContext(applied: ShopifyContext | null): void {
    if (!applied) {
      return;
    }
    const current = this.appliedContext();
    if (current && contextKey(current) === contextKey(applied)) {
      return;
    }
    this.transport.cache.set(
      this.appliedContextKey(),
      applied,
      NODE_CACHE_TTL_MS,
    );
  }

  private readCached<T>(
    key: string,
    normalize: (data: Record<string, unknown>) => T,
  ): { value: T } | null {
    const raw = this.transport.cache.get(key);
    if (!isRecord(raw)) {
      return null;
    }
    try {
      return { value: normalize(raw) };
    } catch {
      this.transport.cache.delete(key);
      return null;
    }
  }

  private nodeKey(id: string): string {
    return `${this.namespace}|node|${id}`;
  }

  private writeNode(node: ShopifyNode): void {
    this.transport.cache.set(this.nodeKey(node.id), node, NODE_CACHE_TTL_MS);
  }

  /** A node, `null` for IDs that can never resolve, or undefined to fetch. */
  private cachedNode(id: string): ShopifyNode | null | undefined {
    if (kindOfGid(id) === null) {
      return null;
    }
    const raw = this.transport.cache.get(this.nodeKey(id));
    if (raw === undefined) {
      return undefined;
    }
    const node = normalizeNode(raw);
    if (!node) {
      this.transport.cache.delete(this.nodeKey(id));
      return undefined;
    }
    return node;
  }

  private enqueueNode(id: string): {
    batch: NodeBatch;
    promise: Promise<ShopifyNode | null>;
  } {
    const current = this.nodeLoads.get(id);
    const shared = current?.entries.get(id);
    if (current && shared && !current.controller.signal.aborted) {
      return { batch: current, promise: shared.promise };
    }
    const batch = this.openBatch();
    const deferred =
      batch.entries.get(id) ?? createDeferred<ShopifyNode | null>();
    batch.entries.set(id, deferred);
    this.nodeLoads.set(id, batch);
    return { batch, promise: deferred.promise };
  }

  private openBatch(): NodeBatch {
    if (this.pendingBatch && !this.pendingBatch.controller.signal.aborted) {
      return this.pendingBatch;
    }
    const batch: NodeBatch = {
      controller: new AbortController(),
      consumers: 0,
      entries: new Map(),
    };
    this.pendingBatch = batch;
    queueMicrotask(() => this.flushBatch(batch));
    return batch;
  }

  private flushBatch(batch: NodeBatch): void {
    if (this.pendingBatch === batch) {
      this.pendingBatch = null;
    }
    const ids = [...batch.entries.keys()];
    for (const chunkIds of chunk(ids, SHOPIFY_MAX_PAGE_SIZE)) {
      void this.fetchNodeChunk(batch, chunkIds);
    }
  }

  private async fetchNodeChunk(batch: NodeBatch, ids: string[]): Promise<void> {
    try {
      const { result } = await this.transport.requestDocument(
        hydrateQuery,
        { ids, ...this.contextVariables() },
        batch.controller.signal,
      );
      this.rememberAppliedContext(result.appliedContext);
      const nodes = requireArray(result.data.nodes, 'nodes');
      for (const [index, id] of ids.entries()) {
        const node = normalizeNode(nodes[index]);
        if (node) {
          this.transport.cache.set(this.nodeKey(id), node, NODE_CACHE_TTL_MS);
        }
        batch.entries.get(id)?.resolve(node);
      }
    } catch (error) {
      for (const id of ids) {
        batch.entries.get(id)?.reject(error);
      }
    } finally {
      for (const id of ids) {
        if (this.nodeLoads.get(id) === batch) {
          this.nodeLoads.delete(id);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shared instances
// ---------------------------------------------------------------------------

const transports = new Map<string, ShopifyTransport>();

function transportKey(store: StoreConnection): string {
  const shop = store.shopDomain.trim().toLowerCase();
  return store.tokenless
    ? `${shop}|tokenless`
    : `${shop}|token:${store.storefrontAccessToken}`;
}

/**
 * The shared client for a store connection and market. Calls with the same
 * shop, token and tokenless flag share requests, batching, cache and
 * capability state. Omitting `context` uses the store's default market.
 */
export function getShopifyClient(
  store: StoreConnection,
  context?: ShopifyContext,
): ShopifyClient {
  const key = transportKey(store);
  let transport = transports.get(key);
  if (transport) {
    transport.updateStore(store);
  } else {
    transport = new ShopifyTransport({ store });
    transports.set(key, transport);
  }
  return transport.clientFor(
    normalizeContext(context ?? storeDefaultContext(store)),
  );
}

/** Forgets shared clients and the once-per-session warning (tests, store changes). */
export function resetShopifyClients(): void {
  transports.clear();
  apiVersionWarned = false;
}
