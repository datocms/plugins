import { COLLECTION_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from '../../constants';
import {
  buildCollectionSearchQuery,
  type CollectionFilterSupport,
  enabledCollectionFilters,
} from '../../lib/queryString';
import type { ShopifyClient } from '../../lib/shopifyClient';
import type { CollectionSummary, StoreCapabilities } from '../../types';
import { type AsyncValue, useAsyncValue } from '../shared/useAsyncValue';
import useDebouncedValue from '../shared/useDebouncedValue';

export type FilterValues = { productTypes: string[]; tags: string[] };

/**
 * Product types and tags of the field's store. Tags come only with the tags
 * capability, so the list loads again once a background check grants it.
 */
export function useStoreFilterValues(
  client: ShopifyClient,
): AsyncValue<FilterValues> {
  const { tags } = client.effectiveCapabilities();
  return useAsyncValue(
    `filters|${client.shopDomain}|${tags ? 'tags' : 'no-tags'}`,
    (signal) => client.filterValues({ signal }),
    { keepPrevious: true },
  );
}

/** Collections whose title starts with the (debounced) search text. */
export function useCollectionSearch(
  client: ShopifyClient,
  search: string,
): AsyncValue<CollectionSummary[]> {
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  return useAsyncValue(
    `collections|${client.shopDomain}|${debounced}`,
    (signal) =>
      client
        .collections(
          {
            first: COLLECTION_PAGE_SIZE,
            query: buildCollectionSearchQuery(debounced),
          },
          { signal },
        )
        .then((page) => page.nodes),
    { keepPrevious: true },
  );
}

export type CollectionCheck = {
  collectionId: string;
  /** False when Shopify doesn't return the collection (deleted or unpublished). */
  found: boolean;
  /** The Search & Discovery filters the collection has enabled. */
  support: CollectionFilterSupport;
};

/**
 * Whether the limited collection still exists, and which filters Shopify
 * applies inside it: filters it hasn't enabled in Search & Discovery are
 * ignored there. One product is enough to read the collection's filters.
 */
export function useCollectionCheck(
  client: ShopifyClient,
  collectionId: string | undefined,
): AsyncValue<CollectionCheck> {
  return useAsyncValue(
    collectionId
      ? `collection-check|${client.shopDomain}|${collectionId}`
      : null,
    (signal) =>
      client
        .browseCollectionProducts(
          { collectionId: collectionId ?? '', first: 1 },
          { signal },
        )
        .then((result) => ({
          collectionId: collectionId ?? '',
          found: result.found,
          support: enabledCollectionFilters(result.filters),
        })),
  );
}

/**
 * Detects the token's optional scopes once when the store was saved without
 * them (its check failed when older settings were migrated), as the picker
 * and the field editor do. The client applies the result, so
 * `effectiveCapabilities()` reflects it on the next render. Idle when they
 * are known: saved, detected earlier in this tab, or a tokenless store.
 */
export function useCapabilityCheck(
  client: ShopifyClient,
): AsyncValue<StoreCapabilities> {
  const needsDetection = !client.hasKnownCapabilities();
  return useAsyncValue(
    needsDetection ? `capabilities|${client.shopDomain}` : null,
    (signal) => client.detectCapabilities({ signal }),
  );
}
