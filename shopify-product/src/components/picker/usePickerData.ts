import { useCallback, useMemo, useState } from 'react';
import {
  COLLECTION_PAGE_SIZE,
  PICKER_PAGE_SIZE,
  SHOPIFY_MAX_PAGE_SIZE,
} from '../../constants';
import { UNRESOLVED_COLLECTION_MESSAGE } from '../../lib/fieldValue';
import {
  type ClientCheck,
  collectionClientCheck,
  type EffectiveSearch,
  hasClientCheck,
  matchesClientCheck,
} from '../../lib/pickerSearch';
import {
  buildCollectionProductFilters,
  buildCollectionSearchQuery,
  buildProductSearchQuery,
  type CollectionFilterSupport,
  enabledCollectionFilters,
  type PickerSort,
  toCollectionSort,
  toProductSort,
} from '../../lib/queryString';
import type { ShopifyClient } from '../../lib/shopifyClient';
import type {
  CollectionSummary,
  FieldScope,
  LocalizationInfo,
  ProductSummary,
  ShopifyKind,
} from '../../types';
import { type AsyncValue, useAsyncValue } from '../shared/useAsyncValue';
import { type PagedQuery, usePagedQuery } from './usePagedQuery';

/** Thrown when a collection the picker browses isn't visible to the storefront. */
export class CollectionNotVisibleError extends Error {
  constructor() {
    super(UNRESOLVED_COLLECTION_MESSAGE);
    this.name = 'CollectionNotVisibleError';
  }
}

// ---------------------------------------------------------------------------
// Lookups for the header and filter bar
// ---------------------------------------------------------------------------

export function useLocalization(
  client: ShopifyClient,
  contextKey: string,
): AsyncValue<LocalizationInfo> {
  return useAsyncValue(
    `localization:${contextKey}`,
    (signal) => client.localization({ signal }),
    { keepPrevious: true },
  );
}

/**
 * Product types and tags for the filter menus. Keyed by the tags
 * capability: the request includes tags only when the store allows them.
 */
export function useFilterValues(
  client: ShopifyClient,
  enabled: boolean,
  tagsCapability: boolean,
): AsyncValue<{ productTypes: string[]; tags: string[] }> {
  return useAsyncValue(
    enabled ? `filter-values:${tagsCapability}` : null,
    (signal) => client.filterValues({ signal }),
  );
}

export function useCollectionOptions(
  client: ShopifyClient,
  contextKey: string,
  enabled: boolean,
): PagedQuery<CollectionSummary, never> {
  return usePagedQuery<CollectionSummary>(
    enabled ? `collection-options:${contextKey}` : null,
    (after, signal) =>
      client
        .collections({ first: COLLECTION_PAGE_SIZE, after }, { signal })
        .then((page) => ({ page })),
  );
}

/** The title of a locked collection whose field settings didn't keep one. */
export function useLockedCollectionTitle(
  client: ShopifyClient,
  scope: FieldScope | undefined,
): string | null {
  const id = scope?.collectionId ?? null;
  const known = scope?.collectionTitle ?? null;
  const lookup = useAsyncValue(
    id && !known ? `collection-title:${id}` : null,
    (signal) => client.loadNode(id ?? '', { signal }),
  );
  if (known) return known;
  const node = lookup.value;
  return node?.__typename === 'Collection' ? node.title : null;
}

// ---------------------------------------------------------------------------
// SKU and barcode matches
// ---------------------------------------------------------------------------

export function useSkuMatches(
  client: ShopifyClient,
  contextKey: string,
  text: string,
  enabled: boolean,
) {
  return useAsyncValue(enabled ? `sku:${contextKey}:${text}` : null, (signal) =>
    client.skuMatches(text, { signal }),
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type ResultsInput = {
  client: ShopifyClient;
  contextKey: string;
  kind: ShopifyKind;
  /** Debounced and trimmed. */
  text: string;
  scope: FieldScope | undefined;
  search: EffectiveSearch;
  sort: PickerSort;
  support: CollectionFilterSupport | null;
  onSupport: (collectionId: string, support: CollectionFilterSupport) => void;
};

export type ResultItem = ProductSummary | CollectionSummary;

export type Results = {
  query: PagedQuery<ResultItem, never>;
  /** The loaded items that pass the client-side checks. */
  items: ResultItem[];
  /** True when some results are filtered in the browser. */
  filteredLocally: boolean;
};

type QueryPlan = {
  key: string;
  check: ClientCheck | null;
  fetch: (
    after: string | null,
    signal: AbortSignal,
  ) => Promise<{
    page: { nodes: ResultItem[]; pageInfo: ResultPageInfo };
  }>;
};

type ResultPageInfo = { hasNextPage: boolean; endCursor: string | null };

function collectionsPlan(input: ResultsInput): QueryPlan {
  const { client, contextKey, text } = input;
  return {
    key: JSON.stringify(['collections', contextKey, text]),
    check: null,
    fetch: (after, signal) =>
      client
        .collections(
          {
            first: PICKER_PAGE_SIZE,
            after,
            query: buildCollectionSearchQuery(text),
          },
          { signal },
        )
        .then((page) => ({ page })),
  };
}

function collectionProductsPlan(
  input: ResultsInput,
  collectionId: string,
): QueryPlan {
  const { client, contextKey, text, scope, search, sort, support } = input;
  const filters = buildCollectionProductFilters(
    {
      availableOnly: search.availableOnly,
      productType: search.productType ?? undefined,
      vendor: search.vendor ?? undefined,
      tags: search.tags,
    },
    support ?? undefined,
  );
  const { sortKey, reverse } = toCollectionSort(sort);
  const check = collectionClientCheck(scope, support, text);
  // Text is matched in the browser, so fetch big pages to search more at once.
  const first = check.text ? SHOPIFY_MAX_PAGE_SIZE : PICKER_PAGE_SIZE;
  return {
    key: JSON.stringify([
      'collection',
      contextKey,
      collectionId,
      filters,
      sortKey,
      reverse,
      first,
    ]),
    check: hasClientCheck(check) ? check : null,
    fetch: async (after, signal) => {
      const result = await client.browseCollectionProducts(
        { collectionId, first, after, filters, sortKey, reverse },
        { signal },
      );
      if (!result.found) throw new CollectionNotVisibleError();
      input.onSupport(collectionId, enabledCollectionFilters(result.filters));
      return { page: result.page };
    },
  };
}

function productsPlan(input: ResultsInput): QueryPlan {
  const { client, contextKey, text, search, sort } = input;
  const query = buildProductSearchQuery({
    text,
    productType: search.productType ?? undefined,
    vendor: search.vendor ?? undefined,
    tags: search.tags,
    availableOnly: search.availableOnly,
  });
  const { sortKey, reverse } = toProductSort(sort, Boolean(text));
  return {
    key: JSON.stringify([
      'products',
      contextKey,
      query ?? '',
      sortKey,
      reverse,
    ]),
    check: null,
    fetch: (after, signal) =>
      client
        .browseProducts(
          { first: PICKER_PAGE_SIZE, after, query, sortKey, reverse },
          { signal },
        )
        .then((page) => ({ page })),
  };
}

function planFor(input: ResultsInput): QueryPlan {
  if (input.kind === 'collection') return collectionsPlan(input);
  if (input.search.collectionId) {
    return collectionProductsPlan(input, input.search.collectionId);
  }
  return productsPlan(input);
}

/** The main results: collections, a collection's products, or products. */
export function usePickerResults(input: ResultsInput): Results {
  const plan = planFor(input);
  const query = usePagedQuery<ResultItem>(plan.key, plan.fetch);
  const { check } = plan;
  const items = useMemo(
    () =>
      check
        ? query.items.filter(
            (item) =>
              item.__typename !== 'Product' || matchesClientCheck(item, check),
          )
        : query.items,
    [query.items, check],
  );
  return { query, items, filteredLocally: check !== null };
}

/** Remembers which Search & Discovery filters each collection has enabled. */
export function useCollectionSupport() {
  const [supportById, setSupportById] = useState<
    Record<string, CollectionFilterSupport>
  >({});
  const remember = useCallback(
    (collectionId: string, support: CollectionFilterSupport) => {
      setSupportById((current) => {
        const known = current[collectionId];
        if (known && JSON.stringify(known) === JSON.stringify(support)) {
          return current;
        }
        return { ...current, [collectionId]: support };
      });
    },
    [],
  );
  return { supportById, remember };
}
