import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, TextInput } from 'datocms-react-ui';
import isEqual from 'lodash-es/isEqual';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CatalogItemRow from '../components/CatalogItemRow';
import CatalogProductCard from '../components/CatalogProductCard';
import useDebouncedValue from '../components/useDebouncedValue';
import {
  PICKER_MODAL_HEIGHT,
  SEARCH_DEBOUNCE_MS,
  SEARCH_PAGE_SIZE,
} from '../constants';
import {
  CentraClient,
  type CentraDisplayItem,
  type CentraItem,
} from '../lib/centraClient';
import {
  isConnectionComplete,
  normalizeFieldParameters,
  resolveConnection,
} from '../lib/parameters';
import { dedupeReferences, referenceKey } from '../lib/references';
import type {
  CentraFieldParametersV1,
  CentraReference,
  PickerModalParameters,
  PickerModalResult,
} from '../types';
import styles from './PickerModal.module.css';

type Props = {
  ctx: RenderModalCtx;
};

type SearchState = {
  status: 'loading' | 'success' | 'error';
  items: CentraDisplayItem[];
  page: number;
  hasMore: boolean;
  nextPage?: number;
  totalCount?: number;
  error?: string;
};

const INITIAL_CARD_SKELETON_IDS = [
  'initial-card-1',
  'initial-card-2',
  'initial-card-3',
  'initial-card-4',
  'initial-card-5',
  'initial-card-6',
  'initial-card-7',
  'initial-card-8',
];
const INITIAL_DRILLDOWN_SKELETON_IDS = [
  'initial-drilldown-1',
  'initial-drilldown-2',
  'initial-drilldown-3',
  'initial-drilldown-4',
  'initial-drilldown-5',
];
const LOAD_MORE_CARD_SKELETON_IDS = [
  'more-card-1',
  'more-card-2',
  'more-card-3',
];
const LOAD_MORE_DRILLDOWN_SKELETON_IDS = [
  'more-drilldown-1',
  'more-drilldown-2',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function useDeepStableValue<T>(value: T): T {
  const valueRef = useRef(value);

  if (!isEqual(valueRef.current, value)) {
    valueRef.current = value;
  }

  return valueRef.current;
}

function readModalParameters(value: unknown): PickerModalParameters | null {
  if (!isRecord(value) || !Array.isArray(value.references)) {
    return null;
  }

  return {
    fieldParameters: normalizeFieldParameters(value.fieldParameters),
    references: value.references as CentraReference[],
  };
}

function productTitle(displayItem: CentraDisplayItem): string {
  return (
    displayItem.name?.trim() ||
    displayItem.productVariant?.name?.trim() ||
    (displayItem.productNumber
      ? `Product ${displayItem.productNumber}`
      : `DisplayItem ${displayItem.id}`)
  );
}

function productIdentity(displayItem: CentraDisplayItem): string {
  return displayItem.productNumber
    ? `Product ${displayItem.productNumber}`
    : `DisplayItem ${displayItem.id}`;
}

function productDetail(displayItem: CentraDisplayItem): string | undefined {
  const parts = [
    displayItem.productVariant?.name?.trim(),
    displayItem.productVariant?.number?.trim(),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function imageUrl(displayItem: CentraDisplayItem): string | null {
  const image = displayItem.media.find((medium) =>
    medium.source.type?.toLocaleLowerCase().includes('image'),
  );
  return image?.source.url ?? displayItem.media[0]?.source.url ?? null;
}

function itemTitle(item: CentraItem): string {
  return (
    item.name?.trim() ||
    (item.productSizeId !== undefined
      ? `Size ${String(item.productSizeId)}`
      : undefined) ||
    item.sku?.trim() ||
    `Item ${item.id}`
  );
}

function itemStockLabel(item: CentraItem): string | null {
  if (!item.stock) return null;

  return item.stock.available ? 'Available' : 'Unavailable';
}

function hasExactItemMatch(
  displayItem: CentraDisplayItem,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return false;

  return displayItem.items.some(
    (item) =>
      item.sku?.toLocaleLowerCase() === normalizedQuery ||
      item.GTIN?.toLocaleLowerCase() === normalizedQuery,
  );
}

function friendlyError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Centra could not load the catalog. Try again.';
}

function verticalBodyPadding(bodyPadding: readonly number[] | undefined) {
  if (!bodyPadding || bodyPadding.length === 0) return 0;
  if (bodyPadding.length === 1) return bodyPadding[0] * 2;
  if (bodyPadding.length === 2) return bodyPadding[0] * 2;
  return bodyPadding[0] + bodyPadding[2];
}

function selectionContains(
  parameters: CentraFieldParametersV1,
  references: readonly CentraReference[],
  reference: CentraReference,
) {
  const key = referenceKey(parameters.kind, reference);
  return references.some(
    (candidate) => referenceKey(parameters.kind, candidate) === key,
  );
}

function searchCatalog(
  client: CentraClient,
  fieldParameters: CentraFieldParametersV1,
  options: {
    query: string;
    page: number;
    signal: AbortSignal;
  },
) {
  if (fieldParameters.kind === 'item') {
    return client.searchItems({
      ...options,
      limit: SEARCH_PAGE_SIZE,
    });
  }

  return client.searchDisplayItems({
    ...options,
    kind: fieldParameters.kind,
    limit: SEARCH_PAGE_SIZE,
  });
}

function pickerEntityLabels(kind: CentraFieldParametersV1['kind']): {
  singular: string;
  plural: string;
} {
  switch (kind) {
    case 'item':
      return { singular: 'SKU / size', plural: 'SKUs / sizes' };
    case 'variant':
      return { singular: 'product variant', plural: 'product variants' };
    default:
      return { singular: 'product', plural: 'products' };
  }
}

function CatalogSkeleton({ drilldown }: { drilldown: boolean }) {
  return (
    <div
      className={`${styles.skeletonCard} ${
        drilldown ? styles.skeletonDrilldown : ''
      }`}
      aria-hidden="true"
    >
      <div className={styles.skeletonMedia} />
      <div className={styles.skeletonContent}>
        <span className={styles.skeletonTitle} />
        <span className={styles.skeletonLine} />
        <span className={styles.skeletonShortLine} />
      </div>
      <div className={styles.skeletonAction} />
    </div>
  );
}

type ProductResultProps = {
  displayItem: CentraDisplayItem;
  fieldParameters: CentraFieldParametersV1;
  selection: CentraReference[];
  query: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleReference: (reference: CentraReference) => void;
};

function ProductResult({
  displayItem,
  fieldParameters,
  selection,
  query,
  expanded,
  onToggleExpanded,
  onToggleReference,
}: ProductResultProps) {
  const itemListId = `centra-display-item-${displayItem.id}-items`;
  const summaryId = `centra-display-item-${displayItem.id}-summary`;
  const displayReference: CentraReference = {
    displayItemId: displayItem.id,
  };
  const displaySelected =
    fieldParameters.kind !== 'item' &&
    selectionContains(fieldParameters, selection, displayReference);
  let actionLabel = displaySelected ? 'Remove' : 'Select';
  if (fieldParameters.kind === 'item') {
    actionLabel = expanded ? 'Hide SKUs' : 'Choose SKU';
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const rankedItems = displayItem.items
    .map((item, index) => ({
      item,
      index,
      exact:
        normalizedQuery.length > 0 &&
        (item.sku?.toLocaleLowerCase() === normalizedQuery ||
          item.GTIN?.toLocaleLowerCase() === normalizedQuery),
    }))
    .sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) || left.index - right.index,
    )
    .map(({ item }) => item);
  const selectedItemCount = selection.filter(
    (reference) =>
      'itemId' in reference && reference.displayItemId === displayItem.id,
  ).length;

  return (
    <CatalogProductCard
      title={productTitle(displayItem)}
      identity={productIdentity(displayItem)}
      detail={productDetail(displayItem)}
      imageUrl={imageUrl(displayItem)}
      price={displayItem.price?.formattedValue}
      available={displayItem.available}
      hasStock={displayItem.hasStock}
      selected={displaySelected}
      actionLabel={actionLabel}
      actionExpanded={fieldParameters.kind === 'item' ? expanded : undefined}
      actionControls={fieldParameters.kind === 'item' ? itemListId : undefined}
      summaryId={summaryId}
      onAction={() =>
        fieldParameters.kind === 'item'
          ? onToggleExpanded()
          : onToggleReference(displayReference)
      }
    >
      {fieldParameters.kind === 'item' && expanded && (
        <div className={styles.skuPanel}>
          <div className={styles.skuHeader}>
            <strong>SKUs / sizes</strong>
            <span>
              {selectedItemCount === 0
                ? 'Choose one or more rows'
                : `${selectedItemCount} selected`}
            </span>
          </div>
          {displayItem.items.length === 0 ? (
            <div className={styles.notice}>
              This product has no selectable SKU items.
            </div>
          ) : (
            rankedItems.map((item) => {
              const reference: CentraReference = {
                displayItemId: displayItem.id,
                itemId: item.id,
              };
              return (
                <CatalogItemRow
                  key={item.id}
                  title={itemTitle(item)}
                  itemId={item.id}
                  sku={item.sku}
                  gtin={item.GTIN}
                  stockLabel={itemStockLabel(item)}
                  preorder={item.preorder}
                  selected={selectionContains(
                    fieldParameters,
                    selection,
                    reference,
                  )}
                  onSelect={() => onToggleReference(reference)}
                />
              );
            })
          )}
        </div>
      )}
    </CatalogProductCard>
  );
}

function SearchStatus({
  pending,
  search,
}: {
  pending: boolean;
  search: SearchState;
}) {
  if (pending) {
    return <div className={styles.statusRow}>Searching…</div>;
  }

  if (search.status === 'error') {
    return (
      <div className={styles.statusRow}>
        <span className={styles.statusError} role="alert">
          {search.error}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.statusRow} aria-live="polite">
      {typeof search.totalCount === 'number' ? (
        `${search.totalCount} matching products`
      ) : (
        <span aria-hidden="true">&nbsp;</span>
      )}
    </div>
  );
}

type PickerResultsProps = {
  fieldParameters: CentraFieldParametersV1;
  entityPlural: string;
  search: SearchState;
  searchIsPending: boolean;
  selection: CentraReference[];
  query: string;
  expandedDisplayItemId: number | null;
  isLoadingMore: boolean;
  onToggleExpanded: (displayItemId: number) => void;
  onToggleReference: (reference: CentraReference) => void;
};

function PickerResults({
  fieldParameters,
  entityPlural,
  search,
  searchIsPending,
  selection,
  query,
  expandedDisplayItemId,
  isLoadingMore,
  onToggleExpanded,
  onToggleReference,
}: PickerResultsProps) {
  const drilldown = fieldParameters.kind === 'item';
  const resultsAreInactive = searchIsPending || search.status === 'error';
  const initialSkeletonIds = drilldown
    ? INITIAL_DRILLDOWN_SKELETON_IDS
    : INITIAL_CARD_SKELETON_IDS;
  const loadMoreSkeletonIds = drilldown
    ? LOAD_MORE_DRILLDOWN_SKELETON_IDS
    : LOAD_MORE_CARD_SKELETON_IDS;
  const showInitialSkeletons = searchIsPending && search.items.length === 0;

  return (
    <div
      className={`${styles.results} ${
        resultsAreInactive && search.items.length > 0
          ? styles.resultsRefreshing
          : ''
      }`}
      aria-busy={searchIsPending || isLoadingMore}
      inert={resultsAreInactive ? true : undefined}
    >
      {showInitialSkeletons && (
        <>
          <span
            className={styles.srOnly}
            role="status"
            aria-label="Loading Centra catalog"
          />
          {initialSkeletonIds.map((id) => (
            <CatalogSkeleton key={id} drilldown={drilldown} />
          ))}
        </>
      )}

      {!searchIsPending &&
        search.status === 'error' &&
        search.items.length === 0 && (
          <div className={styles.resultsState}>
            Centra could not load the catalog. Try the search again.
          </div>
        )}

      {!searchIsPending &&
        search.status === 'success' &&
        search.items.length === 0 && (
          <div className={styles.resultsState}>
            No matching {entityPlural} were found.
          </div>
        )}

      {search.items.map((displayItem) => (
        <ProductResult
          key={displayItem.id}
          displayItem={displayItem}
          fieldParameters={fieldParameters}
          selection={selection}
          query={query}
          expanded={expandedDisplayItemId === displayItem.id}
          onToggleExpanded={() => onToggleExpanded(displayItem.id)}
          onToggleReference={onToggleReference}
        />
      ))}

      {isLoadingMore &&
        loadMoreSkeletonIds.map((id) => (
          <CatalogSkeleton key={id} drilldown={drilldown} />
        ))}
    </div>
  );
}

type PickerFooterProps = {
  entityLabel: string;
  entityPlural: string;
  selectionCount: number;
  hasMore: boolean;
  searchIsPending: boolean;
  isLoadingMore: boolean;
  loadMoreError: string | null;
  onLoadMore: () => void;
  onCancel: () => void;
  onApply: () => void;
};

function PickerFooter({
  entityLabel,
  entityPlural,
  selectionCount,
  hasMore,
  searchIsPending,
  isLoadingMore,
  loadMoreError,
  onLoadMore,
  onCancel,
  onApply,
}: PickerFooterProps) {
  const showPagination = hasMore || isLoadingMore || loadMoreError !== null;
  let paginationLabel = 'Load more';
  if (isLoadingMore) paginationLabel = 'Loading…';
  if (loadMoreError) paginationLabel = 'Try again';

  return (
    <div className={styles.footer} role="group" aria-label="Picker actions">
      <span className={styles.footerInfo}>
        <strong>{selectionCount}</strong>{' '}
        {selectionCount === 1 ? entityLabel : entityPlural} selected
      </span>
      <div className={styles.paginationSlot}>
        {showPagination && (
          <Button
            buttonType="muted"
            disabled={isLoadingMore || searchIsPending}
            onClick={onLoadMore}
          >
            {paginationLabel}
          </Button>
        )}
        {loadMoreError && (
          <span className={styles.srOnly} role="alert">
            Loading more products failed: {loadMoreError}
          </span>
        )}
      </div>
      <Button buttonType="muted" onClick={onCancel}>
        Cancel
      </Button>
      <Button buttonType="primary" onClick={onApply}>
        Apply selection
      </Button>
    </div>
  );
}

export default function PickerModal({ ctx }: Props) {
  const stableModalParameters = useDeepStableValue(ctx.parameters);
  const stablePluginParameters = useDeepStableValue(
    ctx.plugin.attributes.parameters,
  );
  const modalParameters = useMemo(
    () => readModalParameters(stableModalParameters),
    [stableModalParameters],
  );
  const fieldParameters = modalParameters?.fieldParameters;
  const connection = useMemo(
    () => resolveConnection(stablePluginParameters),
    [stablePluginParameters],
  );
  const client = useMemo(() => new CentraClient(connection), [connection]);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const [selection, setSelection] = useState<CentraReference[]>(() => {
    if (!modalParameters) return [];
    try {
      return dedupeReferences(
        modalParameters.fieldParameters.kind,
        modalParameters.references,
      );
    } catch {
      return [];
    }
  });
  const [expandedDisplayItemId, setExpandedDisplayItemId] = useState<
    number | null
  >(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadMoreController = useRef<AbortController | null>(null);
  const [search, setSearch] = useState<SearchState>({
    status: 'loading',
    items: [],
    page: 1,
    hasMore: false,
  });

  useEffect(() => {
    if (
      modalParameters &&
      fieldParameters &&
      isConnectionComplete(connection)
    ) {
      ctx.setHeight(PICKER_MODAL_HEIGHT);
    }
  }, [connection, ctx, fieldParameters, modalParameters]);

  const updateQuery = (value: string) => {
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setIsLoadingMore(false);
    setLoadMoreError(null);
    setQuery(value);
  };

  useEffect(() => {
    if (!fieldParameters || !isConnectionComplete(connection)) return;

    const controller = new AbortController();
    setSearch((current) => ({
      ...current,
      status: 'loading',
      error: undefined,
    }));

    const request = searchCatalog(client, fieldParameters, {
      query: debouncedQuery,
      page: 1,
      signal: controller.signal,
    });

    void request
      .then((result) => {
        if (controller.signal.aborted) return;
        setSearch({
          status: 'success',
          items: result.items,
          page: result.page,
          hasMore: result.hasMore,
          nextPage: result.nextPage,
          totalCount: result.totalCount,
        });
        setLoadMoreError(null);

        setExpandedDisplayItemId((current) => {
          if (result.items.some((item) => item.id === current)) return current;
          if (fieldParameters.kind !== 'item') return null;
          return (
            result.items.find((item) => hasExactItemMatch(item, debouncedQuery))
              ?.id ?? null
          );
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSearch((current) => ({
          ...current,
          status: 'error',
          hasMore: false,
          nextPage: undefined,
          error: friendlyError(error),
        }));
      });

    return () => {
      controller.abort();
      loadMoreController.current?.abort();
    };
  }, [client, connection, debouncedQuery, fieldParameters]);

  useLayoutEffect(() => {
    if (expandedDisplayItemId === null) return;

    const summary = document.getElementById(
      `centra-display-item-${expandedDisplayItemId}-summary`,
    );
    const itemList = document.getElementById(
      `centra-display-item-${expandedDisplayItemId}-items`,
    );

    summary?.scrollIntoView?.({ behavior: 'auto', block: 'nearest' });
    itemList
      ?.querySelector('button')
      ?.scrollIntoView?.({ behavior: 'auto', block: 'nearest' });
  }, [expandedDisplayItemId]);

  if (!modalParameters || !fieldParameters) {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.error} role="alert">
          The picker received invalid parameters. Close it and reopen the Centra
          field.
        </div>
      </Canvas>
    );
  }

  if (!isConnectionComplete(connection)) {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.error} role="alert">
          Add a valid Centra Storefront API URL and token in the plugin settings
          before browsing the catalog.
        </div>
      </Canvas>
    );
  }

  const toggleReference = (reference: CentraReference) => {
    setSelection((current) => {
      const selected = selectionContains(fieldParameters, current, reference);
      if (fieldParameters.cardinality === 'single') {
        return selected ? [] : [reference];
      }

      return selected
        ? current.filter(
            (candidate) =>
              referenceKey(fieldParameters.kind, candidate) !==
              referenceKey(fieldParameters.kind, reference),
          )
        : dedupeReferences(fieldParameters.kind, [...current, reference]);
    });
  };

  const loadMore = async () => {
    if (isLoadingMore || !search.hasMore) return;
    loadMoreController.current?.abort();
    const controller = new AbortController();
    loadMoreController.current = controller;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const nextPage = search.nextPage ?? search.page + 1;
      const result = await searchCatalog(client, fieldParameters, {
        query: debouncedQuery,
        page: nextPage,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      setSearch((current) => ({
        status: 'success',
        items: [
          ...current.items,
          ...result.items.filter(
            (item) =>
              !current.items.some((candidate) => candidate.id === item.id),
          ),
        ],
        page: result.page,
        hasMore: result.hasMore,
        nextPage: result.nextPage,
        totalCount: result.totalCount ?? current.totalCount,
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadMoreError(friendlyError(error));
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        setIsLoadingMore(false);
      }
    }
  };

  const resolveSelection = () => {
    const result: PickerModalResult = {
      references: dedupeReferences(fieldParameters.kind, selection),
    };
    ctx.resolve(result);
  };

  const { singular: entityLabel, plural: entityPlural } = pickerEntityLabels(
    fieldParameters.kind,
  );
  const queryIsDebouncing = query.trim() !== debouncedQuery;
  const searchIsPending = queryIsDebouncing || search.status === 'loading';
  const toggleExpanded = (displayItemId: number) => {
    setExpandedDisplayItemId((current) =>
      current === displayItemId ? null : displayItemId,
    );
  };
  const canvasVerticalPadding = verticalBodyPadding(ctx.bodyPadding);

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div
        className={styles.root}
        style={{ height: `calc(100vh - ${canvasVerticalPadding}px)` }}
      >
        <div className={styles.header}>
          <div className={styles.searchRow}>
            <TextInput
              id="centra-search"
              name="centra-search"
              type="search"
              className={styles.searchInput}
              labelText={`Search Centra ${entityPlural}`}
              placeholder={
                fieldParameters.kind === 'item'
                  ? 'Search products, sizes, SKU, or GTIN…'
                  : 'Search by name or product number…'
              }
              value={query}
              onChange={updateQuery}
            />
            <Button
              buttonSize="s"
              buttonType="muted"
              disabled={query.length === 0}
              onClick={() => updateQuery('')}
            >
              Clear
            </Button>
          </div>

          <SearchStatus pending={searchIsPending} search={search} />
        </div>

        <PickerResults
          fieldParameters={fieldParameters}
          entityPlural={entityPlural}
          search={search}
          searchIsPending={searchIsPending}
          selection={selection}
          query={debouncedQuery}
          expandedDisplayItemId={expandedDisplayItemId}
          isLoadingMore={isLoadingMore}
          onToggleExpanded={toggleExpanded}
          onToggleReference={toggleReference}
        />

        <PickerFooter
          entityLabel={entityLabel}
          entityPlural={entityPlural}
          selectionCount={selection.length}
          hasMore={search.hasMore}
          searchIsPending={searchIsPending}
          isLoadingMore={isLoadingMore}
          loadMoreError={loadMoreError}
          onLoadMore={() => void loadMore()}
          onCancel={() => ctx.resolve(null)}
          onApply={resolveSelection}
        />
      </div>
    </Canvas>
  );
}
