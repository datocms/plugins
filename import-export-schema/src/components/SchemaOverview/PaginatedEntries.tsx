import { Button } from 'datocms-react-ui';
import { type ReactNode, useContext, useState } from 'react';
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

/** Bound mounted fields; form-level validation still covers the entire import. */
export function PaginatedEntries<T>({
  entries,
  children,
  getEntityId,
}: {
  entries: readonly T[];
  children: (entry: T) => ReactNode;
  getEntityId?: (entry: T) => string;
}) {
  const [requestedPage, setRequestedPage] = useState(0);
  const selection = useContext(SelectedEntityContext);
  const selectedIndex =
    selection.entity && getEntityId
      ? entries.findIndex(
          (entry) => getEntityId(entry) === selection.entity?.id,
        )
      : -1;
  const result = getEntryPage(
    entries,
    selectedIndex >= 0 ? Math.floor(selectedIndex / pageSize) : requestedPage,
  );
  function changePage(page: number) {
    // An explicitly selected graph node takes precedence over the current page.
    // Release that selection when the user navigates to another page.
    if (getEntityId) selection.set(undefined);
    setRequestedPage(page);
  }

  return (
    <>
      {result.entries.map(children)}
      {result.paginated && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            margin: '12px 0',
          }}
        >
          <Button
            type="button"
            buttonType="muted"
            buttonSize="s"
            disabled={result.page === 0}
            onClick={() => changePage(result.page - 1)}
          >
            Previous
          </Button>
          <span aria-live="polite">
            {result.start + 1}–{result.start + result.entries.length} of{' '}
            {entries.length}
          </span>
          <Button
            type="button"
            buttonType="muted"
            buttonSize="s"
            disabled={result.page + 1 === result.pageCount}
            onClick={() => changePage(result.page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}
