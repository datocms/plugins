import type { ShopifyKind } from '../types';

const GID_PREFIX = 'gid://shopify/';

const KIND_BY_TYPE: Record<string, ShopifyKind> = {
  Product: 'product',
  ProductVariant: 'variant',
  Collection: 'collection',
};

export type ParsedGid = {
  /** `Product`, `ProductVariant`, `Collection`, … */
  type: string;
  /** The numeric part, as a string (it can exceed Number.MAX_SAFE_INTEGER). */
  numericId: string;
};

/** Parses `gid://shopify/Product/123` (query strings like `?variant=` are ignored). */
export function parseGid(value: string): ParsedGid | null {
  if (!value.startsWith(GID_PREFIX)) return null;
  const [path] = value.slice(GID_PREFIX.length).split('?');
  const [type, numericId, ...rest] = path.split('/');
  if (!type || !numericId || rest.length > 0) return null;
  if (!/^[A-Za-z]+$/.test(type) || !/^\d+$/.test(numericId)) return null;
  return { type, numericId };
}

export function kindOfGid(value: string): ShopifyKind | null {
  const parsed = parseGid(value);
  return parsed ? (KIND_BY_TYPE[parsed.type] ?? null) : null;
}

export function numericIdFromGid(value: string): string | null {
  return parseGid(value)?.numericId ?? null;
}

function decodeBase64(value: string): string | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return atob(normalized);
  } catch {
    return null;
  }
}

/**
 * Returns the GID for a stored ID. Accepts plain GIDs and the base64-encoded
 * GIDs Shopify returned before Storefront API 2022-04
 * (`Z2lkOi8vc2hvcGlmeS9Qcm9kdWN0LzE=` → `gid://shopify/Product/1`).
 * Returns null for anything else.
 */
export function decodeShopifyId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (parseGid(trimmed)) return trimmed;
  const decoded = decodeBase64(trimmed);
  return decoded && parseGid(decoded) ? decoded : null;
}
