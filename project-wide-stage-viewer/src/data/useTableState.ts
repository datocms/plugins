import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PER_PAGE } from '../constants';
import {
  DEFAULT_ORDER_BY,
  filterRows,
  pageCount,
  type RecordRow,
  sortRows,
} from '../lib/records';
import type { ColumnId, OrderBy, PublicationStatus } from '../types';

const SORTABLE_COLUMNS: readonly ColumnId[] = [
  '_preview',
  '_model',
  '_status',
  '_updated_at',
  '_created_at',
  'id',
];

type SelectionView = {
  ids: ReadonlySet<string>;
  showing: boolean;
  /** Leaves "Show selection", as any search, filter, or sort change does. */
  hide: () => void;
};

/**
 * Search, model and status filters, sort, and pagination over rows that are
 * all in memory, as the all-records-viewer does on the server. Every filter or
 * sort change starts again from the first page and leaves "Show selection".
 * The selection view pages on its own, so leaving it restores the list page.
 */
export function useTableState(
  rows: readonly RecordRow[],
  modelIds: readonly string[],
  selection: SelectionView,
) {
  const [query, setQuery] = useState('');
  const [modelId, setModelId] = useState<string | null>(null);
  const [status, setStatus] = useState<PublicationStatus | null>(null);
  const [orderBy, setOrderBy] = useState<OrderBy | null>(null);
  const [listPage, setListPage] = useState(0);
  const [selectionPage, setSelectionPage] = useState(0);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const bodyRef = useRef<HTMLElement>(null);

  // A model filter that no longer applies (the model left the workflow) is dropped.
  const activeModelId = modelId && modelIds.includes(modelId) ? modelId : null;
  // A filtered column is constant, so it can't be sorted. The selection view
  // follows the same rule: a sort there returns to the filtered list.
  const constantColumns = [
    ...(status ? (['_status'] as const) : []),
    ...(activeModelId ? (['_model'] as const) : []),
  ];
  const effectiveOrder =
    orderBy &&
    !constantColumns.some((column) => orderBy.startsWith(`${column}_`))
      ? orderBy
      : DEFAULT_ORDER_BY;

  const matchingRows = useMemo(
    () =>
      sortRows(
        filterRows(rows, { query, modelId: activeModelId, status }),
        effectiveOrder,
      ),
    [rows, query, activeModelId, status, effectiveOrder],
  );
  const selectedRows = useMemo(
    () =>
      selection.showing
        ? sortRows(
            rows.filter((row) => selection.ids.has(row.id)),
            effectiveOrder,
          )
        : [],
    [rows, selection.ids, selection.showing, effectiveOrder],
  );
  const displayedRows = selection.showing ? selectedRows : matchingRows;

  const page = selection.showing ? selectionPage : listPage;
  const setPage = selection.showing ? setSelectionPage : setListPage;
  const pages = pageCount(displayedRows.length, perPage);
  const currentPage = Math.min(page, pages - 1);

  // Keep the stored page in range once rows shrink, so it can't jump back
  // when they grow again.
  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage, setPage]);

  const pageRows = displayedRows.slice(
    currentPage * perPage,
    (currentPage + 1) * perPage,
  );

  const goToPage = (next: number) => {
    setPage(next);
    bodyRef.current?.scrollTo({ top: 0 });
  };

  function resetting<T>(setter: (value: T) => void, current: T) {
    return (value: T) => {
      // Picking the option that's already active changes nothing.
      if (Object.is(value, current)) return;
      setter(value);
      selection.hide();
      setListPage(0);
      setSelectionPage(0);
      bodyRef.current?.scrollTo({ top: 0 });
    };
  }

  return {
    bodyRef,
    query,
    modelId: activeModelId,
    status,
    orderBy: effectiveOrder,
    perPage,
    page: currentPage,
    matchingRows,
    displayedRows,
    pageRows,
    filtering: query.trim() !== '' || activeModelId !== null || status !== null,
    goToPage,
    /** Starts the selection view on its first page; the list page is kept. */
    resetSelectionPage: () => setSelectionPage(0),
    /** The columns that can be sorted right now; undefined when all can. */
    sortableColumnIds:
      constantColumns.length > 0
        ? new Set(
            SORTABLE_COLUMNS.filter(
              (column) =>
                !(constantColumns as readonly string[]).includes(column),
            ),
          )
        : undefined,
    setQuery: resetting(setQuery, query),
    setModelId: resetting((value: string | null) => {
      setModelId(value);
      // Filtering by model makes a Model sort meaningless: drop it.
      if (value)
        setOrderBy((order) => (order?.startsWith('_model_') ? null : order));
    }, modelId),
    setStatus: resetting((value: PublicationStatus | null) => {
      setStatus(value);
      // Filtering by status makes a Status sort meaningless: drop it.
      if (value)
        setOrderBy((order) => (order?.startsWith('_status_') ? null : order));
    }, status),
    setOrderBy: resetting(setOrderBy, orderBy),
    setPerPage: resetting(setPerPage, perPage),
  };
}

export type TableState = ReturnType<typeof useTableState>;
