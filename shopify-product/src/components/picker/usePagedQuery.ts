import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError } from '../../lib/shopifyClient';
import type { Page } from '../../types';

export type FetchPage<T, M> = (
  after: string | null,
  signal: AbortSignal,
) => Promise<{ page: Page<T>; meta?: M }>;

type State<T, M> = {
  key: string | null;
  items: T[];
  meta: M | null;
  hasNextPage: boolean;
  endCursor: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: unknown;
  loadingMore: boolean;
  loadMoreError: unknown;
};

export type PagedQuery<T, M> = Omit<State<T, M>, 'key'> & {
  loadMore: () => void;
  /** Retries the first page, or the page that failed to load. */
  retry: () => void;
};

function initialState<T, M>(key: string | null): State<T, M> {
  return {
    key,
    items: [],
    meta: null,
    hasNextPage: false,
    endCursor: null,
    status: key === null ? 'idle' : 'loading',
    error: null,
    loadingMore: false,
    loadMoreError: null,
  };
}

function appendUnique<T extends { id: string }>(current: T[], next: T[]): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !seen.has(item.id))];
}

/**
 * Cursor pagination for one query. `key` identifies the query (every input
 * that changes the results); a new key aborts the previous requests and
 * starts over, `null` disables it. Aborted requests never surface as errors.
 */
export function usePagedQuery<T extends { id: string }, M = never>(
  key: string | null,
  fetchPage: FetchPage<T, M>,
): PagedQuery<T, M> {
  const [state, setState] = useState<State<T, M>>(() => initialState(key));
  const [attempt, setAttempt] = useState(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const moreController = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the first page on retry.
  useEffect(() => {
    moreController.current?.abort();
    setState(initialState(key));
    if (key === null) return undefined;
    const controller = new AbortController();
    fetchRef
      .current(null, controller.signal)
      .then(({ page, meta }) => {
        if (controller.signal.aborted) return;
        setState({
          ...initialState<T, M>(key),
          status: 'ready',
          items: page.nodes,
          meta: meta ?? null,
          hasNextPage: page.pageInfo.hasNextPage,
          endCursor: page.pageInfo.endCursor,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ ...initialState<T, M>(key), status: 'error', error });
      });
    return () => {
      controller.abort();
      moreController.current?.abort();
    };
  }, [key, attempt]);

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (
      current.status !== 'ready' ||
      current.loadingMore ||
      !current.hasNextPage
    ) {
      return;
    }
    const controller = new AbortController();
    moreController.current = controller;
    const requestKey = current.key;
    setState((previous) => ({
      ...previous,
      loadingMore: true,
      loadMoreError: null,
    }));
    fetchRef
      .current(current.endCursor, controller.signal)
      .then(({ page }) => {
        if (controller.signal.aborted) return;
        setState((previous) =>
          previous.key !== requestKey
            ? previous
            : {
                ...previous,
                items: appendUnique(previous.items, page.nodes),
                hasNextPage: page.pageInfo.hasNextPage,
                endCursor: page.pageInfo.endCursor,
                loadingMore: false,
              },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState((previous) =>
          previous.key !== requestKey
            ? previous
            : { ...previous, loadingMore: false, loadMoreError: error },
        );
      });
  }, []);

  const retry = useCallback(() => {
    if (stateRef.current.status === 'error') {
      setAttempt((value) => value + 1);
    } else if (stateRef.current.loadMoreError) {
      loadMore();
    }
  }, [loadMore]);

  // A render with a new key shows the loading state right away, before the
  // effect resets the state, so stale results never flash under new filters.
  const visible = state.key === key ? state : initialState<T, M>(key);
  return {
    items: visible.items,
    meta: visible.meta,
    hasNextPage: visible.hasNextPage,
    endCursor: visible.endCursor,
    status: visible.status,
    error: visible.error,
    loadingMore: visible.loadingMore,
    loadMoreError: visible.loadMoreError,
    loadMore,
    retry,
  };
}
