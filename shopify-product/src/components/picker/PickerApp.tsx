import type { RenderModalCtx } from 'datocms-plugin-sdk';
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  entryForNode,
  isNodeUnavailable,
  maxReachedMessage,
  pickerLabels,
  selectedVariantsOf,
  skuMatchesSearch,
  soldOutReason,
} from '../../lib/pickerSearch';
import { isAbortError, type ShopifyClient } from '../../lib/shopifyClient';
import type {
  PickerModalParameters,
  PickerModalResult,
  PickerSelectedEntry,
  PickerUnavailableEntry,
  ProductSummary,
  ShopifyNode,
  StoreConnection,
} from '../../types';
import { useCapabilities } from '../shared/useCapabilities';
import FilterBar from './FilterBar';
import MarketSwitcher from './MarketSwitcher';
import { Header, HeaderRow, SearchField, ViewToggle } from './PickerHeader';
import {
  CollectionList,
  type ItemEnv,
  ProductList,
  SkuMatches,
} from './PickerResults';
import ResultsPane, { type ResultsState } from './ResultsPane';
import SelectionFooter from './SelectionFooter';
import { type Market, useMarket } from './useMarket';
import {
  type ResultItem,
  useCollectionOptions,
  useFilterValues,
  useLocalization,
  useLockedCollectionTitle,
  usePickerResults,
  useSkuMatches,
} from './usePickerData';
import { type PickerSearch, usePickerSearch } from './usePickerSearch';
import { usePickerView } from './usePickerView';
import { type Selection, useSelection } from './useSelection';

type Props = {
  ctx: RenderModalCtx;
  params: PickerModalParameters;
  store: StoreConnection;
};

const ALREADY_IN_FIELD_ALERT =
  "Couldn't choose the variant, as it's already in this field!";

const NOTHING_UNAVAILABLE: readonly PickerUnavailableEntry[] = [];

/**
 * Variant mode: open products, and pick single-variant products directly.
 * `choose` adds (never toggles): the variant may already be an entry the
 * field couldn't resolve, and a click meant as "select" must not remove it.
 */
function useProductActivation(
  ctx: RenderModalCtx,
  params: PickerModalParameters,
  market: Market,
  selection: Selection,
  pick: (node: ShopifyNode) => void,
  choose: (node: ShopifyNode) => void,
  isUnavailable: (node: ShopifyNode) => boolean,
) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const kind = params.fieldParameters.kind;

  const pickOnlyVariant = useCallback(
    (product: ProductSummary) => {
      const selected = selectedVariantsOf(selection.entries, product.id);
      if (selection.multiple && selected.length > 0) {
        for (const entry of selected) selection.remove(entry.key);
        return;
      }
      if (selection.atMax || pendingId !== null) return;
      setPendingId(product.id);
      market.client
        .productVariants({ productId: product.id, first: 1 })
        .then((result) => {
          const variant = result?.page.nodes[0];
          if (!variant) {
            void ctx.alert("Couldn't load the product variant!");
          } else if (isUnavailable(variant)) {
            // Its card can't tell before the variant loads (Replace).
            void ctx.alert(ALREADY_IN_FIELD_ALERT);
          } else {
            choose(variant);
          }
        })
        .catch((error: unknown) => {
          if (!isAbortError(error)) {
            void ctx.alert("Couldn't load the product variant!");
          }
        })
        .finally(() => setPendingId(null));
    },
    [ctx, market.client, choose, isUnavailable, selection, pendingId],
  );

  const activateProduct = useCallback(
    (product: ProductSummary) => {
      if (kind !== 'variant') {
        pick(product);
        return;
      }
      if ((product.variantsCount?.count ?? 0) === 1) {
        pickOnlyVariant(product);
        return;
      }
      setExpandedId((current) => (current === product.id ? null : product.id));
    },
    [kind, pick, pickOnlyVariant],
  );

  return { expandedId, pendingId, activateProduct };
}

function resultsState(
  query: ReturnType<typeof usePickerResults>['query'],
): ResultsState {
  return {
    status: query.status,
    error: query.error,
    hasNextPage: query.hasNextPage,
    loadingMore: query.loadingMore,
    loadMoreError: query.loadMoreError,
    loadMore: query.loadMore,
    retry: query.retry,
    loadedCount: query.items.length,
  };
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Entries the field couldn't resolve (a failed or partial load) get their
 * nodes once, on open, so the tray, badges and checked states are right
 * whichever page shows them. Nodes that stay null are "Not visible".
 */
function useHydrateUnresolved(client: ShopifyClient, selection: Selection) {
  const { hydrate } = selection;
  const clientRef = useRef(client);
  const [ids] = useState(() =>
    selection.entries
      .filter((entry) => entry.node === null)
      .map((entry) => entry.id)
      .filter(isPresent),
  );
  useEffect(() => {
    if (ids.length === 0) return undefined;
    const controller = new AbortController();
    clientRef.current
      .loadNodes(ids, { signal: controller.signal })
      .then((nodes) => {
        if (!controller.signal.aborted) hydrate(nodes.filter(isPresent));
      })
      .catch(() => {
        // They stay "Not visible"; picking them again from the results works.
      });
    return () => controller.abort();
  }, [ids, hydrate]);
}

function isProduct(item: ResultItem): item is ProductSummary {
  return item.__typename === 'Product';
}

/** The product, variant or collection picker. */
export default function PickerApp({ ctx, params, store }: Props) {
  const { fieldParameters } = params;
  const { kind, scope } = fieldParameters;
  const labels = pickerLabels(kind);
  const market = useMarket(store, params.context);
  const capabilities = useCapabilities(market.baseClient);
  const search = usePickerSearch(kind, scope);
  const [view, setView] = usePickerView();
  const selection = useSelection(fieldParameters, params.selected);

  // Controls that leave or turn disabled once used (Clear, Clear filters)
  // hand focus to the search, the picker's starting point.
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useCallback(() => searchRef.current?.focus(), []);
  const clearFilters = () => {
    focusSearch();
    search.clearFilters();
  };
  const clearSelection = () => {
    focusSearch();
    selection.clear();
  };

  const results = usePickerResults({
    client: market.client,
    contextKey: market.contextKey,
    kind,
    text: search.debouncedText,
    scope,
    search: search.search,
    sort: search.sort,
    support: search.support,
    onSupport: search.rememberSupport,
  });
  const sku = useSkuMatches(
    market.client,
    market.contextKey,
    search.skuText ?? '',
    search.skuText !== null,
  );
  const localization = useLocalization(market.client, market.contextKey);
  const browsesProducts = kind !== 'collection';
  // One request, once detection says whether it can include the tags.
  const filterValues = useFilterValues(
    market.baseClient,
    browsesProducts && !capabilities.pending,
    capabilities.tags,
  );
  const collectionOptions = useCollectionOptions(
    market.client,
    market.contextKey,
    browsesProducts && !scope?.collectionId,
  );
  const lockedCollectionTitle = useLockedCollectionTitle(market.client, scope);

  const resolve = useCallback(
    (entries: PickerSelectedEntry[]) => {
      const result: PickerModalResult = {
        selected: entries,
        ...(market.context ? { context: market.context } : {}),
      };
      void ctx.resolve(result);
    },
    [ctx, market.context],
  );

  const pick = useCallback(
    (node: ShopifyNode) => {
      if (selection.multiple) selection.toggle(node);
      else resolve([entryForNode(node)]);
    },
    [resolve, selection],
  );
  const choose = useCallback(
    (node: ShopifyNode) => {
      if (selection.multiple) selection.select(node);
      else resolve([entryForNode(node)]);
    },
    [resolve, selection],
  );
  const unavailable = params.unavailable ?? NOTHING_UNAVAILABLE;
  const isUnavailable = useCallback(
    (node: ShopifyNode) => isNodeUnavailable(unavailable, node),
    [unavailable],
  );

  // Entries the field couldn't resolve pick up nodes that show up here.
  useHydrateUnresolved(market.client, selection);
  const { hydrate } = selection;
  const loaded = results.query.items;
  useEffect(() => {
    if (loaded.length > 0) hydrate(loaded);
  }, [hydrate, loaded]);
  useEffect(() => {
    if (!sku.value || sku.value.length === 0) return;
    hydrate(sku.value.flatMap((match) => [match.product, ...match.variants]));
  }, [hydrate, sku.value]);

  const activation = useProductActivation(
    ctx,
    params,
    market,
    selection,
    pick,
    choose,
    isUnavailable,
  );

  const effective = search.search;
  const skuMatches = useMemo(
    () =>
      (sku.value ?? []).filter((match) =>
        skuMatchesSearch(match.product, effective),
      ),
    [sku.value, effective],
  );
  const mainItems = useMemo(() => {
    if (kind !== 'product' || skuMatches.length === 0) return results.items;
    const pinned = new Set(skuMatches.map((match) => match.product.id));
    return results.items.filter((item) => !pinned.has(item.id));
  }, [kind, results.items, skuMatches]);

  const env: ItemEnv = {
    kind,
    view,
    locale: ctx.ui.locale,
    inventory: capabilities.inventory,
    multiple: selection.multiple,
    client: market.client,
    contextKey: market.contextKey,
    disabledReason: selection.atMax
      ? maxReachedMessage(selection.max, kind)
      : null,
    isSelected: selection.isSelected,
    isUnavailable,
    selectedVariants: (productId) =>
      selectedVariantsOf(selection.entries, productId).length,
    soldOutReason: kind === 'variant' ? soldOutReason(scope, effective) : null,
    expandedId: activation.expandedId,
    pendingId: activation.pendingId,
    pick,
    hydrate,
    activateProduct: activation.activateProduct,
  };

  return (
    <>
      <PickerHeader
        labels={labels}
        search={search}
        searchRef={searchRef}
        view={view}
        onViewChange={setView}
        market={market}
        localization={localization}
        locale={ctx.ui.locale}
        filterBar={
          browsesProducts ? (
            <FilterBar
              scope={scope}
              lockedCollectionTitle={lockedCollectionTitle}
              filters={search.filters}
              setFilters={search.setFilters}
              clearFilters={clearFilters}
              filtersActive={search.filtersActive}
              controls={search.controls}
              inCollection={search.inCollection}
              support={search.support}
              tagsCapability={capabilities.tags}
              tagsPending={capabilities.pending}
              filterValues={filterValues}
              collectionOptions={collectionOptions}
              sort={search.sort}
              sortContext={search.sortContext}
            />
          ) : null
        }
      />
      <ResultsPane
        labels={labels}
        state={resultsState(results.query)}
        isEmpty={mainItems.length === 0}
        visibleCount={mainItems.length}
        filtersActive={search.filtersActive}
        searching={search.debouncedText !== ''}
        onClearFilters={clearFilters}
        onFocusLost={focusSearch}
        pinned={<SkuMatches env={env} matches={skuMatches} />}
        pinnedCount={skuMatches.length}
        mainTitle={`All ${labels.resultMany}`}
      >
        {kind === 'collection' ? (
          <CollectionList
            env={env}
            collections={mainItems.filter(
              (item) => item.__typename === 'Collection',
            )}
          />
        ) : (
          <ProductList
            env={env}
            products={mainItems.filter(isProduct)}
            label={`All ${labels.resultMany}`}
            prefix="main"
          />
        )}
      </ResultsPane>
      <SelectionFooter
        selection={selection}
        labels={labels}
        kind={kind}
        min={fieldParameters.min}
        onClear={clearSelection}
        onApply={() => resolve(selection.entries)}
      />
    </>
  );
}

function PickerHeader({
  labels,
  search,
  searchRef,
  view,
  onViewChange,
  market,
  localization,
  locale,
  filterBar,
}: {
  labels: ReturnType<typeof pickerLabels>;
  search: PickerSearch;
  searchRef: RefObject<HTMLInputElement | null>;
  view: ReturnType<typeof usePickerView>[0];
  onViewChange: ReturnType<typeof usePickerView>[1];
  market: Market;
  localization: ReturnType<typeof useLocalization>;
  locale: string;
  filterBar: ReactNode;
}) {
  return (
    <Header>
      <HeaderRow>
        <SearchField
          value={search.text}
          label={labels.searchLabel}
          placeholder={labels.placeholder}
          onChange={search.setText}
          inputRef={searchRef}
        />
        <ViewToggle view={view} onChange={onViewChange} />
        <MarketSwitcher
          localization={localization}
          requested={market.context}
          applied={market.client.appliedContext()}
          locale={locale}
          onChange={market.setContext}
        />
      </HeaderRow>
      {filterBar}
    </Header>
  );
}
