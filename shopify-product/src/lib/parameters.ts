/**
 * Plugin and field parameters: normalization, migration and validation.
 *
 * Parameters reach the plugin as untyped JSON, in any shape a past version
 * saved. Every read path runs them through these normalizers, so users who
 * can't edit the schema (and never run the `onBoot` migration) still work.
 *
 * Plugin parameter history:
 * - v1: `{ shopifyDomain, storefrontAccessToken }`.
 * - v2: adds `paramsVersion: '2'`, `autoApplyToFieldsWithApiKey` and
 *   `useDemoStore`. `shopifyDomain` is the bare subdomain (`acme`).
 * - v3: a list of store connections (`PluginParametersV3`).
 *
 * Field parameters were always empty in 1.x, so empty parameters mean the
 * legacy behaviour: a product handle (string) or the 1.x product JSON (JSON).
 */

import { ADMIN_TOKEN_PREFIXES } from '../constants';
import {
  type Cardinality,
  DEMO_STORE,
  type FieldParametersV1,
  type FieldScope,
  type FieldType,
  type PluginParametersV3,
  type ShopifyKind,
  type StorageFormat,
  type StoreCapabilities,
  type StoreConnection,
} from '../types';
import { kindOfGid } from './gid';
import { hasExactKeys, isNonEmptyString, isRecord } from './guards';

// ---------------------------------------------------------------------------
// Shop domain and token
// ---------------------------------------------------------------------------

export type ShopDomainResult =
  | { ok: true; domain: string }
  | { ok: false; error: string };

const MYSHOPIFY_SUFFIX = '.myshopify.com';
const ADMIN_HOST = 'admin.shopify.com';
/** A DNS label: lowercase letters, digits and inner hyphens. */
const SHOP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ANY_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//;
const HTTP_SCHEME_PATTERN = /^https?:\/\/+/;
/**
 * `host[:port][/path][?query][#fragment]`. A colon must start a numeric
 * port and the path can't start with `//`, so mistyped schemes such as
 * `https:/acme…` or `https//acme…` don't parse as a shop called `https`.
 */
const AUTHORITY_PATTERN =
  /^([^/?#:\\@\s]+)(?::\d+)?(\/(?!\/)[^?#]*)?(?:[?#]|$)/;

export const EMPTY_SHOP_DOMAIN_ERROR = 'Enter your shop domain';
export const CUSTOM_DOMAIN_ERROR =
  'Enter your .myshopify.com domain (Shopify admin → Settings → Domains)';
export const INVALID_SHOP_DOMAIN_ERROR =
  'Enter a valid shop domain, like acme.myshopify.com';

export const ADMIN_TOKEN_ERROR =
  "This is an Admin API token. Never paste it here: every editor's browser can read plugin settings. Use the public token from the Headless channel.";
export const EMPTY_TOKEN_ERROR =
  'Enter the Storefront access token, or connect without a token';
export const TOKEN_WHITESPACE_ERROR =
  'Remove the spaces or line breaks from the token';

type ShopNameLookup = { name: string } | { error: string };
type DomainInput = { host: string; pathname: string };

/**
 * Splits a lowercased domain or http(s) URL into host and path. This avoids
 * the WHATWG URL parser on purpose: it reads a bare `12345` as the IPv4
 * address `0.0.48.57`, and numeric shop names are valid.
 */
function parseDomainInput(value: string): DomainInput | null {
  if (ANY_SCHEME_PATTERN.test(value) && !HTTP_SCHEME_PATTERN.test(value)) {
    return null;
  }
  const match = AUTHORITY_PATTERN.exec(value.replace(HTTP_SCHEME_PATTERN, ''));
  if (!match) return null;
  const [, host = '', pathname = ''] = match;
  return { host: host.replace(/\.$/, ''), pathname };
}

/** `admin.shopify.com/store/acme/…` → `acme`. */
function shopNameFromAdminPath(pathname: string): ShopNameLookup {
  const [first, second] = pathname.split('/').filter(Boolean);
  return first === 'store' && second
    ? { name: second }
    : { error: INVALID_SHOP_DOMAIN_ERROR };
}

function shopNameFromInput({ host, pathname }: DomainInput): ShopNameLookup {
  if (host === ADMIN_HOST) return shopNameFromAdminPath(pathname);
  if (host.endsWith(MYSHOPIFY_SUFFIX)) {
    return { name: host.slice(0, -MYSHOPIFY_SUFFIX.length) };
  }
  if (host.includes('.')) return { error: CUSTOM_DOMAIN_ERROR };
  return { name: host };
}

function isValidShopName(name: string): boolean {
  return SHOP_NAME_PATTERN.test(name) && !name.startsWith('xn--');
}

/**
 * Turns whatever a merchant pastes (`acme`, `acme.myshopify.com`, a
 * storefront or admin URL) into `acme.myshopify.com`. Custom domains are
 * rejected: the Storefront API only answers on the `.myshopify.com` host.
 */
export function normalizeShopDomain(input: string): ShopDomainResult {
  const value = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (!value) return { ok: false, error: EMPTY_SHOP_DOMAIN_ERROR };

  const parsed = parseDomainInput(value);
  if (!parsed) return { ok: false, error: INVALID_SHOP_DOMAIN_ERROR };

  const lookup = shopNameFromInput(parsed);
  if ('error' in lookup) return { ok: false, error: lookup.error };
  if (!isValidShopName(lookup.name)) {
    return { ok: false, error: INVALID_SHOP_DOMAIN_ERROR };
  }

  return { ok: true, domain: `${lookup.name}${MYSHOPIFY_SUFFIX}` };
}

function isAdminToken(token: string): boolean {
  const lowered = token.toLowerCase();
  return ADMIN_TOKEN_PREFIXES.some((prefix) => lowered.startsWith(prefix));
}

/** Returns an actionable error, or null when the token can be saved. */
export function validateStorefrontToken(
  token: string,
  tokenless: boolean,
): string | null {
  if (tokenless) return null;
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed) return EMPTY_TOKEN_ERROR;
  if (isAdminToken(trimmed)) return ADMIN_TOKEN_ERROR;
  if (/\s/.test(trimmed)) return TOKEN_WHITESPACE_ERROR;
  return null;
}

// ---------------------------------------------------------------------------
// Store connections
// ---------------------------------------------------------------------------

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
/** `EN`, `FIL`, `PT_BR`, `ZH_TW`, … (Storefront `LanguageCode`). */
const LANGUAGE_CODE_PATTERN = /^[A-Z]{2,3}(?:_[A-Z]{2})?$/;

function normalizeCode(value: unknown, pattern: RegExp): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toUpperCase().replace(/-/g, '_');
  return pattern.test(code) ? code : undefined;
}

function normalizeLabel(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value.trim() : undefined;
}

const CAPABILITY_KEYS = ['tags', 'inventory', 'metafields', 'checkedAt'];

/** Saved (or cached) capabilities, or undefined unless every key is well formed. */
export function normalizeCapabilities(
  value: unknown,
): StoreCapabilities | undefined {
  if (!isRecord(value)) return undefined;
  const { tags, inventory, metafields, checkedAt } = value;
  const wellFormed =
    typeof tags === 'boolean' &&
    typeof inventory === 'boolean' &&
    typeof metafields === 'boolean' &&
    typeof checkedAt === 'string';
  if (!wellFormed || !CAPABILITY_KEYS.every((key) => key in value)) {
    return undefined;
  }
  return { tags, inventory, metafields, checkedAt };
}

/** Builds an object without the keys whose value is undefined. */
function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as T;
}

/**
 * Returns a clean store connection, or null when it has no usable shop
 * domain. A tokenless store always carries an empty token.
 */
export function normalizeStoreConnection(
  value: unknown,
): StoreConnection | null {
  if (!isRecord(value)) return null;
  const domain = normalizeShopDomain(
    typeof value.shopDomain === 'string' ? value.shopDomain : '',
  );
  if (!domain.ok) return null;

  const tokenless = value.tokenless === true;
  const token =
    !tokenless && typeof value.storefrontAccessToken === 'string'
      ? value.storefrontAccessToken.trim()
      : '';

  return withoutUndefined<StoreConnection>({
    shopDomain: domain.domain,
    storefrontAccessToken: token,
    tokenless,
    label: normalizeLabel(value.label),
    defaultCountry: normalizeCode(value.defaultCountry, COUNTRY_CODE_PATTERN),
    defaultLanguage: normalizeCode(
      value.defaultLanguage,
      LANGUAGE_CODE_PATTERN,
    ),
    capabilities: normalizeCapabilities(value.capabilities),
  });
}

function dedupeStores(stores: StoreConnection[]): StoreConnection[] {
  const seen = new Set<string>();
  const result: StoreConnection[] = [];
  for (const store of stores) {
    if (seen.has(store.shopDomain)) continue;
    seen.add(store.shopDomain);
    result.push(store);
  }
  return result;
}

function normalizeStoreList(value: unknown): StoreConnection[] {
  if (!Array.isArray(value)) return [];
  const stores: StoreConnection[] = [];
  for (const candidate of value) {
    const store = normalizeStoreConnection(candidate);
    if (store) stores.push(store);
  }
  return dedupeStores(stores);
}

/** v1/v2 kept one store as `shopifyDomain` (usually the bare subdomain). */
function legacyStores(raw: Record<string, unknown>): StoreConnection[] {
  const store = normalizeStoreConnection({
    shopDomain: raw.shopifyDomain,
    storefrontAccessToken: raw.storefrontAccessToken,
    tokenless: false,
  });
  return store ? [store] : [];
}

function isV3Shape(raw: Record<string, unknown>): boolean {
  return raw.paramsVersion === '3' || Array.isArray(raw.stores);
}

/** Migrates any historical plugin parameters (or garbage) to v3. */
export function normalizePluginParameters(raw: unknown): PluginParametersV3 {
  const value = isRecord(raw) ? raw : {};
  return {
    paramsVersion: '3',
    stores: isV3Shape(value)
      ? normalizeStoreList(value.stores)
      : legacyStores(value),
    useDemoStore: value.useDemoStore === true,
    autoApplyToFieldsWithApiKey:
      typeof value.autoApplyToFieldsWithApiKey === 'string'
        ? value.autoApplyToFieldsWithApiKey
        : '',
  };
}

function areArraysEqual(a: unknown[], b: unknown[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => isDeepEqual(item, b[index]))
  );
}

function areRecordsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keys = Object.keys(a);
  return (
    hasExactKeys(b, keys) && keys.every((key) => isDeepEqual(a[key], b[key]))
  );
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return areArraysEqual(a, b);
  if (isRecord(a) && isRecord(b)) return areRecordsEqual(a, b);
  return false;
}

/**
 * True when the raw parameters are already exactly their normalized form, so
 * `onBoot` can skip writing them.
 */
export function isCurrentPluginParameters(raw: unknown): boolean {
  return isDeepEqual(raw, normalizePluginParameters(raw));
}

/** The stores editors can use right now: only the demo store in demo mode. */
export function getActiveStores(params: PluginParametersV3): StoreConnection[] {
  return params.useDemoStore ? [DEMO_STORE] : params.stores;
}

/**
 * The store a field talks to. Without a `shopDomain` the field uses the
 * default store (index 0). With one, it uses that store, or null when the
 * store is no longer configured. Demo mode always uses the demo store.
 */
export function resolveFieldStore(
  params: PluginParametersV3,
  shopDomain?: string,
): StoreConnection | null {
  if (params.useDemoStore) return DEMO_STORE;
  if (!shopDomain) return params.stores[0] ?? null;
  const normalized = normalizeShopDomain(shopDomain);
  if (!normalized.ok) return null;
  return (
    params.stores.find((store) => store.shopDomain === normalized.domain) ??
    null
  );
}

/** A store with a valid domain and a usable token (or tokenless access). */
export function isStoreUsable(store: StoreConnection): boolean {
  return (
    normalizeShopDomain(store.shopDomain).ok &&
    validateStorefrontToken(store.storefrontAccessToken, store.tokenless) ===
      null
  );
}

/** True when at least one active store can be queried. */
export function isPluginConfigured(params: PluginParametersV3): boolean {
  return getActiveStores(params).some(isStoreUsable);
}

export function storeLabel(store: StoreConnection): string {
  return store.label?.trim() || store.shopDomain;
}

// ---------------------------------------------------------------------------
// Field parameters: combinations
// ---------------------------------------------------------------------------

const KINDS: ShopifyKind[] = ['product', 'variant', 'collection'];
const CARDINALITIES: Cardinality[] = ['single', 'multiple'];
const FORMATS: StorageFormat[] = [
  'handle',
  'gid',
  'reference',
  'legacyProductJson',
];

const FORMATS_BY_FIELD_TYPE: Record<FieldType, StorageFormat[]> = {
  string: ['handle', 'gid'],
  json: ['reference', 'legacyProductJson'],
};

const KINDS_BY_FORMAT: Record<StorageFormat, ShopifyKind[]> = {
  handle: ['product', 'collection'],
  gid: ['product', 'variant', 'collection'],
  reference: ['product', 'variant', 'collection'],
  legacyProductJson: ['product'],
};

/** Every 1.x field: empty parameters behave exactly like this. */
export const LEGACY_FIELD_PARAMETERS: Record<FieldType, FieldParametersV1> = {
  string: {
    paramsVersion: '1',
    kind: 'product',
    cardinality: 'single',
    format: 'handle',
    snapshot: false,
  },
  json: {
    paramsVersion: '1',
    kind: 'product',
    cardinality: 'single',
    format: 'legacyProductJson',
    snapshot: false,
  },
};

export function allowedFormats(fieldType: FieldType): StorageFormat[] {
  return [...FORMATS_BY_FIELD_TYPE[fieldType]];
}

export function allowedKinds(format: StorageFormat): ShopifyKind[] {
  return [...KINDS_BY_FORMAT[format]];
}

export function allowedCardinalities(format: StorageFormat): Cardinality[] {
  return format === 'reference' ? ['single', 'multiple'] : ['single'];
}

export function isValidCombination(
  fieldType: FieldType,
  params: Pick<
    FieldParametersV1,
    'kind' | 'cardinality' | 'format' | 'snapshot'
  >,
): boolean {
  return (
    FORMATS_BY_FIELD_TYPE[fieldType].includes(params.format) &&
    KINDS_BY_FORMAT[params.format].includes(params.kind) &&
    allowedCardinalities(params.format).includes(params.cardinality) &&
    (!params.snapshot || params.format === 'reference')
  );
}

/** Settings for a field a developer configures from scratch in 2.0. */
export function defaultFieldParameters(
  fieldType: FieldType,
): FieldParametersV1 {
  return {
    paramsVersion: '1',
    kind: 'product',
    cardinality: 'single',
    format: fieldType === 'json' ? 'reference' : 'handle',
    snapshot: false,
  };
}

/** True for `undefined`, `null` and `{}`: what every 1.x field has. */
export function isEmptyFieldParameters(raw: unknown): boolean {
  return (
    raw === undefined ||
    raw === null ||
    (isRecord(raw) && Object.keys(raw).length === 0)
  );
}

// ---------------------------------------------------------------------------
// Field parameters: normalization
// ---------------------------------------------------------------------------

function isKind(value: unknown): value is ShopifyKind {
  return KINDS.includes(value as ShopifyKind);
}

function isCardinality(value: unknown): value is Cardinality {
  return CARDINALITIES.includes(value as Cardinality);
}

function isFormat(value: unknown): value is StorageFormat {
  return FORMATS.includes(value as StorageFormat);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function trimmedOrUndefined(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value.trim() : undefined;
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags: string[] = [];
  for (const tag of value) {
    const trimmed = trimmedOrUndefined(tag);
    if (trimmed && !tags.includes(trimmed)) tags.push(trimmed);
  }
  return tags.length > 0 ? tags : undefined;
}

function normalizeCollectionId(value: unknown): string | undefined {
  const id = trimmedOrUndefined(value);
  return id && kindOfGid(id) === 'collection' ? id : undefined;
}

/** Returns the clean scope, or undefined when nothing in it is usable. */
export function normalizeScope(value: unknown): FieldScope | undefined {
  if (!isRecord(value)) return undefined;
  const collectionId = normalizeCollectionId(value.collectionId);
  const scope = withoutUndefined<FieldScope>({
    collectionId,
    collectionTitle: collectionId
      ? trimmedOrUndefined(value.collectionTitle)
      : undefined,
    productType: trimmedOrUndefined(value.productType),
    vendor: trimmedOrUndefined(value.vendor),
    tags: normalizeTags(value.tags),
    availableOnly: value.availableOnly === true ? true : undefined,
  });
  return Object.keys(scope).length > 0 ? scope : undefined;
}

type Limits = { min?: number; max?: number };

function normalizeLimits(
  raw: Record<string, unknown>,
  cardinality: Cardinality,
): Limits {
  if (cardinality !== 'multiple') return {};
  const max =
    isNonNegativeInteger(raw.max) && raw.max >= 1 ? raw.max : undefined;
  const min = isNonNegativeInteger(raw.min) ? raw.min : undefined;
  const minFits = min !== undefined && (max === undefined || min <= max);
  return withoutUndefined<Limits>({ min: minFits ? min : undefined, max });
}

function normalizeFieldShopDomain(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = normalizeShopDomain(value);
  return result.ok ? result.domain : undefined;
}

type Combination = Pick<
  FieldParametersV1,
  'kind' | 'cardinality' | 'format' | 'snapshot'
>;

function coerceCombination(
  raw: Record<string, unknown>,
  fieldType: FieldType,
): Combination {
  const format =
    isFormat(raw.format) &&
    FORMATS_BY_FIELD_TYPE[fieldType].includes(raw.format)
      ? raw.format
      : LEGACY_FIELD_PARAMETERS[fieldType].format;
  const kind =
    isKind(raw.kind) && KINDS_BY_FORMAT[format].includes(raw.kind)
      ? raw.kind
      : 'product';
  const cardinality =
    raw.cardinality === 'multiple' && format === 'reference'
      ? 'multiple'
      : 'single';
  const snapshot = raw.snapshot === true && format === 'reference';
  return { kind, cardinality, format, snapshot };
}

/**
 * Returns field parameters that are always a valid combination for the
 * field type. Empty or unknown parameters become the legacy defaults, so 1.x
 * fields keep reading and writing exactly what they did.
 */
export function normalizeFieldParameters(
  raw: unknown,
  fieldType: FieldType,
): FieldParametersV1 {
  if (!isRecord(raw) || raw.paramsVersion !== '1') {
    return { ...LEGACY_FIELD_PARAMETERS[fieldType] };
  }
  const combination = coerceCombination(raw, fieldType);
  return withoutUndefined<FieldParametersV1>({
    paramsVersion: '1',
    ...combination,
    shopDomain: normalizeFieldShopDomain(raw.shopDomain),
    scope: normalizeScope(raw.scope),
    ...normalizeLimits(raw, combination.cardinality),
  });
}

// ---------------------------------------------------------------------------
// Field parameters: validation
// ---------------------------------------------------------------------------

export type FieldParameterErrors = Record<string, string>;

function isUnset(value: unknown): boolean {
  return value === undefined || value === null;
}

function kindFormatError(
  kind: ShopifyKind,
  format: StorageFormat,
): string | null {
  if (KINDS_BY_FORMAT[format].includes(kind)) return null;
  if (format === 'legacyProductJson') {
    return 'Legacy product JSON can only store products';
  }
  return 'Variants can only be stored as a Shopify ID or a reference document';
}

function validateCombination(
  raw: Record<string, unknown>,
  errors: FieldParameterErrors,
): void {
  const { kind, cardinality, format, snapshot } = raw;
  if (!isKind(kind)) errors.kind = 'Choose products, variants or collections';
  if (!isCardinality(cardinality)) {
    errors.cardinality = 'Choose one or multiple items';
  }
  if (!isFormat(format)) {
    errors.format = 'Choose how the value is stored';
    return;
  }
  const kindError = isKind(kind) ? kindFormatError(kind, format) : null;
  if (kindError) errors.kind = kindError;
  if (cardinality === 'multiple' && format !== 'reference') {
    errors.cardinality =
      'Multiple items can only be stored in a reference document';
  }
  if (!isUnset(snapshot) && typeof snapshot !== 'boolean') {
    errors.snapshot = 'Turn the display snapshot on or off';
  } else if (snapshot === true && format !== 'reference') {
    errors.snapshot =
      'The display snapshot is only available for reference documents';
  }
}

function limitError(
  value: unknown,
  label: 'Minimum' | 'Maximum',
  lowest: number,
): string | null {
  if (isUnset(value)) return null;
  if (!isNonNegativeInteger(value)) return `${label} must be a whole number`;
  if (value < lowest) return `${label} must be at least ${lowest}`;
  return null;
}

function validateLimits(
  raw: Record<string, unknown>,
  errors: FieldParameterErrors,
): void {
  const minError = limitError(raw.min, 'Minimum', 0);
  const maxError = limitError(raw.max, 'Maximum', 1);
  if (minError) errors.min = minError;
  if (maxError) errors.max = maxError;
  if (minError || maxError) return;

  const hasLimits = !isUnset(raw.min) || !isUnset(raw.max);
  if (hasLimits && raw.cardinality !== 'multiple') {
    const message = 'Limits only apply when editors can pick multiple items';
    if (!isUnset(raw.min)) errors.min = message;
    if (!isUnset(raw.max)) errors.max = message;
    return;
  }
  if (
    typeof raw.min === 'number' &&
    typeof raw.max === 'number' &&
    raw.min > raw.max
  ) {
    errors.min = "Minimum can't be greater than maximum";
  }
}

function isOptionalString(value: unknown): boolean {
  return isUnset(value) || typeof value === 'string';
}

function isValidScopeCollectionId(value: unknown): boolean {
  if (isUnset(value)) return true;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed === '' || kindOfGid(trimmed) === 'collection';
}

function isStringList(value: unknown): boolean {
  return (
    isUnset(value) ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

function scopeError(scope: unknown): string | null {
  if (isUnset(scope)) return null;
  if (!isRecord(scope)) return 'Limit choices must be an object';
  if (!isValidScopeCollectionId(scope.collectionId)) {
    return 'The collection must be a Shopify collection ID (gid://shopify/Collection/…)';
  }
  if (!isStringList(scope.tags)) return 'Tags must be a list of text values';
  if (!isOptionalString(scope.productType) || !isOptionalString(scope.vendor)) {
    return 'Product type and vendor must be text';
  }
  return null;
}

function shopDomainError(value: unknown): string | null {
  if (isUnset(value) || value === '') return null;
  if (typeof value !== 'string') return INVALID_SHOP_DOMAIN_ERROR;
  const result = normalizeShopDomain(value);
  return result.ok ? null : result.error;
}

/**
 * Checks internal consistency only: `validateManualFieldExtensionParameters`
 * doesn't receive the field type. Empty parameters (1.x fields) are valid.
 * Returns errors keyed by parameter name.
 */
export function validateFieldParameters(raw: unknown): FieldParameterErrors {
  if (isEmptyFieldParameters(raw)) return {};
  if (!isRecord(raw) || raw.paramsVersion !== '1') {
    return {
      paramsVersion:
        'Unsupported settings version: choose the options again and save',
    };
  }

  const errors: FieldParameterErrors = {};
  validateCombination(raw, errors);
  validateLimits(raw, errors);
  const scope = scopeError(raw.scope);
  if (scope) errors.scope = scope;
  const shopDomain = shopDomainError(raw.shopDomain);
  if (shopDomain) errors.shopDomain = shopDomain;
  return errors;
}
