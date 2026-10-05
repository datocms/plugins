/**
 * Display helpers for Shopify nodes: prices, titles, meta lines,
 * availability, admin and storefront URLs, and locale mapping.
 */

import type {
  Money,
  ShopifyImage,
  ShopifyKind,
  ShopifyNode,
  VariantSummary,
} from '../types';
import { decodeShopifyId, kindOfGid, numericIdFromGid } from './gid';
import { DEFAULT_VARIANT_TITLE, variantDisplayTitle } from './titles';

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

const FALLBACK_LOCALE = 'en';

const formatterCache = new Map<string, Intl.NumberFormat | null>();

/** `Intl` rejects `en_US`; DatoCMS locales use dashes (`pt-BR`). */
function normalizeLocale(locale: string): string {
  return String(locale ?? '')
    .trim()
    .replace(/_/g, '-');
}

/** A cached currency formatter, or null when `Intl` rejects the arguments. */
function currencyFormatter(
  locale: string,
  currency: string,
): Intl.NumberFormat | null {
  const key = `${locale}|${currency}`;
  const cached = formatterCache.get(key);
  if (cached !== undefined) return cached;
  let formatter: Intl.NumberFormat | null = null;
  try {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  } catch {
    formatter = null;
  }
  formatterCache.set(key, formatter);
  return formatter;
}

/** A finite number from Shopify's decimal string, or null. */
function parseAmount(amount: unknown): number | null {
  const raw = String(amount ?? '').trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function currencyOf(money: Money): string {
  return String(money.currencyCode ?? '')
    .trim()
    .toUpperCase();
}

/** `40.00 CAD`: used when `Intl` can't format the currency. */
function plainMoney(money: Money): string {
  const value = parseAmount(money.amount);
  const amount =
    value === null ? String(money.amount ?? '').trim() : value.toFixed(2);
  return [amount, currencyOf(money)].filter(Boolean).join(' ');
}

/**
 * Formats a Shopify `MoneyV2` for the editor's locale (`ctx.ui.locale`:
 * `en`, `it`, `pt-BR`, `zh-CN`, …). An invalid locale falls back to English
 * and an invalid currency to `40.00 CAD`.
 */
export function formatMoney(money: Money, locale: string): string {
  const value = parseAmount(money.amount);
  const currency = currencyOf(money);
  if (value === null || !currency) return plainMoney(money);
  const formatter =
    currencyFormatter(normalizeLocale(locale), currency) ??
    currencyFormatter(FALLBACK_LOCALE, currency);
  return formatter ? formatter.format(value) : plainMoney(money);
}

function sameMoney(a: Money, b: Money): boolean {
  if (currencyOf(a) !== currencyOf(b)) return false;
  const left = parseAmount(a.amount);
  const right = parseAmount(b.amount);
  if (left === null || right === null) {
    return String(a.amount).trim() === String(b.amount).trim();
  }
  return left === right;
}

/** One price when min and max are equal, otherwise `from – to`. */
export function formatPriceRange(
  min: Money,
  max: Money,
  locale: string,
): string {
  const from = formatMoney(min, locale);
  if (sameMoney(min, max)) return from;
  return `${from} – ${formatMoney(max, locale)}`;
}

/** True when the compare-at price is strictly greater, in the same currency. */
export function hasCompareAtPrice(
  price: Money,
  compareAt: Money | null | undefined,
): boolean {
  if (!compareAt || currencyOf(price) !== currencyOf(compareAt)) return false;
  const current = parseAmount(price.amount);
  const previous = parseAmount(compareAt.amount);
  return current !== null && previous !== null && previous > current;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const MYSHOPIFY_SUFFIX = '.myshopify.com';

/**
 * `acme.myshopify.com` → `acme`. Also tolerates a protocol, a path and a bare
 * subdomain. Returns `''` for anything that isn't a `.myshopify.com` domain,
 * since a custom domain doesn't tell us the store's admin handle.
 */
export function shopSubdomain(shopDomain: string): string {
  const host =
    String(shopDomain ?? '')
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .split(/[/?#]/)[0] ?? '';
  const subdomain = host.endsWith(MYSHOPIFY_SUFFIX)
    ? host.slice(0, -MYSHOPIFY_SUFFIX.length)
    : host;
  return /^[a-z0-9][a-z0-9-]*$/.test(subdomain) ? subdomain : '';
}

/** The numeric part of a GID (or base64 GID) of the expected kind. */
function numericIdOfKind(id: unknown, kind: ShopifyKind): string | null {
  const gid = decodeShopifyId(id);
  if (!gid || kindOfGid(gid) !== kind) return null;
  return numericIdFromGid(gid);
}

export type AdminUrlTarget = {
  kind: ShopifyKind;
  id: string;
  /** Required for variants. */
  productId?: string | null;
};

function adminPath(target: AdminUrlTarget): string | null {
  const numericId = numericIdOfKind(target.id, target.kind);
  if (!numericId) return null;
  if (target.kind === 'product') return `products/${numericId}`;
  if (target.kind === 'collection') return `collections/${numericId}`;
  const productNumericId = numericIdOfKind(target.productId, 'product');
  return productNumericId
    ? `products/${productNumericId}/variants/${numericId}`
    : null;
}

/**
 * `https://admin.shopify.com/store/{sub}/products/{id}`, with
 * `/products/{productId}/variants/{id}` for variants and `/collections/{id}`
 * for collections. Null when the ID doesn't match the kind, a variant has no
 * product ID, or the shop isn't a `.myshopify.com` domain.
 */
export function adminUrl(
  shopDomain: string,
  target: AdminUrlTarget,
): string | null {
  const subdomain = shopSubdomain(shopDomain);
  const path = adminPath(target);
  if (!subdomain || !path) return null;
  return `https://admin.shopify.com/store/${subdomain}/${path}`;
}

export function nodeKind(node: ShopifyNode): ShopifyKind {
  switch (node.__typename) {
    case 'Product':
      return 'product';
    case 'ProductVariant':
      return 'variant';
    default:
      return 'collection';
  }
}

/** `adminUrl` for a hydrated node (variants carry their product ID). */
export function adminUrlForNode(
  shopDomain: string,
  node: ShopifyNode,
): string | null {
  return adminUrl(shopDomain, {
    kind: nodeKind(node),
    id: node.id,
    productId: node.__typename === 'ProductVariant' ? node.product.id : null,
  });
}

const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * The trimmed URL when it is an absolute http(s) URL, else null. Storefront
 * URLs reach `href` and `window.open`, and they can come back from a
 * `sessionStorage` cache that other same-origin plugin iframes write, so
 * `javascript:`, `data:` and friends never get through.
 */
function webUrl(url: string | null | undefined): string | null {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) return null;
  try {
    return WEB_PROTOCOLS.has(new URL(trimmed).protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

/** Appends `name=value`, keeping an existing query string and hash. */
function withQueryParam(url: string, name: string, value: string): string {
  const hashIndex = url.indexOf('#');
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  let separator = '&';
  if (!base.includes('?')) separator = '?';
  else if (/[?&]$/.test(base)) separator = '';
  return `${base}${separator}${name}=${encodeURIComponent(value)}${hash}`;
}

function variantStorefrontUrl(node: VariantSummary): string | null {
  const productUrl = webUrl(node.product.onlineStoreUrl);
  if (!productUrl) return null;
  const variantId = numericIdOfKind(node.id, 'variant');
  return variantId
    ? withQueryParam(productUrl, 'variant', variantId)
    : productUrl;
}

/**
 * The node's page on the online store: the product URL plus `?variant=` for
 * variants. Null when there is no online store URL, which is common for
 * headless and password-protected stores, or when it isn't an http(s) URL.
 */
export function storefrontUrl(node: ShopifyNode): string | null {
  if (node.__typename === 'ProductVariant') return variantStorefrontUrl(node);
  return webUrl(node.onlineStoreUrl);
}

// ---------------------------------------------------------------------------
// Row display
// ---------------------------------------------------------------------------

/** Variants read `"Classic Tee — Black / M"`. */
export function nodeTitle(node: ShopifyNode): string {
  if (node.__typename === 'ProductVariant') {
    return variantDisplayTitle(node.product.title, node.title);
  }
  return node.title;
}

/** The variant's own image, else its product's featured image. */
export function nodeImage(node: ShopifyNode): ShopifyImage | null {
  switch (node.__typename) {
    case 'Product':
      return node.featuredImage ?? null;
    case 'ProductVariant':
      return node.image ?? node.product.featuredImage ?? null;
    default:
      return node.image ?? null;
  }
}

function joinParts(parts: Array<string | null | undefined>, separator: string) {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(separator);
}

function variantMeta(node: VariantSummary): string {
  const options = joinParts(
    node.selectedOptions
      .map((option) => option.value)
      .filter((value) => value.trim() !== DEFAULT_VARIANT_TITLE),
    ' / ',
  );
  const sku = node.sku?.trim();
  return joinParts([options, sku ? `SKU ${sku}` : null], ' · ');
}

/**
 * Products: `vendor · product type`. Variants: `Black / M · SKU TEE-BLK-M`
 * (Shopify's "Default Title" option is skipped). Collections: the handle, as
 * on the picker's collection cards (a field only ever holds one kind, so the
 * word "Collection" would say nothing).
 */
export function nodeMeta(node: ShopifyNode): string {
  switch (node.__typename) {
    case 'Product':
      return joinParts([node.vendor, node.productType], ' · ');
    case 'ProductVariant':
      return variantMeta(node);
    default:
      return joinParts([node.handle], '');
  }
}

export type AvailabilityTone = 'success' | 'danger' | 'neutral';

export type Availability = {
  /** `''` for collections. */
  label: string;
  tone: AvailabilityTone;
  /** Units in stock, only with the inventory capability and a known number. */
  quantity: number | null;
};

function knownQuantity(
  value: number | null | undefined,
  inventory: boolean,
): number | null {
  return inventory && typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

/**
 * Available / Sold out for products and variants. A variant that is for sale
 * but not in stock (overselling allowed) reads "Available to order".
 */
export function availability(
  node: ShopifyNode,
  options: { inventory?: boolean } = {},
): Availability {
  const inventory = options.inventory === true;
  if (node.__typename === 'Collection') {
    return { label: '', tone: 'neutral', quantity: null };
  }
  const quantity =
    node.__typename === 'Product'
      ? knownQuantity(node.totalInventory, inventory)
      : knownQuantity(node.quantityAvailable, inventory);
  if (!node.availableForSale) {
    return { label: 'Sold out', tone: 'danger', quantity };
  }
  if (node.__typename === 'ProductVariant' && node.currentlyNotInStock) {
    return { label: 'Available to order', tone: 'neutral', quantity };
  }
  return { label: 'Available', tone: 'success', quantity };
}

// ---------------------------------------------------------------------------
// Locales
// ---------------------------------------------------------------------------

/**
 * Legacy and sibling codes Shopify spells differently. Shopify's
 * `LanguageCode` has NB, NN and NO; HE, ID and YI (not IW, IN, JI); FIL (not
 * TL). Its only regional values are PT_BR, PT_PT, ZH_CN and ZH_TW (enum
 * introspected live on 2026-10).
 */
const LANGUAGE_ALIASES: Record<string, string[]> = {
  NB: ['NO'],
  NO: ['NB'],
  NN: ['NO'],
  IW: ['HE'],
  IN: ['ID'],
  JI: ['YI'],
  TL: ['FIL'],
};

const TRADITIONAL_CHINESE_REGIONS: ReadonlySet<string> = new Set([
  'TW',
  'HK',
  'MO',
]);

type ParsedLocale = {
  language: string;
  script: string | null;
  region: string | null;
};

function parseLocale(locale: string): ParsedLocale | null {
  const [language, ...subtags] = normalizeLocale(locale)
    .split('-')
    .filter(Boolean);
  if (!language || !/^[a-z]{2,3}$/i.test(language)) return null;
  const script = subtags.find((tag) => /^[a-z]{4}$/i.test(tag)) ?? null;
  const region = subtags.find((tag) => /^([a-z]{2}|\d{3})$/i.test(tag)) ?? null;
  return {
    language: language.toUpperCase(),
    script: script ? script.toLowerCase() : null,
    region: region ? region.toUpperCase() : null,
  };
}

/** `zh-Hant`, `zh-TW`, `zh-HK` → ZH_TW; `zh-Hans`, `zh-CN`, `zh-SG` → ZH_CN. */
function chineseCode({ script, region }: ParsedLocale): string | null {
  if (script === 'hant') return 'ZH_TW';
  if (script === 'hans') return 'ZH_CN';
  if (!region) return null;
  return TRADITIONAL_CHINESE_REGIONS.has(region) ? 'ZH_TW' : 'ZH_CN';
}

function regionalCode(parsed: ParsedLocale): string | null {
  if (parsed.language === 'ZH') return chineseCode(parsed);
  return parsed.region ? `${parsed.language}_${parsed.region}` : null;
}

/** Most specific first: `PT_BR`, then `PT`, then aliases. */
function languageCandidates(parsed: ParsedLocale): string[] {
  const regional = regionalCode(parsed);
  return [
    ...(regional ? [regional] : []),
    parsed.language,
    ...(LANGUAGE_ALIASES[parsed.language] ?? []),
  ];
}

/** `pt` with only PT_PT available → PT_PT; ambiguous (PT_BR + PT_PT) → none. */
function uniqueRegionalMatch(
  language: string,
  available: ReadonlySet<string>,
): string | undefined {
  const matches = [...available].filter((code) =>
    code.startsWith(`${language}_`),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Maps a DatoCMS locale (`en`, `en-US`, `pt-BR`, `zh-Hant`, `nb`, …) to a
 * Shopify `LanguageCode` the store offers (`localization.availableLanguages`).
 * Region-specific locales fall back to the base language; a bare language
 * picks a regional code only when the store has exactly one. Undefined when
 * nothing fits, so the caller keeps the store's default.
 */
export function toShopifyLanguageCode(
  datoLocale: string,
  availableLanguages: string[],
): string | undefined {
  const parsed = parseLocale(datoLocale);
  if (!parsed) return undefined;
  const available = new Set(
    availableLanguages.map((code) => String(code).trim().toUpperCase()),
  );
  for (const candidate of languageCandidates(parsed)) {
    if (available.has(candidate)) return candidate;
  }
  return parsed.region || parsed.script
    ? undefined
    : uniqueRegionalMatch(parsed.language, available);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** `1 variant`, `3 variants`, `0 variants`. */
export function pluralize(
  count: number,
  singular: string,
  plural?: string,
): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * Shortens long GIDs and handles in the middle, keeping slightly more of the
 * end (where the numeric ID is): `gid://shop…/45123`. `max` counts the `…`.
 */
export function truncateMiddle(value: string, max: number): string {
  const characters = Array.from(value);
  if (!Number.isFinite(max) || characters.length <= max) return value;
  const limit = Math.floor(max);
  if (limit <= 0) return '';
  if (limit === 1) return '…';
  const kept = limit - 1;
  const tail = Math.ceil(kept / 2);
  const head = kept - tail;
  return `${characters.slice(0, head).join('')}…${characters.slice(characters.length - tail).join('')}`;
}
