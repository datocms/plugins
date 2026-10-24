import Toolbar from 'datocms-react-ui/Toolbar';
import { useCallback, useContext, useEffect, useState } from 'react';
import { SelectedEntityContext } from './SelectedEntityContext';

const paginationThreshold = 200;
const pageSize = 100;

export function getEntryPage<T>(entries: readonly T[], requestedPage: number) {
  const paginated = entries.length > paginationThreshold;
  const pageCount = paginated ? Math.ceil(entries.length / pageSize) : 1;
  const page = Number.isFinite(requestedPage)
    ? Math.max(0, Math.min(Math.floor(requestedPage), pageCount - 1))
    : 0;
  const start = paginated ? page * pageSize : 0;
  return {
    entries: paginated ? entries.slice(start, start + pageSize) : entries,
    page,
    pageCount,
    start,
    paginated,
  };
}

export type EntryPagination<T> = ReturnType<typeof getEntryPage<T>> & {
  /** The number of entries in all the pages */
  totalEntries: number;
  /** Shows another page (the first page is 0) */
  changePage: (page: number) => void;
};

/**
 * Bounds the mounted entries of a long list (past 200 entries, 100 per page);
 * form-level validation still covers the entire import.
 *
 * With `getEntityId`, the entry of the entity focused in SelectedEntityContext
 * forces its page, and a change of page releases the focus.
 */
export function usePaginatedEntries<T>(
  entries: readonly T[],
  getEntityId?: (entry: T) => string,
): EntryPagination<T> {
  const [requestedPage, setRequestedPage] = useState(0);
  const selection = useContext(SelectedEntityContext);
  const selectedIndex =
    selection.entity && getEntityId
      ? entries.findIndex(
          (entry) => getEntityId(entry) === selection.entity?.id,
        )
      : -1;
  const focusedPage =
    selectedIndex >= 0 ? Math.floor(selectedIndex / pageSize) : undefined;

  // Stay on the page of the focused entry once the focus goes away, thus the
  // list does not jump when the user closes the item.
  useEffect(() => {
    if (focusedPage !== undefined) setRequestedPage(focusedPage);
  }, [focusedPage]);

  const result = getEntryPage(entries, focusedPage ?? requestedPage);

  const releaseFocus = Boolean(getEntityId);
  const { set: setSelectedEntity } = selection;
  const changePage = useCallback(
    (page: number) => {
      // An explicitly selected graph node takes precedence over the current page.
      // Release that selection when the user navigates to another page.
      if (releaseFocus) setSelectedEntity(undefined);
      setRequestedPage(page);
    },
    [releaseFocus, setSelectedEntity],
  );

  return { ...result, totalEntries: entries.length, changePage };
}

/**
 * The pages of a paginated list, under the list. It shows only when the list
 * has more than one page.
 */
export function EntriesPagination({
  pagination,
  ariaLabel,
}: {
  pagination: EntryPagination<unknown>;
  /** What the pages are of, for example "Models" */
  ariaLabel: string;
}) {
  if (!pagination.paginated) {
    return null;
  }

  return (
    <Toolbar style="short">
      <Toolbar.Pagination
        compact
        ariaLabel={ariaLabel}
        perPage={pageSize}
        totalEntries={pagination.totalEntries}
        currentPage={pagination.page}
        onChange={pagination.changePage}
      />
    </Toolbar>
  );
}
