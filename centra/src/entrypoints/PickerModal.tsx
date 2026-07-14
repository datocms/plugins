import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner, TextInput } from 'datocms-react-ui';
import isEqual from 'lodash-es/isEqual';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const parts = displayItem.productNumber
    ? [`Product ${displayItem.productNumber}`]
    : [];
  parts.push(`DisplayItem ${displayItem.id}`);
  return parts.join(' · ');
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

function friendlyError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Centra could not load the catalog. Try again.';
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
      onAction={() =>
        fieldParameters.kind === 'item'
          ? onToggleExpanded()
          : onToggleReference(displayReference)
      }
    >
      {fieldParameters.kind === 'item' && expanded && (
        <div>
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
    setQuery(value);
  };

  useEffect(() => {
    if (!fieldParameters || !isConnectionComplete(connection)) return;

    const controller = new AbortController();
    setSearch({
      status: 'loading',
      items: [],
      page: 1,
      hasMore: false,
    });
    setExpandedDisplayItemId(null);

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

        if (
          fieldParameters.kind === 'item' &&
          debouncedQuery.length > 0 &&
          result.items[0]
        ) {
          setExpandedDisplayItemId(result.items[0].id);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSearch({
          status: 'error',
          items: [],
          page: 1,
          hasMore: false,
          error: friendlyError(error),
        });
      });

    return () => {
      controller.abort();
      loadMoreController.current?.abort();
    };
  }, [client, connection, debouncedQuery, fieldParameters]);

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
      setSearch((current) => ({
        ...current,
        status: 'error',
        error: friendlyError(error),
      }));
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

  const entityLabel =
    fieldParameters.kind === 'item'
      ? 'SKU or size'
      : fieldParameters.kind === 'variant'
        ? 'product variant'
        : 'product';

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div className={styles.root}>
        <div className={styles.searchRow}>
          <TextInput
            id="centra-search"
            name="centra-search"
            type="search"
            className={styles.searchInput}
            labelText={`Search Centra ${entityLabel}s`}
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

        <div className={styles.selectionSummary} aria-live="polite">
          <span>
            <strong>{selection.length}</strong>{' '}
            {selection.length === 1 ? entityLabel : `${entityLabel}s`} selected
          </span>
          {typeof search.totalCount === 'number' &&
            search.status === 'success' && (
              <span>{search.totalCount} matching products</span>
            )}
        </div>

        {search.status === 'loading' && (
          <div className={styles.loading} aria-label="Loading Centra catalog">
            <Spinner placement="centered" size={42} />
          </div>
        )}

        {search.status === 'error' && (
          <div className={styles.error} role="alert">
            {search.error}
          </div>
        )}

        {search.status === 'success' && search.items.length === 0 && (
          <div className={styles.empty}>
            No matching Centra {entityLabel}s were found.
          </div>
        )}

        {search.items.length > 0 && (
          <div className={styles.results}>
            {search.items.map((displayItem) => (
              <ProductResult
                key={displayItem.id}
                displayItem={displayItem}
                fieldParameters={fieldParameters}
                selection={selection}
                query={debouncedQuery}
                expanded={expandedDisplayItemId === displayItem.id}
                onToggleExpanded={() =>
                  setExpandedDisplayItemId((current) =>
                    current === displayItem.id ? null : displayItem.id,
                  )
                }
                onToggleReference={toggleReference}
              />
            ))}
          </div>
        )}

        {search.hasMore && search.status !== 'loading' && (
          <div className={styles.loadMore}>
            <Button
              buttonType="muted"
              disabled={isLoadingMore}
              onClick={() => void loadMore()}
            >
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}

        <div className={styles.footer}>
          <span className={styles.footerInfo}>
            Changes are saved only when you apply the selection.
          </span>
          <Button buttonType="muted" onClick={() => ctx.resolve(null)}>
            Cancel
          </Button>
          <Button buttonType="primary" onClick={resolveSelection}>
            Apply selection
          </Button>
        </div>
      </div>
    </Canvas>
  );
}
