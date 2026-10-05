/**
 * Shared types for the Shopify plugin.
 *
 * Plugin and field parameters arrive from the SDK as untyped JSON. The
 * normalizers in `lib/parameters.ts` turn any historical shape into the
 * current types below, and `lib/references.ts` does the same for stored field
 * values.
 */

// ---------------------------------------------------------------------------
// Demo store
// ---------------------------------------------------------------------------

/**
 * Public demo credentials for a dedicated Shopify Headless storefront.
 *
 * This is intentionally a public Storefront API access token, not a private
 * token or an Admin API token. Shopify public Storefront tokens are designed
 * for browser and mobile contexts, and are sent with the
 * `X-Shopify-Storefront-Access-Token` header by client-side code.
 *
 * The token belongs to a DatoCMS demo store that contains mock data only.
 * Shopify shares Headless Storefront API permissions across storefront tokens
 * for the same store, so this token can inherit read scopes beyond product
 * listings. That is acceptable only because the store is a disposable demo
 * store and must not contain real customer, checkout, or catalog data.
 *
 * All unauthenticated write operations are disabled for this demo token, so
 * visitors can browse demo products without modifying customer, checkout, or
 * other store data.
 *
 * If the demo store ever receives non-demo data, or if write scopes are enabled
 * again, rotate or remove this token before publishing another release.
 */
export const DEMO_STORE: StoreConnection = {
  shopDomain: 'datocms-demo.myshopify.com',
  storefrontAccessToken: '6f39fb123179b7d636d84d833d3d3adf',
  tokenless: false,
  label: 'DatoCMS demo store',
  /**
   * What `detectCapabilities()` reports for this token (verified live on API
   * 2026-10). Demo mode has no saved store to run detection for, so without
   * these the field settings would ask for a scope the token already has,
   * and every picker would probe again. Update them if the token's scopes
   * change.
   */
  capabilities: {
    tags: true,
    inventory: false,
    metafields: false,
    checkedAt: '2026-10-04T00:00:00.000Z',
  },
};

// ---------------------------------------------------------------------------
// Plugin parameters (v3)
// ---------------------------------------------------------------------------

export type StoreCapabilities = {
  /** `unauthenticated_read_product_tags`: tags, productTags, tag filter. */
  tags: boolean;
  /** `unauthenticated_read_product_inventory`: quantityAvailable, totalInventory. */
  inventory: boolean;
  /**
   * Always false since 2.0: the Storefront API has no metafields scope to
   * detect. Kept so saved parameters stay valid.
   */
  metafields: boolean;
  /** ISO timestamp of the detection run. */
  checkedAt: string;
};

export type StoreConnection = {
  /** Normalized `acme.myshopify.com`. Also the store's identity. */
  shopDomain: string;
  /** Public Storefront token; `''` when tokenless. */
  storefrontAccessToken: string;
  tokenless: boolean;
  /** Shown when there are several stores. */
  label?: string;
  /** Shopify `CountryCode`, e.g. `'US'`. */
  defaultCountry?: string;
  /** Shopify `LanguageCode`, e.g. `'EN'`. */
  defaultLanguage?: string;
  capabilities?: StoreCapabilities;
};

export type PluginParametersV3 = {
  paramsVersion: '3';
  /** Index 0 is the default store. */
  stores: StoreConnection[];
  useDemoStore: boolean;
  autoApplyToFieldsWithApiKey: string;
};

// ---------------------------------------------------------------------------
// Field parameters (v1)
// ---------------------------------------------------------------------------

export type FieldType = 'string' | 'json';

export type ShopifyKind = 'product' | 'variant' | 'collection';

export type Cardinality = 'single' | 'multiple';

/**
 * - `handle`: string field, product or collection handle (1.x string default).
 * - `gid`: string field, `gid://shopify/…` of any kind.
 * - `reference`: JSON field, versioned reference document (2.0 default).
 * - `legacyProductJson`: JSON field, the 1.x product snapshot.
 */
export type StorageFormat =
  | 'handle'
  | 'gid'
  | 'reference'
  | 'legacyProductJson';

export type FieldScope = {
  /** `gid://shopify/Collection/…` */
  collectionId?: string;
  /** Display title of the scoped collection, for chips. */
  collectionTitle?: string;
  productType?: string;
  vendor?: string;
  tags?: string[];
  availableOnly?: boolean;
};

export type FieldParametersV1 = {
  paramsVersion: '1';
  kind: ShopifyKind;
  cardinality: Cardinality;
  format: StorageFormat;
  /** Reference format only. */
  snapshot: boolean;
  /** Omitted = default store (index 0). */
  shopDomain?: string;
  scope?: FieldScope;
  /** Multiple cardinality only. */
  min?: number;
  /** Multiple cardinality only. */
  max?: number;
};

// ---------------------------------------------------------------------------
// Shopify data (Storefront API 2026-10), as returned by lib/queries.ts
// ---------------------------------------------------------------------------

/** Amounts are decimal strings, exactly as Shopify returns them. */
export type Money = {
  amount: string;
  currencyCode: string;
};

export type ShopifyImage = {
  url: string;
  altText: string | null;
};

export type ProductSummary = {
  __typename: 'Product';
  id: string;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  availableForSale: boolean;
  onlineStoreUrl: string | null;
  updatedAt: string;
  featuredImage: ShopifyImage | null;
  priceRange: { minVariantPrice: Money; maxVariantPrice: Money };
  compareAtPriceRange: { maxVariantPrice: Money };
  variantsCount: { count: number } | null;
  /** The SKU of the product's only variant; null when it has several, or none. */
  sku: string | null;
  /** Only requested with the inventory capability. */
  totalInventory?: number | null;
};

export type VariantSummary = {
  __typename: 'ProductVariant';
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  availableForSale: boolean;
  currentlyNotInStock: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
  price: Money;
  compareAtPrice: Money | null;
  image: ShopifyImage | null;
  product: {
    id: string;
    handle: string;
    title: string;
    vendor: string;
    onlineStoreUrl: string | null;
    featuredImage: ShopifyImage | null;
  };
  /** Only requested with the inventory capability. */
  quantityAvailable?: number | null;
};

export type CollectionSummary = {
  __typename: 'Collection';
  id: string;
  handle: string;
  title: string;
  updatedAt: string;
  onlineStoreUrl: string | null;
  image: ShopifyImage | null;
};

export type ShopifyNode = ProductSummary | VariantSummary | CollectionSummary;

/** The `LegacyProduct` fragment: the raw shape the 1.x JSON is built from. */
export type LegacyProductNode = {
  id: string;
  title: string;
  handle: string;
  description: string;
  onlineStoreUrl: string | null;
  availableForSale: boolean;
  productType: string;
  priceRange: { maxVariantPrice: Money; minVariantPrice: Money };
  images: { edges: Array<{ node: { src: string; previewSrc: string } }> };
};

/** The 1.x JSON value, key for key. */
export type LegacyProductJson = LegacyProductNode & {
  imageUrl: string;
  previewImageUrl: string;
};

export type PageInfo = { hasNextPage: boolean; endCursor: string | null };

export type Page<T> = { nodes: T[]; pageInfo: PageInfo };

export type ProductOption = {
  name: string;
  optionValues: Array<{ name: string }>;
};

/** A `collection.products.filters` entry (Search & Discovery). */
export type ShopifyFilter = {
  id: string;
  label: string;
  type: string;
  values: Array<{ id: string; label: string; count: number; input: string }>;
};

/** `ProductSortKeys` (RELEVANCE only with a text query). */
export type ProductSortKey =
  | 'TITLE'
  | 'PRODUCT_TYPE'
  | 'VENDOR'
  | 'UPDATED_AT'
  | 'CREATED_AT'
  | 'BEST_SELLING'
  | 'PRICE'
  | 'ID'
  | 'RELEVANCE';

/** `ProductCollectionSortKeys`. */
export type CollectionSortKey =
  | 'COLLECTION_DEFAULT'
  | 'MANUAL'
  | 'BEST_SELLING'
  | 'CREATED'
  | 'PRICE'
  | 'TITLE'
  | 'ID'
  | 'RELEVANCE';

/** `ProductFilter` input for `collection.products(filters:)`. */
export type ProductFilterInput = {
  available?: boolean;
  productType?: string;
  productVendor?: string;
  tag?: string;
  price?: { min?: number; max?: number };
  variantOption?: { name: string; value: string };
};

/** `@inContext` arguments. */
export type ShopifyContext = {
  country?: string;
  language?: string;
};

export type LocalizationInfo = {
  country: { isoCode: string };
  language: { isoCode: string };
  availableCountries: Array<{
    isoCode: string;
    name: string;
    currency: { isoCode: string };
  }>;
  availableLanguages: Array<{ isoCode: string; endonymName: string }>;
};

export type ConnectionTestResult = {
  shopName: string;
  primaryDomainUrl: string;
  localization: LocalizationInfo;
  publicApiVersions: Array<{ handle: string; supported: boolean }>;
  /** `X-Shopify-API-Version` of the response, when readable. */
  respondedApiVersion: string | null;
  /** True when the pinned version is missing, unsupported, or not the one that answered. */
  apiVersionOutdated: boolean;
};

// ---------------------------------------------------------------------------
// Stored values
// ---------------------------------------------------------------------------

/** Display hints captured at selection time. Shopify stays the source of truth. */
export type ReferenceSnapshot = {
  /** Variants: `"Classic Tee — Black / M"`. */
  title: string;
  imageUrl?: string;
  /** Omitted for collections. */
  price?: Money;
  /** Variants only, when the variant has a SKU. */
  sku?: string;
  capturedAt: string;
};

export type ProductReference = {
  id: string;
  handle: string;
  snapshot?: ReferenceSnapshot;
};

export type VariantReference = {
  id: string;
  productId: string;
  productHandle: string;
  snapshot?: ReferenceSnapshot;
};

export type CollectionReference = {
  id: string;
  handle: string;
  snapshot?: ReferenceSnapshot;
};

/** The 2.0 JSON value. `null` is the only empty value. */
export type ReferenceDocumentV1 =
  | {
      version: 1;
      shop: string;
      kind: 'product';
      references: ProductReference[];
    }
  | {
      version: 1;
      shop: string;
      kind: 'variant';
      references: VariantReference[];
    }
  | {
      version: 1;
      shop: string;
      kind: 'collection';
      references: CollectionReference[];
    };

/**
 * One stored item, normalized from any of the four formats. This is what the
 * field editor renders and hydrates.
 */
export type StoredEntry = {
  /** Stable key for React and drag-and-drop: the GID when known, else `handle:{handle}`. */
  key: string;
  kind: ShopifyKind;
  /** GID (decoded from base64 when needed), or null for a handle-only value. */
  id: string | null;
  /** Product or collection handle; for variants, the product handle. */
  handle: string | null;
  /** Variants only. */
  productId?: string | null;
  snapshot?: ReferenceSnapshot;
};

export type StoredValueErrorCode =
  | 'invalid-json'
  | 'invalid-shape'
  | 'unsupported-version'
  | 'kind-mismatch'
  | 'cardinality-mismatch'
  | 'shop-mismatch'
  | 'duplicate-reference';

export type ParsedStoredValue =
  | {
      ok: true;
      /** null when the field is empty. */
      format: StorageFormat | null;
      kind: ShopifyKind;
      /** The document's shop for reference documents; null otherwise. */
      shop: string | null;
      entries: StoredEntry[];
      /** The original 1.x JSON object when `format === 'legacyProductJson'`. */
      legacyProduct: Partial<LegacyProductJson> | null;
    }
  | {
      ok: false;
      code: StoredValueErrorCode;
      message: string;
      rawValue: unknown;
    };

// ---------------------------------------------------------------------------
// Picker modal contract
// ---------------------------------------------------------------------------

/** One item in the picker's current selection. */
export type PickerSelectedEntry = {
  /** Stable key (see StoredEntry.key). */
  key: string;
  /** GID when known. */
  id: string | null;
  /** Hydrated node, or null when the storefront can't see it. */
  node: ShopifyNode | null;
  /** Label for unresolved entries: snapshot title, handle or GID. */
  fallbackLabel: string;
};

/** An item that is already in the field, so the picker can't add it again. */
export type PickerUnavailableEntry = {
  /** The field's entry key. */
  key: string;
  /** Canonical GID, or null for entries saved only as a handle. */
  id: string | null;
};

export type PickerModalParameters = {
  fieldParameters: FieldParametersV1;
  fieldType: FieldType;
  /** Normalized shop domain of the store to browse. */
  shopDomain: string;
  /** Current selection, in order. Single fields pass at most one. */
  selected: PickerSelectedEntry[];
  /** Initial market context. */
  context?: ShopifyContext;
  /**
   * Replace: the field's other items. They show as already selected and
   * can't be picked ("Already in this field").
   */
  unavailable?: PickerUnavailableEntry[];
};

/**
 * What the picker resolves with. `null` (or undefined, from ✕/Esc) means
 * cancel. For multiple fields this is the complete new ordered selection,
 * including unresolved entries the editor didn't remove.
 */
export type PickerModalResult = {
  selected: PickerSelectedEntry[];
  context?: ShopifyContext;
};
