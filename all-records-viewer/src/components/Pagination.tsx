import { PER_PAGE_OPTIONS } from '../constants';
import styles from './Pagination.module.css';

export type PaginationProps = {
  perPage: number;
  currentPage: number;
  totalEntries: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
  disabled?: boolean;
  maxPagesToShow?: number;
};

export function getPaginationWindow({
  currentPage,
  totalEntries,
  perPage,
  maxPagesToShow = 10,
}: Pick<
  PaginationProps,
  'currentPage' | 'totalEntries' | 'perPage' | 'maxPagesToShow'
>): number[] {
  const totalPages = Math.max(0, Math.ceil(totalEntries / perPage));
  if (totalPages === 0) {
    return [];
  }

  const length = Math.max(1, maxPagesToShow);
  const current = Math.max(1, Math.min(currentPage + 1, totalPages));
  const halfLength = Math.floor(length / 2);
  let first = Math.max(1, current - halfLength);
  let last = Math.min(totalPages, current + halfLength);

  if (last - first + 1 < length) {
    if (current < totalPages / 2) {
      last = Math.min(totalPages, last + (length - (last - first)));
    } else {
      first = Math.max(1, first - (length - (last - first)));
    }
  }

  if (last - first + 1 > length) {
    if (current > totalPages / 2) {
      first += 1;
    } else {
      last -= 1;
    }
  }

  const size = Math.min(last - first + 1, totalPages);
  return Array.from({ length: size }, (_, index) => first + index - 1);
}

export function Pagination({
  perPage,
  currentPage,
  totalEntries,
  onPageChange,
  onPerPageChange,
  disabled = false,
  maxPagesToShow = 10,
}: PaginationProps) {
  if (!totalEntries || totalEntries <= perPage) return null;

  const pages = getPaginationWindow({
    currentPage,
    totalEntries,
    perPage,
    maxPagesToShow,
  });
  const lastPage = Math.max(0, Math.ceil(totalEntries / perPage) - 1);

  return (
    <footer className={styles.toolbar} aria-label="Records pagination">
      <div className={styles.perPage}>
        Show: {perPage}
        <select
          aria-label="Records per page"
          value={perPage}
          disabled={disabled}
          onChange={(event) => onPerPageChange(Number(event.target.value))}
        >
          {PER_PAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <nav className={styles.pagination} aria-label="Pagination">
        <button
          type="button"
          className={styles.nav}
          disabled={disabled || currentPage <= 0}
          onClick={() => onPageChange(currentPage - 1)}
        >
          « Previous
        </button>
        <div className={styles.links}>
          {pages.map((page) => (
            <button
              type="button"
              key={page}
              aria-current={page === currentPage ? 'page' : undefined}
              className={`${styles.link} ${page === currentPage ? styles.active : ''}`}
              disabled={disabled || page === currentPage}
              onClick={() => onPageChange(page)}
            >
              {page + 1}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${styles.nav} ${styles.next}`}
          disabled={disabled || currentPage >= lastPage}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next »
        </button>
      </nav>
    </footer>
  );
}
