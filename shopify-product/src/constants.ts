/** Every existing field references this ID; never change it. */
export const FIELD_EXTENSION_ID = 'shopifyProduct';
export const PICKER_MODAL_ID = 'shopifyPicker';

/** The one place the Storefront API version lives. */
export const SHOPIFY_STOREFRONT_API_VERSION = '2026-10';

/** Storefront API hard limit for `first` and `nodes(ids:)`. */
export const SHOPIFY_MAX_PAGE_SIZE = 250;
export const PICKER_PAGE_SIZE = 24;
export const VARIANT_PAGE_SIZE = 250;
export const COLLECTION_PAGE_SIZE = 50;
export const SEARCH_DEBOUNCE_MS = 300;
/** Inputs at least this long, without spaces, also run the SKU/barcode lookup. */
export const SKU_SEARCH_MIN_LENGTH = 3;

export const PICKER_MODAL_HEIGHT = 760;
export const FIELD_EXTENSION_INITIAL_HEIGHT = 120;

/** The 1.x plugin persisted its cache here; 2.0 deletes it on boot. */
export const LEGACY_LOCAL_STORAGE_KEY = 'datocms-plugin-shopify-product';
/** Per-user picker view preference (grid or list). */
export const PICKER_VIEW_STORAGE_KEY =
  'datocms-plugin-shopify-product:picker-view';

export const NODE_CACHE_TTL_MS = 5 * 60 * 1000;
export const SEARCH_CACHE_TTL_MS = 60 * 1000;
export const CACHE_MAX_ENTRIES = 500;

export const ADMIN_TOKEN_PREFIXES = ['shpat_', 'shpca_', 'shppa_'] as const;

/** The README's setup steps: the config screen links here instead of repeating them. */
export const SETUP_DOCS_URL =
  'https://github.com/datocms/plugins/tree/master/shopify-product#connect-your-shopify-store';
