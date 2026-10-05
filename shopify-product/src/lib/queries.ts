/**
 * Storefront API (2026-10) GraphQL documents.
 *
 * Every document is built from the fragment strings below, so each query
 * carries exactly the fragments it spreads. Fields that need optional token
 * scopes are behind capability flags: inventory fields (`totalInventory`,
 * `quantityAvailable`) are only requested with the inventory capability, and
 * `productTags` only with the tags capability. Shopify answers a denied field
 * with `ACCESS_DENIED`, so never request one the store hasn't granted.
 *
 * Every query that returns prices or translatable text takes `$country` and
 * `$language` and applies them through `@inContext`. Passing `null` for both is
 * valid and means "the shop's defaults" (verified live).
 *
 * No deprecated fields: `product(handle:)` instead of `productByHandle`, and
 * `Image.url` instead of `src` / `transformedSrc`. The `LegacyProduct`
 * fragment aliases `url` back to the 1.x key names.
 */

/** Query variants that depend on the store's detected scopes. */
export type QueryFeatures = {
  /** `unauthenticated_read_product_inventory`. */
  inventory: boolean;
  /** `unauthenticated_read_product_tags`. */
  tags: boolean;
};

export const BASE_FEATURES: QueryFeatures = { inventory: false, tags: false };

const CONTEXT_VARIABLES = '$country: CountryCode, $language: LanguageCode';
const IN_CONTEXT = '@inContext(country: $country, language: $language)';

const MONEY = 'amount currencyCode';
const CARD_IMAGE = `url(transform: { maxWidth: 400, maxHeight: 400 }) altText`;
const THUMB_IMAGE = `url(transform: { maxWidth: 200, maxHeight: 200 }) altText`;

function optionalField(enabled: boolean, field: string): string {
  return enabled ? `\n    ${field}` : '';
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

export function productCardFragment({
  inventory,
}: Pick<QueryFeatures, 'inventory'>): string {
  return `
fragment ProductCard on Product {
    __typename
    id
    handle
    title
    vendor
    productType
    availableForSale
    onlineStoreUrl
    updatedAt
    featuredImage { ${CARD_IMAGE} }
    priceRange {
      minVariantPrice { ${MONEY} }
      maxVariantPrice { ${MONEY} }
    }
    compareAtPriceRange { maxVariantPrice { ${MONEY} } }
    variantsCount { count }
    firstVariant: variants(first: 1) { nodes { sku } }${optionalField(inventory, 'totalInventory')}
}`;
}

export function variantRowFragment({
  inventory,
}: Pick<QueryFeatures, 'inventory'>): string {
  return `
fragment VariantRow on ProductVariant {
    __typename
    id
    title
    sku
    barcode
    availableForSale
    currentlyNotInStock
    selectedOptions { name value }
    price { ${MONEY} }
    compareAtPrice { ${MONEY} }
    image { ${THUMB_IMAGE} }
    product {
      id
      handle
      title
      vendor
      onlineStoreUrl
      featuredImage { ${THUMB_IMAGE} }
    }${optionalField(inventory, 'quantityAvailable')}
}`;
}

export const COLLECTION_CARD_FRAGMENT = `
fragment CollectionCard on Collection {
    __typename
    id
    handle
    title
    updatedAt
    onlineStoreUrl
    image { ${CARD_IMAGE} }
}`;

/** The 1.x product snapshot. The aliases keep the old key names exactly. */
export const LEGACY_PRODUCT_FRAGMENT = `
fragment LegacyProduct on Product {
    id
    title
    handle
    description
    onlineStoreUrl
    availableForSale
    productType
    priceRange {
      maxVariantPrice { ${MONEY} }
      minVariantPrice { ${MONEY} }
    }
    images(first: 1) {
      edges {
        node {
          src: url
          previewSrc: url(transform: { maxWidth: 200, maxHeight: 200 })
        }
      }
    }
}`;

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

// ---------------------------------------------------------------------------
// Hydration and lookups
// ---------------------------------------------------------------------------

/** `nodes(ids:)`: at most 250 IDs; unknown or unpublished IDs come back `null`. */
export function hydrateQuery(features: QueryFeatures): string {
  return `query Hydrate($ids: [ID!]!, ${CONTEXT_VARIABLES}) ${IN_CONTEXT} {
  nodes(ids: $ids) {
    __typename
    ...ProductCard
    ...VariantRow
    ...CollectionCard
  }
}
${productCardFragment(features)}
${variantRowFragment(features)}
${COLLECTION_CARD_FRAGMENT}`;
}

export function productByHandleQuery(features: QueryFeatures): string {
  return `query ProductByHandle($handle: String!, ${CONTEXT_VARIABLES}) ${IN_CONTEXT} {
  product(handle: $handle) { ...ProductCard }
}
${productCardFragment(features)}`;
}

export const COLLECTION_BY_HANDLE_QUERY = `query CollectionByHandle($handle: String!, ${CONTEXT_VARIABLES}) ${IN_CONTEXT} {
  collection(handle: $handle) { ...CollectionCard }
}
${COLLECTION_CARD_FRAGMENT}`;

export const LEGACY_PRODUCT_BY_ID_QUERY = `query LegacyProductById($ids: [ID!]!, ${CONTEXT_VARIABLES}) ${IN_CONTEXT} {
  nodes(ids: $ids) {
    __typename
    ... on Product { ...LegacyProduct }
  }
}
${LEGACY_PRODUCT_FRAGMENT}`;

export const LEGACY_PRODUCT_BY_HANDLE_QUERY = `query LegacyProductByHandle($handle: String!, ${CONTEXT_VARIABLES}) ${IN_CONTEXT} {
  product(handle: $handle) { ...LegacyProduct }
}
${LEGACY_PRODUCT_FRAGMENT}`;

// ---------------------------------------------------------------------------
// Browsing
// ---------------------------------------------------------------------------

export function browseProductsQuery(features: QueryFeatures): string {
  return `query BrowseProducts($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean, ${CONTEXT_VARIABLES}) ${IN_CONTEXT} {
  products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
    ${PAGE_INFO}
    nodes { ...ProductCard }
  }
}
${productCardFragment(features)}`;
}

export function browseCollectionProductsQuery(features: QueryFeatures): string {
  return `query BrowseCollectionProducts($id: ID!, $first: Int!, $after: String, $filters: [ProductFilter!], $sortKey: ProductCollectionSortKeys, $reverse: Boolean, ${CONTEXT_VARIABLES}) ${IN_CONTEXT} {
  collection(id: $id) {
    id
    products(first: $first, after: $after, filters: $filters, sortKey: $sortKey, reverse: $reverse) {
      ${PAGE_INFO}
      filters { id label type values { id label count input } }
      nodes { ...ProductCard }
    }
  }
}
${productCardFragment(features)}`;
}

export function productVariantsQuery(features: QueryFeatures): string {
  return `query ProductVariants($id: ID!, $first: Int!, $after: String, ${CONTEXT_VARIABLES}) ${IN_CONTEXT} {
  product(id: $id) {
    id
    variantsCount { count }
    options { name optionValues { name } }
    variants(first: $first, after: $after) {
      ${PAGE_INFO}
      nodes { ...VariantRow }
    }
  }
}
${variantRowFragment(features)}`;
}

/** Distinct values for the filter dropdowns. `productTags` needs the tags scope. */
export function filterValuesQuery({
  tags,
}: Pick<QueryFeatures, 'tags'>): string {
  const tagsSelection = tags ? '\n  productTags(first: 250) { nodes }' : '';
  return `query FilterValues {
  productTypes(first: 250) { nodes }${tagsSelection}
}`;
}

export const COLLECTIONS_QUERY = `query Collections($first: Int!, $after: String, $query: String, ${CONTEXT_VARIABLES}) ${IN_CONTEXT} {
  collections(first: $first, after: $after, query: $query, sortKey: TITLE) {
    ${PAGE_INFO}
    nodes { ...CollectionCard }
  }
}
${COLLECTION_CARD_FRAGMENT}`;

/**
 * Type-ahead lookup by variant SKU or barcode, which `products(query:)` can't
 * do. It returns products, so the client narrows them to matching variants.
 */
export function skuMatchesQuery(features: QueryFeatures): string {
  return `query SkuMatches($q: String!, ${CONTEXT_VARIABLES}) ${IN_CONTEXT} {
  predictiveSearch(query: $q, limit: 10, types: [PRODUCT], searchableFields: [VARIANTS_SKU, VARIANTS_BARCODE]) {
    products {
      ...ProductCard
      variants(first: 250) { nodes { ...VariantRow } }
    }
  }
}
${productCardFragment(features)}
${variantRowFragment(features)}`;
}

// ---------------------------------------------------------------------------
// Settings: connection test, markets, capability probes
// ---------------------------------------------------------------------------

const LOCALIZATION_SELECTION = `localization {
    country { isoCode }
    language { isoCode }
    availableCountries { isoCode name currency { isoCode } }
    availableLanguages { isoCode endonymName }
  }`;

/** Runs without `@inContext`, so it reports the shop's own defaults. */
export const CONNECTION_TEST_QUERY = `query ConnectionTest {
  shop { name primaryDomain { url } }
  ${LOCALIZATION_SELECTION}
  publicApiVersions { handle supported }
}`;

/** With a context, `country` and `language` report what Shopify applied. */
export const LOCALIZATION_QUERY = `query Localization(${CONTEXT_VARIABLES}) ${IN_CONTEXT} {
  ${LOCALIZATION_SELECTION}
}`;

/** Tags: ACCESS_DENIED without the scope; an empty list means nothing to filter by. */
export const PROBE_TAGS_QUERY = `query ProbeTags {
  productTags(first: 1) { nodes }
}`;

/** Inventory: ACCESS_DENIED without `unauthenticated_read_product_inventory`. */
export const PROBE_INVENTORY_QUERY = `query ProbeInventory {
  products(first: 1) { nodes { id totalInventory } }
}`;

/*
 * There is no metafields probe. Storefront tokens have no metafields scope
 * (Shopify's unauthenticated scope list has none): a metafield resolves only
 * when its definition grants storefront PUBLIC_READ access, and any other key
 * reads `null` without an error, so no request can tell what is readable.
 */
