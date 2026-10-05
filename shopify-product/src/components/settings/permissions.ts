/**
 * The Storefront API permissions the plugin uses, by the names Shopify shows
 * next to each checkbox (Headless → Storefront API permissions) and their API
 * scope codes. The setup guide and the capability hints both use them, so the
 * screen names each permission one way.
 */
export const PERMISSIONS = {
  products: {
    label: 'Read products, variants, and collections',
    scope: 'unauthenticated_read_product_listings',
  },
  tags: {
    label: 'Read product tags',
    scope: 'unauthenticated_read_product_tags',
  },
  inventory: {
    label: 'Read product inventory',
    scope: 'unauthenticated_read_product_inventory',
  },
} as const;
