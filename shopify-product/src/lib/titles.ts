/** Shopify names the only variant of a product without options "Default Title". */
export const DEFAULT_VARIANT_TITLE = 'Default Title';

/** `"Classic Tee — Black / M"`, or just the product title for a default variant. */
export function variantDisplayTitle(
  productTitle: string,
  variantTitle: string,
): string {
  const trimmed = variantTitle.trim();
  if (!trimmed || trimmed === DEFAULT_VARIANT_TITLE) return productTitle;
  return `${productTitle} — ${trimmed}`;
}
