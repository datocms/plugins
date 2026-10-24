import type { RenderModalCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import EntityRow from 'datocms-react-ui/EntityRow';
import { useDebouncedValue } from 'datocms-react-ui/hooks/useDebouncedValue';
import IdText from 'datocms-react-ui/IdText';
import ListArea from 'datocms-react-ui/ListArea';
import Pane from 'datocms-react-ui/Pane';
import Pill from 'datocms-react-ui/Pill';
import {
  type RowSelection,
  Table,
  type TableColumn,
  type TableFirstCell,
  useInMemoryTableLayout,
} from 'datocms-react-ui/Table';
import StatusCell from 'datocms-react-ui/Table/cells/StatusCell';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Thumbnail from '../components/Thumbnail';
import {
  PICKER_MODAL_HEIGHT,
  SEARCH_DEBOUNCE_MS,
  SEARCH_PAGE_SIZE,
} from '../constants';
import { BagShoppingIcon, CircleExclamationIcon } from '../icons';
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
  CentraReferenceKind,
  PickerModalParameters,
  PickerModalResult,
} from '../types';
import {
  availabilityLabel,
  type CountNouns,
  countLabel,
  hasExactItemMatch,
  imageUrl,
  isRecord,
  itemStockLabel,
  itemTitle,
  KIND_NOUNS,
  productDetail,
  productIdentity,
  productTitle,
  rankItems,
} from '../utils/catalog';
import { scrollParent, scrollToNearestEdge } from '../utils/scroll';
import { useDeepStableValue } from '../utils/useDeepStableValue';
import styles from './PickerModal.module.css';

type Props = {
  ctx: RenderModalCtx;
};

type SearchState = {
  status: 'loading' | 'success' | 'error';
  items: CentraDisplayItem[];
  page: number;
  /** The text of the last settled search */
  query: string;
  totalCount?: number;
  error?: string;
};

function readModalParameters(value: unknown): PickerModalParameters | null {
  if (!isRecord(value) || !Array.isArray(value.references)) {
    return null;
  }

  return {
    fieldParameters: normalizeFieldParameters(value.fieldParameters),
    references: value.references as CentraReference[],
  };
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

function pageCountForResult(result: {
  page: number;
  hasMore: boolean;
  totalCount?: number;
}): number {
  if (typeof result.totalCount === 'number') {
    return Math.max(1, Math.ceil(result.totalCount / SEARCH_PAGE_SIZE));
  }

  return Math.max(1, result.page + (result.hasMore ? 1 : 0));
}

/**
 * What the results list, and the name of the list: the SKU picker lists
 * products, with their SKUs
 */
const LISTED: Record<
  CentraReferenceKind,
  { nouns: CountNouns; label: string }
> = {
  primaryProduct: { nouns: KIND_NOUNS.primaryProduct, label: 'Products' },
  variant: { nouns: KIND_NOUNS.variant, label: 'Product variants' },
  item: { nouns: KIND_NOUNS.primaryProduct, label: 'Products' },
};

// ---------------------------------------------------------------------------
// The results: a table of products or variants, or a tree of products and
// their SKUs
// ---------------------------------------------------------------------------

type SelectionProps = {
  fieldParameters: CentraFieldParametersV1;
  selection: CentraReference[];
  onToggleReference: (reference: CentraReference) => void;
};

type ResultRow =
  | { type: 'product'; displayItem: CentraDisplayItem; selectedCount: number }
  | { type: 'item'; item: CentraItem };

function AvailabilityCell({ label }: { label: string | null }) {
  return label ? (
    <StatusCell tone={label === 'Available' ? 'success' : 'warning'}>
      {label}
    </StatusCell>
  ) : null;
}

function NameCell({ row }: { row: ResultRow }) {
  if (row.type === 'item') {
    return (
      <EntityRow
        layout="row"
        title={itemTitle(row.item)}
        afterTitle={row.item.preorder ? <Pill>Preorder</Pill> : undefined}
      >
        Item <IdText id={row.item.id} />
      </EntityRow>
    );
  }

  const { displayItem, selectedCount } = row;
  return (
    <EntityRow
      layout="row"
      image={<Thumbnail url={imageUrl(displayItem)} />}
      title={productTitle(displayItem)}
      afterTitle={
        selectedCount > 0 ? (
          <Pill>{`${countLabel(selectedCount, KIND_NOUNS.item)} selected`}</Pill>
        ) : undefined
      }
    >
      {[productIdentity(displayItem), productDetail(displayItem)]
        .filter(Boolean)
        .join(' · ')}
    </EntityRow>
  );
}

const COLUMNS: TableColumn<ResultRow>[] = [
  {
    name: 'name',
    label: 'Name',
    // The image, the title and the details: two lines of their own
    truncate: false,
    minWidth: 200,
    renderCell: (row) => <NameCell row={row} />,
  },
  {
    name: 'sku',
    label: 'SKU',
    renderCell: (row) =>
      row.type === 'item' && row.item.sku ? <IdText id={row.item.sku} /> : null,
  },
  {
    name: 'gtin',
    label: 'GTIN',
    renderCell: (row) =>
      row.type === 'item' && row.item.GTIN ? (
        <IdText id={row.item.GTIN} />
      ) : null,
  },
  {
    name: 'price',
    label: 'Price',
    renderCell: (row) =>
      row.type === 'product' ? row.displayItem.price?.formattedValue : null,
  },
  {
    name: 'availability',
    label: 'Availability',
    renderCell: (row) => (
      <AvailabilityCell
        label={
          row.type === 'product'
            ? availabilityLabel(
                row.displayItem.available,
                row.displayItem.hasStock,
              )
            : itemStockLabel(row.item)
        }
      />
    ),
  },
];

const SKU_LAYOUT = {
  columns: [
    { name: 'name', width: 5 },
    { name: 'sku', width: 2 },
    { name: 'gtin', width: 2 },
    { name: 'price', width: 1.2 },
    { name: 'availability', width: 2 },
  ],
};

const ALWAYS_VISIBLE_CHECKBOXES = { alwaysVisible: true };

/** A product or a variant has no SKU or GTIN of its own */
const PRODUCT_COLUMNS = COLUMNS.filter(
  (column) => column.name !== 'sku' && column.name !== 'gtin',
);

const PRODUCT_LAYOUT = {
  columns: [
    { name: 'name', width: 5 },
    { name: 'price', width: 1.2 },
    { name: 'availability', width: 2 },
  ],
};

/**
 * A row per product or variant. A click on the row (or its checkbox) toggles
 * it in the selection.
 */
function ProductTable({
  items,
  fieldParameters,
  selection,
  onToggleReference,
}: SelectionProps & { items: CentraDisplayItem[] }) {
  const [layout, setLayout] = useInMemoryTableLayout(PRODUCT_LAYOUT);

  return (
    <Table
      columns={PRODUCT_COLUMNS}
      layout={layout}
      onLayoutChange={setLayout}
      checkboxes={ALWAYS_VISIBLE_CHECKBOXES}
    >
      <Table.Header />
      <Table.Body>
        {items.map((displayItem) => {
          const reference: CentraReference = { displayItemId: displayItem.id };
          const row: ResultRow = {
            type: 'product',
            displayItem,
            selectedCount: 0,
          };
          return (
            <Table.Row
              key={displayItem.id}
              row={row}
              selection={{
                selected: selectionContains(
                  fieldParameters,
                  selection,
                  reference,
                ),
                onSelect: () => onToggleReference(reference),
              }}
            />
          );
        })}
      </Table.Body>
    </Table>
  );
}

/** A product is never picked itself: its SKUs are */
const PRODUCT_SELECTION: RowSelection = {
  selected: false,
  onSelect: () => {},
  disabled: true,
};

const SKU_FIRST_CELL: TableFirstCell = { indentation: 30 };

const NO_SKUS = { reason: 'This product has no SKUs.' };

type SkuTableProps = SelectionProps & {
  items: CentraDisplayItem[];
  query: string;
  expandedDisplayItemId: number | null;
  onToggleExpanded: (displayItemId: number) => void;
};

/**
 * A row per product, which opens its SKUs under it (one product at a time),
 * exact SKU or GTIN matches first. A click on a SKU row (or its checkbox)
 * toggles it in the selection.
 */
function SkuTable({
  items,
  query,
  expandedDisplayItemId,
  onToggleExpanded,
  fieldParameters,
  selection,
  onToggleReference,
}: SkuTableProps) {
  const [layout, setLayout] = useInMemoryTableLayout(SKU_LAYOUT);

  const skuRows = (displayItem: CentraDisplayItem) =>
    rankItems(displayItem, query).map((item, index) => {
      const reference: CentraReference = {
        displayItemId: displayItem.id,
        itemId: item.id,
      };
      const row: ResultRow = { type: 'item', item };
      return (
        <Table.Row
          key={`${displayItem.id}-${item.id}`}
          row={row}
          firstCell={SKU_FIRST_CELL}
          selection={{
            selected: selectionContains(fieldParameters, selection, reference),
            onSelect: () => onToggleReference(reference),
          }}
          wrapperProps={
            index === 0
              ? { id: `centra-display-item-${displayItem.id}-items` }
              : undefined
          }
        />
      );
    });

  return (
    <Table
      columns={COLUMNS}
      layout={layout}
      onLayoutChange={setLayout}
      checkboxes={ALWAYS_VISIBLE_CHECKBOXES}
      tree
    >
      <Table.Header />
      <Table.Body>
        {items.flatMap((displayItem) => {
          const open = expandedDisplayItemId === displayItem.id;
          const hasSkus = displayItem.items.length > 0;
          // A product with no SKU doesn't open: no pointer, no Tab stop
          const openRow = hasSkus
            ? { onOpen: () => onToggleExpanded(displayItem.id) }
            : {};
          const row: ResultRow = {
            type: 'product',
            displayItem,
            selectedCount: selection.filter(
              (reference) =>
                'itemId' in reference &&
                reference.displayItemId === displayItem.id,
            ).length,
          };
          return [
            <Table.Row
              key={displayItem.id}
              row={row}
              selection={PRODUCT_SELECTION}
              {...openRow}
              firstCell={{
                expandable: {
                  open,
                  onToggle: () => onToggleExpanded(displayItem.id),
                  disabled: hasSkus ? undefined : NO_SKUS,
                },
              }}
              wrapperProps={{
                id: `centra-display-item-${displayItem.id}-summary`,
              }}
            />,
            ...(open ? skuRows(displayItem) : []),
          ];
        })}
      </Table.Body>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// The bars and the states
// ---------------------------------------------------------------------------

type PickerHeaderProps = {
  query: string;
  onQueryChange: (query: string) => void;
  /** New results load while the last ones show */
  reloading: boolean;
};

/** The text filter of the list (named by the Pane), with its own "✕" */
function PickerHeader({ query, onQueryChange, reloading }: PickerHeaderProps) {
  return (
    <Toolbar fields>
      <Toolbar.FilterInput value={query} onChange={onQueryChange} />
      <Toolbar.Spinner show={reloading} />
    </Toolbar>
  );
}

type PickerFooterProps = {
  /** The number of results, when Centra gives it */
  count: string | null;
  selectedLabel: string;
  page: number;
  pageCount: number;
  disabled: boolean;
  onPageChange: (page: number) => void;
  onApply: () => void;
};

function PickerFooter({
  count,
  selectedLabel,
  page,
  pageCount,
  disabled,
  onPageChange,
  onApply,
}: PickerFooterProps) {
  return (
    <Toolbar>
      <Toolbar.Subtitle>
        {count !== null && `${count} · `}
        <span role="status" aria-live="polite">
          {selectedLabel}
        </span>
      </Toolbar.Subtitle>
      <Toolbar.Space />
      <Toolbar.Pagination
        perPage={SEARCH_PAGE_SIZE}
        currentPage={page - 1}
        totalEntries={pageCount * SEARCH_PAGE_SIZE}
        disabled={disabled}
        onChange={(newPage) => onPageChange(newPage + 1)}
      />
      <Toolbar.Button
        tone="primary"
        label="Apply selection"
        onClick={onApply}
      />
    </Toolbar>
  );
}

type NoResultsProps = {
  nouns: CountNouns;
  pending: boolean;
  /** The last settled search */
  search: SearchState;
  onRetry: () => void;
};

/** The results area with no item: the first load, a failure or no match */
function NoResults({ nouns, pending, search, onRetry }: NoResultsProps) {
  if (pending) {
    return (
      <BlankSlate
        placement="area"
        loading
        title={`Loading the ${nouns.other}`}
      />
    );
  }

  if (search.error !== undefined) {
    return (
      <BlankSlate
        placement="area"
        error
        icon={<CircleExclamationIcon />}
        title="Couldn't load the catalog"
        code={search.error}
        description="Check the connection in the plugin settings, then try again."
        actions={<Button label="Try again" onClick={onRetry} />}
      />
    );
  }

  if (search.query !== '') {
    return <Pane.FilterBlankSlate />;
  }

  return (
    <BlankSlate
      placement="area"
      icon={<BagShoppingIcon />}
      title={`No ${nouns.other} found`}
    />
  );
}

/** The picker can't open: the frame sizes itself to the message */
function SetupProblem({
  ctx,
  title,
  description,
}: {
  ctx: RenderModalCtx;
  title: string;
  description: string;
}) {
  return (
    <Canvas ctx={ctx}>
      <BlankSlate
        placement="inline"
        error
        icon={<CircleExclamationIcon />}
        title={title}
        description={description}
      />
    </Canvas>
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
  const [isChangingPage, setIsChangingPage] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [retryCount, setRetryCount] = useState(0);
  // Until the first search finishes or fails, the results area shows its
  // loading state; after it, a new search keeps the last state on screen
  const [loaded, setLoaded] = useState(false);
  const pageController = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState<SearchState>({
    status: 'loading',
    items: [],
    page: 1,
    query: '',
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
    pageController.current?.abort();
    pageController.current = null;
    setIsChangingPage(false);
    setPageCount(1);
    setQuery(value);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: a retry runs the same search again.
  useEffect(() => {
    if (!fieldParameters || !isConnectionComplete(connection)) return;

    const controller = new AbortController();
    setSearch((current) => ({ ...current, status: 'loading' }));

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
          query: debouncedQuery,
          totalCount: result.totalCount,
        });
        setLoaded(true);
        setPageCount(pageCountForResult(result));

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
        setLoaded(true);
        setPageCount(1);
        setSearch((current) => ({
          ...current,
          status: 'error',
          query: debouncedQuery,
          error: friendlyError(error),
        }));
      });

    return () => {
      controller.abort();
      pageController.current?.abort();
    };
  }, [client, connection, debouncedQuery, fieldParameters, retryCount]);

  useLayoutEffect(() => {
    if (expandedDisplayItemId === null) return;

    scrollToNearestEdge(
      document.getElementById(
        `centra-display-item-${expandedDisplayItemId}-summary`,
      ),
    );
    scrollToNearestEdge(
      document.getElementById(
        `centra-display-item-${expandedDisplayItemId}-items`,
      ),
    );
  }, [expandedDisplayItemId]);

  if (!modalParameters || !fieldParameters) {
    return (
      <SetupProblem
        ctx={ctx}
        title="Couldn't open the picker"
        description="Close it and open the Centra field again."
      />
    );
  }

  if (!isConnectionComplete(connection)) {
    return (
      <SetupProblem
        ctx={ctx}
        title="Centra isn't connected"
        description="Add the Storefront API URL and token in the plugin settings, then open the picker again."
      />
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

  const changePage = async (page: number) => {
    if (
      isChangingPage ||
      page === search.page ||
      page < 1 ||
      page > pageCount
    ) {
      return;
    }
    pageController.current?.abort();
    const controller = new AbortController();
    pageController.current = controller;
    setIsChangingPage(true);
    setSearch((current) => ({
      ...current,
      status: 'loading',
      error: undefined,
    }));
    try {
      const result = await searchCatalog(client, fieldParameters, {
        query: debouncedQuery,
        page,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      setSearch({
        status: 'success',
        items: result.items,
        page: result.page,
        query: debouncedQuery,
        totalCount: result.totalCount,
      });
      setPageCount((current) =>
        result.totalCount === undefined
          ? Math.max(current, pageCountForResult(result))
          : pageCountForResult(result),
      );
      setExpandedDisplayItemId(null);
      scrollParent(resultsRef.current)?.scrollTo({ top: 0 });
    } catch (error) {
      if (controller.signal.aborted) return;
      setSearch((current) => ({
        ...current,
        status: 'error',
        query: debouncedQuery,
        error: friendlyError(error),
      }));
    } finally {
      if (pageController.current === controller) {
        pageController.current = null;
        setIsChangingPage(false);
      }
    }
  };

  const resolveSelection = () => {
    const result: PickerModalResult = {
      references: dedupeReferences(fieldParameters.kind, selection),
    };
    ctx.resolve(result);
  };

  const { kind } = fieldParameters;
  const listed = LISTED[kind];
  const queryIsDebouncing = query.trim() !== debouncedQuery;
  const searchIsPending = queryIsDebouncing || search.status === 'loading';
  const isBusy = searchIsPending || isChangingPage;
  const hasResults = search.items.length > 0;
  const toggleExpanded = (displayItemId: number) => {
    setExpandedDisplayItemId((current) =>
      current === displayItemId ? null : displayItemId,
    );
  };
  const selectionProps: SelectionProps = {
    fieldParameters,
    selection,
    onToggleReference: toggleReference,
  };

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div
        className={styles.root}
        style={{
          height: `calc(100vh - ${verticalBodyPadding(ctx.bodyPadding)}px)`,
        }}
      >
        <Pane
          ariaLabel={listed.label}
          header={
            <PickerHeader
              query={query}
              onQueryChange={updateQuery}
              reloading={isBusy && loaded}
            />
          }
          footer={
            <PickerFooter
              count={
                typeof search.totalCount === 'number'
                  ? countLabel(search.totalCount, listed.nouns, ctx.ui.locale)
                  : null
              }
              selectedLabel={`${countLabel(
                selection.length,
                KIND_NOUNS[kind],
                ctx.ui.locale,
              )} selected`}
              page={search.page}
              pageCount={pageCount}
              disabled={isBusy}
              onPageChange={(page) => void changePage(page)}
              onApply={resolveSelection}
            />
          }
        >
          <ListArea>
            {search.status === 'error' && hasResults && (
              <Callout tone="danger">{search.error}</Callout>
            )}
            {hasResults ? (
              <div
                ref={resultsRef}
                aria-busy={isBusy}
                inert={isBusy || search.status === 'error' ? true : undefined}
              >
                {kind === 'item' ? (
                  <SkuTable
                    {...selectionProps}
                    items={search.items}
                    query={debouncedQuery}
                    expandedDisplayItemId={expandedDisplayItemId}
                    onToggleExpanded={toggleExpanded}
                  />
                ) : (
                  <ProductTable {...selectionProps} items={search.items} />
                )}
              </div>
            ) : (
              <NoResults
                nouns={KIND_NOUNS[kind]}
                pending={!loaded}
                search={search}
                onRetry={() => {
                  setLoaded(false);
                  setRetryCount((count) => count + 1);
                }}
              />
            )}
          </ListArea>
        </Pane>
      </div>
    </Canvas>
  );
}
