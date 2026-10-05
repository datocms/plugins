import { faAnglesDown } from '@fortawesome/free-solid-svg-icons';
import { Spinner } from 'datocms-react-ui';
import {
  Fragment,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { pluralize } from '../../lib/format';
import type { PickerLabels } from '../../lib/pickerSearch';
import { describeError } from '../../lib/shopifyClient';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import BlankSlate from '../shared/BlankSlate';
import Callout from '../shared/Callout';
import styles from './ResultsPane.module.css';
import { gridItems, RovingContext, useRovingFocus } from './rovingFocus';
import { useGridColumns } from './useGridColumns';
import { useInView } from './useInView';
import { useLoadMoreFocus, useRetryFocus } from './useKeepFocus';
import { CollectionNotVisibleError } from './usePickerData';
import type { PickerView } from './usePickerView';

/** Infinite scroll stops after this many loaded items; "Load more" goes on. */
const AUTO_LOAD_LIMIT = 500;

export function errorMessage(error: unknown): string {
  return error instanceof CollectionNotVisibleError
    ? error.message
    : describeError(error);
}

// ---------------------------------------------------------------------------
// A grid or list of items, with an optional full-width panel under one row
// ---------------------------------------------------------------------------

type ItemCollectionProps<T extends { id: string }> = {
  items: T[];
  view: PickerView;
  label: string;
  /** List view only: column titles. */
  header?: ReactNode;
  renderItem: (item: T) => ReactNode;
  expandedId?: string | null;
  renderPanel?: (item: T) => ReactNode;
};

/** The index after which the panel goes: the end of the expanded item's row. */
function panelIndex(
  expandedIndex: number,
  count: number,
  columns: number,
): number {
  if (expandedIndex < 0) return -1;
  const rowEnd = (Math.floor(expandedIndex / columns) + 1) * columns - 1;
  return Math.min(count - 1, rowEnd);
}

export function ItemCollection<T extends { id: string }>({
  items,
  view,
  label,
  header,
  renderItem,
  expandedId,
  renderPanel,
}: ItemCollectionProps<T>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useGridColumns(gridRef, view === 'grid');
  const expandedIndex = expandedId
    ? items.findIndex((item) => item.id === expandedId)
    : -1;
  const expanded = expandedIndex >= 0 ? items[expandedIndex] : undefined;
  const after = panelIndex(
    expandedIndex,
    items.length,
    view === 'grid' ? columns : 1,
  );

  return (
    <div>
      {view === 'list' && header}
      <div
        ref={gridRef}
        className={view === 'grid' ? styles.grid : styles.list}
        aria-label={label}
        role="group"
        data-roving-grid=""
      >
        {items.map((item, index) => (
          <Fragment key={item.id}>
            {renderItem(item)}
            {index === after && expanded && renderPanel?.(expanded)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.sectionTitle}>
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export type ResultsState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: unknown;
  hasNextPage: boolean;
  loadingMore: boolean;
  loadMoreError: unknown;
  loadMore: () => void;
  retry: () => void;
  /** Items loaded so far (before client-side checks). */
  loadedCount: number;
};

function RetryCallout({
  title,
  error,
  onRetry,
}: {
  title?: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Callout
      tone="danger"
      role="alert"
      title={title}
      actions={
        <Button buttonSize="xxs" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      <p>{errorMessage(error)}</p>
    </Callout>
  );
}

/**
 * The visible "Load more" (infinite scroll stops at `AUTO_LOAD_LIMIT`). It
 * stays enabled while loading, so it keeps focus; a click then does nothing.
 */
function LoadMore({
  state,
  labels,
  areaRef,
  keepFocus,
}: {
  state: ResultsState;
  labels: PickerLabels;
  areaRef: RefObject<HTMLDivElement | null>;
  /** Called before loading, so focus can move to the first new item. */
  keepFocus: () => void;
}) {
  if (state.loadMoreError) {
    return (
      <div ref={areaRef} className={styles.loadMore}>
        <RetryCallout
          error={state.loadMoreError}
          onRetry={() => {
            keepFocus();
            state.retry();
          }}
        />
      </div>
    );
  }
  if (!state.hasNextPage) return null;
  return (
    <div ref={areaRef} className={styles.loadMore}>
      <Button
        buttonSize="s"
        leftIcon={<Icon icon={faAnglesDown} />}
        className={state.loadingMore ? styles.loading : undefined}
        onClick={() => {
          if (state.loadingMore) return;
          keepFocus();
          state.loadMore();
        }}
      >
        Load more {labels.resultMany}
        {state.loadingMore && <Spinner size={20} />}
      </Button>
    </div>
  );
}

function EmptyState({
  labels,
  searching,
  filtersActive,
  onClearFilters,
}: {
  labels: PickerLabels;
  searching: boolean;
  filtersActive: boolean;
  onClearFilters: () => void;
}) {
  return (
    <BlankSlate
      className={styles.empty}
      title={labels.emptyTitle}
      actions={
        filtersActive ? (
          <Button buttonSize="s" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : undefined
      }
    >
      {searching && <p>Check the spelling, or try fewer words.</p>}
      <p>{labels.emptyHint}</p>
    </BlankSlate>
  );
}

export type ResultsPaneProps = {
  labels: PickerLabels;
  state: ResultsState;
  /** True when no loaded item passes the filters. */
  isEmpty: boolean;
  filtersActive: boolean;
  /** True while a search text is applied. */
  searching: boolean;
  onClearFilters: () => void;
  /** Pinned content (SKU matches) and whether it shows anything. */
  pinned?: ReactNode;
  pinnedCount: number;
  /** Title over the main results while something is pinned. */
  mainTitle: string;
  children: ReactNode;
};

type MainResultsProps = ResultsPaneProps & {
  onRetry: () => void;
};

/** The main grid or list, its states, and Load more. */
function MainResults(props: MainResultsProps) {
  const { state, labels, isEmpty, pinnedCount } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const keepFocus = useLoadMoreFocus({
    items: () => gridItems(listRef.current),
    area: areaRef,
    loadingMore: state.loadingMore,
  });
  if (state.status === 'error') {
    return (
      <RetryCallout
        title={`Couldn't load the ${labels.resultMany}`}
        error={state.error}
        onRetry={props.onRetry}
      />
    );
  }
  if (state.status !== 'ready') {
    return (
      <div className={styles.spinnerBox}>
        <Spinner size={40} placement="centered" />
      </div>
    );
  }
  if (isEmpty && !state.hasNextPage) {
    return pinnedCount > 0 ? (
      <p className={styles.inlineEmpty}>No other {labels.resultMany} match</p>
    ) : (
      <EmptyState
        labels={labels}
        searching={props.searching}
        filtersActive={props.filtersActive}
        onClearFilters={props.onClearFilters}
      />
    );
  }
  const body = isEmpty ? (
    <p className={styles.inlineEmpty}>
      None of the {labels.resultMany} loaded so far match
    </p>
  ) : (
    props.children
  );
  return (
    <>
      <div ref={listRef}>
        {pinnedCount > 0 ? (
          <Section title={props.mainTitle}>{body}</Section>
        ) : (
          body
        )}
      </div>
      <LoadMore
        state={state}
        labels={labels}
        areaRef={areaRef}
        keepFocus={keepFocus}
      />
    </>
  );
}

function announcement(props: ResultsPaneProps, visibleCount: number): string {
  const { state, labels } = props;
  if (state.status === 'loading') return `Loading ${labels.resultMany}…`;
  if (state.status !== 'ready') return '';
  if (state.loadingMore) return `Loading more ${labels.resultMany}…`;
  if (visibleCount === 0 && props.pinnedCount === 0) return labels.emptyTitle;
  const count = visibleCount + props.pinnedCount;
  return `${pluralize(count, labels.resultOne, labels.resultMany)} shown`;
}

/** Keeps loading pages while the end of the list is in view. */
function useAutoLoad(
  scrollRef: RefObject<HTMLDivElement | null>,
  sentinelRef: RefObject<HTMLDivElement | null>,
  state: ResultsState,
) {
  const canAutoLoad =
    state.status === 'ready' &&
    state.hasNextPage &&
    !state.loadMoreError &&
    state.loadedCount < AUTO_LOAD_LIMIT;
  const inView = useInView(scrollRef, sentinelRef, { enabled: canAutoLoad });
  const { loadingMore, loadMore } = state;
  useEffect(() => {
    if (inView && canAutoLoad && !loadingMore) loadMore();
  }, [inView, canAutoLoad, loadingMore, loadMore]);
}

/**
 * The scrolling results: pinned SKU matches, the main grid or list, every
 * loading, empty and error state, infinite scroll with a visible "Load more"
 * fallback, and arrow-key navigation across items.
 */
export default function ResultsPane(
  props: ResultsPaneProps & {
    visibleCount: number;
    /** Where focus goes when a retry leaves nothing to focus. */
    onFocusLost: () => void;
  },
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(scrollRef);
  useAutoLoad(scrollRef, sentinelRef, props.state);
  const keepRetryFocus = useRetryFocus({
    root: scrollRef,
    status: props.state.status,
    fallback: props.onFocusLost,
  });
  const { retry } = props.state;
  const onRetry = () => {
    keepRetryFocus();
    retry();
  };
  const rovingValue = useMemo(
    () => ({ activeKey: roving.activeKey }),
    [roving.activeKey],
  );

  return (
    <div
      ref={scrollRef}
      className={styles.results}
      data-picker-scroll=""
      aria-busy={props.state.status === 'loading'}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
    >
      <RovingContext.Provider value={rovingValue}>
        <div className="dl-sr-only" role="status" aria-live="polite">
          {announcement(props, props.visibleCount)}
        </div>
        {props.pinned}
        <MainResults {...props} onRetry={onRetry} />
        <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
      </RovingContext.Provider>
    </div>
  );
}
