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
  /**
   * The key changed and its first page loads, while the previous key's
   * results still show (`keepPrevious`). Loading more waits for the page.
   */
  reloading: boolean;
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
    reloading: false,
  };
}

/**
 * The state while a new key's first page loads: the last results stay, so a
 * new search, filter, sort or market doesn't empty the list. Only results
 * that loaded can stay; anything else starts over.
 */
function nextState<T, M>(
  previous: State<T, M>,
  key: string | null,
  keepPrevious: boolean,
): State<T, M> {
  if (!keepPrevious || key === null || previous.status !== 'ready') {
    return initialState(key);
  }
  return {
    ...previous,
    key,
    loadingMore: false,
    loadMoreError: null,
    reloading: true,
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
 * With `keepPrevious`, loaded results stay (`reloading`) until the new key's
 * first page replaces them.
 */
export function usePagedQuery<T extends { id: string }, M = never>(
  key: string | null,
  fetchPage: FetchPage<T, M>,
  { keepPrevious = false }: { keepPrevious?: boolean } = {},
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
    setState((previous) => nextState(previous, key, keepPrevious));
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
  }, [key, attempt, keepPrevious]);

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (
      current.status !== 'ready' ||
      current.reloading ||
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

  // A render with a new key shows its state right away, before the effect
  // sets it: the loading state, or the last results while they reload.
  const visible =
    state.key === key ? state : nextState(state, key, keepPrevious);
  return {
    items: visible.items,
    meta: visible.meta,
    hasNextPage: visible.hasNextPage,
    endCursor: visible.endCursor,
    status: visible.status,
    error: visible.error,
    loadingMore: visible.loadingMore,
    loadMoreError: visible.loadMoreError,
    reloading: visible.reloading,
    loadMore,
    retry,
  };
}
