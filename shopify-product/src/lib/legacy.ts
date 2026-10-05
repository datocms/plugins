/**
 * The 1.x JSON value ("legacy product JSON").
 *
 * 1.x stored `JSON.stringify({ ...rawNode, imageUrl, previewImageUrl })`, where
 * `rawNode` was the product as returned by its GraphQL query. Customer
 * frontends parse that blob, so 2.0 rebuilds it key for key, in the same order,
 * from the `LegacyProduct` fragment (which aliases `url` back to `src` and
 * `previewSrc`). The golden test in `tests/lib.legacy.test.ts` compares it with
 * a value recorded from 1.x.
 */

import type { LegacyProductJson, LegacyProductNode, Money } from '../types';
import { isRecord } from './guards';

export type LegacyDriftField = 'title' | 'price' | 'image' | 'handle';

export type LegacyDrift = {
  changed: boolean;
  fields: LegacyDriftField[];
};

function copyMoney(money: Money): Money {
  return { amount: money.amount, currencyCode: money.currencyCode };
}

/**
 * Builds the 1.x JSON from a `LegacyProduct` node. Keys are written explicitly
 * (instead of spreading the node) so extra fields such as `__typename` never
 * leak in and the order always matches 1.x.
 */
export function buildLegacyProductJson(
  node: LegacyProductNode,
): LegacyProductJson {
  const edges = node.images.edges.map((edge) => ({
    node: { src: edge.node.src, previewSrc: edge.node.previewSrc },
  }));
  const first = edges[0]?.node;

  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    description: node.description,
    onlineStoreUrl: node.onlineStoreUrl,
    availableForSale: node.availableForSale,
    productType: node.productType,
    priceRange: {
      maxVariantPrice: copyMoney(node.priceRange.maxVariantPrice),
      minVariantPrice: copyMoney(node.priceRange.minVariantPrice),
    },
    images: { edges },
    // Same fallbacks as 1.x `normalizeProduct`.
    imageUrl: first?.src || '',
    previewImageUrl: first?.previewSrc || first?.src || '',
  };
}

/** Compact, exactly like 1.x `JSON.stringify(product)`. */
export function serializeLegacyProductJson(json: LegacyProductJson): string {
  return JSON.stringify(json);
}

/** Matches Shopify CDN size, crop and scale suffixes right before the extension. */
const SHOPIFY_IMAGE_SUFFIX =
  /(?:_(?:\d+x\d*|\d*x\d+))?(?:_crop_(?:center|top|bottom|left|right))?(?:@\d+x)?(?=\.[A-Za-z0-9]+$)/;

/**
 * Normalizes a Shopify image URL for comparisons: drops the query string and
 * fragment, and the `_200x200`, `_200x200_crop_center`, `_crop_center` and
 * `@2x` suffixes older plugin versions saved. Two URLs of the same source image
 * normalize to the same string.
 */
export function normalizeShopifyImageUrl(url: string): string {
  const [withoutQuery] = url.trim().split(/[?#]/);
  return (withoutQuery ?? '').replace(SHOPIFY_IMAGE_SUFFIX, '');
}

const SHOPIFY_CDN_HOST = /^https?:\/\/[^/]*\bcdn\.shopify\.com\//i;

/**
 * The full-size original behind a resized Shopify CDN image URL: drops the
 * `_400x400`-style transform suffix the Storefront API adds for
 * `url(transform:)` and keeps the query string (the `?v=` cache key). Other
 * URLs are returned unchanged.
 */
export function fullSizeShopifyImageUrl(url: string): string {
  const trimmed = url.trim();
  if (!SHOPIFY_CDN_HOST.test(trimmed)) return trimmed;
  const queryStart = trimmed.search(/[?#]/);
  const path = queryStart === -1 ? trimmed : trimmed.slice(0, queryStart);
  const rest = queryStart === -1 ? '' : trimmed.slice(queryStart);
  return `${path.replace(SHOPIFY_IMAGE_SUFFIX, '')}${rest}`;
}

/**
 * Whether two handles name the same Shopify item. The Storefront API looks
 * handles up case-insensitively and ignores trailing spaces, and Shopify only
 * ever returns lowercase handles, so a stored `The-Board ` still resolves to
 * `the-board` and isn't a change.
 */
export function sameShopifyHandle(stored: string, live: string): boolean {
  return stored.trim().toLowerCase() === live.trim().toLowerCase();
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** The image a stored value shows: `imageUrl`, else the first edge's `src`. */
function storedImageUrl(stored: Record<string, unknown>): string {
  const imageUrl = readString(stored.imageUrl);
  if (imageUrl !== null) return imageUrl;
  const images = stored.images;
  if (!isRecord(images) || !Array.isArray(images.edges)) return '';
  const firstEdge: unknown = images.edges[0];
  if (!isRecord(firstEdge) || !isRecord(firstEdge.node)) return '';
  return readString(firstEdge.node.src) ?? '';
}

function sameAmount(stored: unknown, fresh: string): boolean {
  if (typeof stored !== 'string' && typeof stored !== 'number') return false;
  const storedNumber = Number(stored);
  const freshNumber = Number(fresh);
  if (Number.isFinite(storedNumber) && Number.isFinite(freshNumber)) {
    return storedNumber === freshNumber;
  }
  return String(stored) === fresh;
}

function sameMoney(stored: unknown, fresh: Money): boolean {
  return (
    isRecord(stored) &&
    sameAmount(stored.amount, fresh.amount) &&
    stored.currencyCode === fresh.currencyCode
  );
}

function samePriceRange(stored: unknown, fresh: LegacyProductJson): boolean {
  return (
    isRecord(stored) &&
    sameMoney(stored.minVariantPrice, fresh.priceRange.minVariantPrice) &&
    sameMoney(stored.maxVariantPrice, fresh.priceRange.maxVariantPrice)
  );
}

/**
 * Compares a stored 1.x value (untrusted: it may come from any 1.x version)
 * with a fresh one. Image URLs are compared in normalized form, so values saved
 * with 200x200 or `_crop_center` thumbnails don't report drift by themselves.
 */
export function legacyJsonDrift(
  stored: Partial<LegacyProductJson>,
  fresh: LegacyProductJson,
): LegacyDrift {
  const record: Record<string, unknown> = isRecord(stored) ? stored : {};
  const fields: LegacyDriftField[] = [];

  if (record.title !== fresh.title) fields.push('title');
  if (!samePriceRange(record.priceRange, fresh)) fields.push('price');
  if (
    normalizeShopifyImageUrl(storedImageUrl(record)) !==
    normalizeShopifyImageUrl(fresh.imageUrl)
  ) {
    fields.push('image');
  }
  const storedHandle = readString(record.handle);
  if (storedHandle === null || !sameShopifyHandle(storedHandle, fresh.handle)) {
    fields.push('handle');
  }

  return { changed: fields.length > 0, fields };
}
