import { Toolbar, ToolbarStack } from 'datocms-react-ui';
import { paginationWindow } from '../report/view';

export const PER_PAGE_OPTIONS = [25, 50, 100, 200] as const;
export type PerPage = (typeof PER_PAGE_OPTIONS)[number];

function isPerPage(value: number): value is PerPage {
  return (PER_PAGE_OPTIONS as readonly number[]).includes(value);
}

export type PageWindow = 3 | 5 | 10;

/**
 * How many page numbers fit the main pane, which the Info sidebar narrows; a
 * 3-page window also drops "Show:". Until the pane is measured, the frame decides.
 */
export function pageWindowFor(
  paneWidth: number | undefined,
  narrowFrame: boolean,
): PageWindow {
  if (paneWidth === undefined) return narrowFrame ? 3 : 10;
  if (paneWidth < 600) return 3;
  return paneWidth < 800 ? 5 : 10;
}

type PaginationBarProps = {
  page: number;
  pageCount: number;
  perPage: PerPage;
  pageWindow: PageWindow;
  onPage: (page: number) => void;
  onPerPage: (perPage: PerPage) => void;
};

/** The main pane's footer toolbar; render it only when there's more than one page. */
export function PaginationBar({
  page,
  pageCount,
  perPage,
  pageWindow,
  onPage,
  onPerPage,
}: PaginationBarProps) {
  const compact = pageWindow === 3;
  return (
    <Toolbar style={{ flex: 'none', minHeight: 60 }}>
      <ToolbarStack
        stackSize="s"
        style={{ gap: 'var(--spacing-m)', minWidth: 0 }}
      >
        <nav className="dl-pagination" aria-label="Pages">
          {!compact && (
            <label className="dl-per-page">
              Show: {perPage}
              <select
                aria-label="URLs per page"
                value={perPage}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (isPerPage(next)) onPerPage(next);
                }}
              >
                {PER_PAGE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="dl-pagination__nav"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            « Previous
          </button>
          <span className="dl-pagination__pages">
            {paginationWindow(page, pageCount, pageWindow).map((n) =>
              n === page ? (
                <span
                  key={n}
                  className="dl-pagination__page"
                  aria-current="page"
                >
                  {n}
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  className="dl-pagination__page"
                  aria-label={`Page ${n}`}
                  onClick={() => onPage(n)}
                >
                  {n}
                </button>
              ),
            )}
          </span>
          <button
            type="button"
            className="dl-pagination__nav"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          >
            Next »
          </button>
        </nav>
        <div style={{ flex: 1 }} />
      </ToolbarStack>
    </Toolbar>
  );
}
