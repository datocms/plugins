import type { CentraDisplayItem, CentraItem } from '../lib/centraClient';
import type { CentraReferenceKind } from '../types';

// The texts that the field editor and the picker derive from Centra's catalog
// data: titles with their fallbacks, details, images, availability, the SKU
// ranking and the counts.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compact(parts: ReadonlyArray<string | null | undefined>): string[] {
  return parts.filter((part): part is string => Boolean(part));
}

/** The product's name, else its variant's name, else its identity */
export function productTitle(displayItem: CentraDisplayItem): string {
  return (
    displayItem.name?.trim() ||
    displayItem.productVariant?.name?.trim() ||
    productIdentity(displayItem)
  );
}

/** "Product <number>", or "Product ID <id>" without a product number */
function productIdentity(displayItem: CentraDisplayItem): string {
  return displayItem.productNumber
    ? `Product ${displayItem.productNumber}`
    : `Product ID ${displayItem.id}`;
}

/** The picker's variant line: "name · number", or undefined when both lack */
export function productDetail(
  displayItem: CentraDisplayItem,
): string | undefined {
  const parts = compact([
    displayItem.productVariant?.name?.trim(),
    displayItem.productVariant?.number?.trim(),
  ]);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** The field's details of a product or variant: variant name, number, price */
export function displayItemDetail(displayItem: CentraDisplayItem): string[] {
  return Array.from(
    new Set(
      compact([
        displayItem.productVariant?.name?.trim(),
        displayItem.productVariant?.number?.trim(),
        displayItem.price?.formattedValue,
      ]),
    ),
  );
}

/**
 * The field's details of a SKU: the size label (left out when it is the SKU
 * itself), the variant name, "SKU <sku>" and the price
 */
export function itemDetail(
  displayItem: CentraDisplayItem,
  item: CentraItem,
): string[] {
  const label = itemTitle(item);
  return Array.from(
    new Set(
      compact([
        label === item.sku?.trim() ? null : label,
        displayItem.productVariant?.name?.trim(),
        item.sku ? `SKU ${item.sku}` : null,
        displayItem.price?.formattedValue,
      ]),
    ),
  );
}

/**
 * The first media whose source type is an image, else the first media. Null
 * without a display item or without media.
 */
export function imageUrl(
  displayItem: CentraDisplayItem | undefined,
): string | null {
  const media = displayItem?.media;
  if (!media || media.length === 0) return null;
  const image = media.find((medium) =>
    medium.source.type?.toLocaleLowerCase().includes('image'),
  );
  return image?.source.url ?? media[0]?.source.url ?? null;
}

/** The SKU's name, else "Size <id>", else the SKU, else "Item <id>" */
export function itemTitle(item: CentraItem): string {
  return (
    item.name?.trim() ||
    (item.productSizeId !== undefined
      ? `Size ${String(item.productSizeId)}`
      : undefined) ||
    item.sku?.trim() ||
    `Item ${item.id}`
  );
}

export type AvailabilityLabel = 'Available' | 'Out of stock' | 'Unavailable';

/**
 * The availability of a picker card: Unavailable, else Out of stock, else
 * Available only when both flags are true, else nothing
 */
export function availabilityLabel(
  available: boolean | null | undefined,
  hasStock: boolean | null | undefined,
): AvailabilityLabel | null {
  if (available === false) return 'Unavailable';
  if (hasStock === false) return 'Out of stock';
  if (available === true && hasStock === true) return 'Available';
  return null;
}

/**
 * The status of a saved reference in the field: Unavailable when the display
 * item is, else Out of stock from the SKU's stock (for a SKU) or from the
 * display item's hasStock, else nothing
 */
export function referenceStatus(
  displayItem: CentraDisplayItem | undefined,
  item: CentraItem | undefined,
): 'Unavailable' | 'Out of stock' | null {
  if (displayItem?.available === false) return 'Unavailable';
  if (item) {
    return item.stock?.available === false ? 'Out of stock' : null;
  }
  return displayItem?.hasStock === false ? 'Out of stock' : null;
}

/** A SKU row's stock in the picker, or null when Centra gives no stock */
export function itemStockLabel(
  item: CentraItem,
): 'Available' | 'Unavailable' | null {
  if (!item.stock) return null;
  return item.stock.available ? 'Available' : 'Unavailable';
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function isExactItemMatch(item: CentraItem, normalizedQuery: string): boolean {
  return (
    normalizedQuery.length > 0 &&
    (item.sku?.toLocaleLowerCase() === normalizedQuery ||
      item.GTIN?.toLocaleLowerCase() === normalizedQuery)
  );
}

/** Whether a SKU or GTIN of the product equals the query (case-insensitive) */
export function hasExactItemMatch(
  displayItem: CentraDisplayItem,
  query: string,
): boolean {
  const normalizedQuery = normalizeQuery(query);
  return displayItem.items.some((item) =>
    isExactItemMatch(item, normalizedQuery),
  );
}

/** The product's SKUs, exact SKU/GTIN matches first, else in Centra's order */
export function rankItems(
  displayItem: CentraDisplayItem,
  query: string,
): CentraItem[] {
  const normalizedQuery = normalizeQuery(query);
  return displayItem.items
    .map((item, index) => ({
      item,
      index,
      exact: isExactItemMatch(item, normalizedQuery),
    }))
    .sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) || left.index - right.index,
    )
    .map(({ item }) => item);
}

export type CountNouns = { one: string; other: string };

/** What each kind of field picks, singular and plural */
export const KIND_NOUNS: Record<CentraReferenceKind, CountNouns> = {
  primaryProduct: { one: 'product', other: 'products' },
  variant: { one: 'product variant', other: 'product variants' },
  item: { one: 'SKU', other: 'SKUs' },
};

function numberFormat(locale: string | undefined): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale || 'en');
  } catch {
    return new Intl.NumberFormat('en');
  }
}

/**
 * A count that names the thing counted: "1 product", "2,048 products". The
 * number follows the locale (English when it is missing or invalid); the
 * nouns are English, like the rest of the texts.
 */
export function countLabel(
  count: number,
  nouns: CountNouns,
  locale?: string,
): string {
  const noun = count === 1 ? nouns.one : nouns.other;
  return `${numberFormat(locale).format(count)} ${noun}`;
}
