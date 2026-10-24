import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Heading from 'datocms-react-ui/Heading';
import ListArea from 'datocms-react-ui/ListArea';
import {
  Fragment,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from 'react';
import {
  BagShoppingIcon,
  CircleExclamationIcon,
  LayerGroupIcon,
  MagnifyingGlassIcon,
} from '../../icons';
import { pluralize } from '../../lib/format';
import type { PickerLabels } from '../../lib/pickerSearch';
import { describeError } from '../../lib/shopifyClient';
import styles from './ResultsPane.module.css';
import { useGridColumns } from './useGridColumns';
import { useInView } from './useInView';
import {
  itemTargets,
  PINNED_ATTRIBUTE,
  useLoadMoreFocus,
  useRetryFocus,
} from './useKeepFocus';
import { CollectionNotVisibleError } from './usePickerData';

/** Infinite scroll stops after this many loaded items; "Load more" goes on. */
const AUTO_LOAD_LIMIT = 500;

export function errorMessage(error: unknown): string {
  return error instanceof CollectionNotVisibleError
    ? error.message
    : describeError(error);
}

// ---------------------------------------------------------------------------
// A grid of cards, with a full-width panel under one row
// ---------------------------------------------------------------------------

type ItemGridProps<T extends { id: string }> = {
  items: T[];
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

export function ItemGrid<T extends { id: string }>({
  items,
  renderItem,
  expandedId,
  renderPanel,
}: ItemGridProps<T>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useGridColumns(gridRef, true);
  const expandedIndex = expandedId
    ? items.findIndex((item) => item.id === expandedId)
    : -1;
  const expanded = expandedIndex >= 0 ? items[expandedIndex] : undefined;
  const after = panelIndex(expandedIndex, items.length, columns);

  return (
    <div ref={gridRef} className={styles.grid}>
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {renderItem(item)}
          {index === after && expanded && renderPanel?.(expanded)}
        </Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** A titled part of the results: the SKU matches, then all the results. */
export function ResultSection({
  title,
  icon,
  pinned = false,
  children,
}: {
  title: string;
  icon?: ReactNode;
  /** The SKU matches: Load more's focus skips their items. */
  pinned?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={id}
      {...(pinned ? { [PINNED_ATTRIBUTE]: '' } : {})}
    >
      <Heading level={2} id={id} className={styles.sectionTitle}>
        {icon}
        {title}
      </Heading>
      {children}
    </div>
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
  /** New results load while the last ones show (the toolbar spins). */
  reloading: boolean;
  loadMore: () => void;
  retry: () => void;
  /** Items loaded so far (before client-side checks). */
  loadedCount: number;
};

/**
 * The visible "Load more" (infinite scroll stops at `AUTO_LOAD_LIMIT`), or
 * the Try again of a page that failed.
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
  // The last results stay while new ones load; their next page doesn't.
  if (state.reloading) return null;
  if (!state.loadMoreError && !state.hasNextPage) return null;
  return (
    <div ref={areaRef} className={styles.loadMore}>
      {state.loadMoreError ? (
        <BlankSlate
          placement="section"
          small
          error
          icon={<CircleExclamationIcon />}
          title={`Couldn't load more ${labels.resultMany}`}
          description={errorMessage(state.loadMoreError)}
          actions={
            <Button
              label="Try again"
              onClick={() => {
                keepFocus();
                state.retry();
              }}
            />
          }
        />
      ) : (
        <Button
          label={`Load more ${labels.resultMany}`}
          busy={state.loadingMore}
          onClick={() => {
            keepFocus();
            state.loadMore();
          }}
        />
      )}
    </div>
  );
}

/**
 * Nothing to show: no match for the search, the filters or the field's
 * limits, or nothing at all (the storefront shows nothing).
 */
function EmptyState({
  labels,
  searching,
  filtersActive,
  scoped,
  onClearFilters,
}: {
  labels: PickerLabels;
  searching: boolean;
  filtersActive: boolean;
  scoped: boolean;
  onClearFilters: () => void;
}) {
  const narrowed = searching || filtersActive || scoped;
  const EntityIcon =
    labels.resultOne === 'collection' ? LayerGroupIcon : BagShoppingIcon;
  return (
    <BlankSlate
      placement="area"
      icon={narrowed ? <MagnifyingGlassIcon /> : <EntityIcon />}
      title={
        narrowed
          ? labels.emptyTitle
          : `No ${labels.resultMany} visible to this storefront`
      }
      description={
        searching
          ? `Check the spelling, or try fewer words. ${labels.emptyHint}`
          : labels.emptyHint
      }
      actions={
        filtersActive ? (
          <Button label="Clear filters" onClick={onClearFilters} />
        ) : undefined
      }
    />
  );
}

export type ResultsPaneProps = {
  labels: PickerLabels;
  /** `ctx.ui.locale`, for the numbers of the announcements. */
  locale: string;
  state: ResultsState;
  /** True when no loaded item passes the filters. */
  isEmpty: boolean;
  filtersActive: boolean;
  /**
   * True when the field's settings limit what the picker offers (its locked
   * scope pills): no results then means no match, not an empty storefront.
   */
  scoped: boolean;
  /** True while a search text is applied. */
  searching: boolean;
  onClearFilters: () => void;
  /** Pinned content (SKU matches) and whether it shows anything. */
  pinned?: ReactNode;
  pinnedCount: number;
  /** Title over the main results while something is pinned. */
  mainTitle: string;
  /**
   * Why the prices and titles are in another language than the one asked
   * for (Shopify fell back), or null. Shown above the results as a warning
   * Callout.
   */
  marketNotice?: string | null;
  /**
   * The filters the browsed collection keeps but can't apply, or null. Shown
   * above the results as a warning Callout, next to their warning pills.
   */
  filtersNotice?: string | null;
  children: ReactNode;
};

type MainResultsProps = ResultsPaneProps & {
  onRetry: () => void;
  retryRef: RefObject<HTMLElement | null>;
  /** The area that holds every result (the ListArea). */
  area: () => HTMLElement | null;
};

/**
 * The main grid or table, its states, and Load more: direct children of the
 * ListArea, which spaces them.
 */
function MainResults(props: MainResultsProps) {
  const { state, labels, isEmpty, pinnedCount, area } = props;
  const areaRef = useRef<HTMLDivElement>(null);
  const keepFocus = useLoadMoreFocus({
    items: () => itemTargets(area(), { skipPinned: true }),
    area: areaRef,
    loadingMore: state.loadingMore,
  });
  // With SKU matches above, the states sit in the section under its title;
  // alone, they fill the area.
  const placement = pinnedCount > 0 ? 'section' : 'area';
  const inSection = (content: ReactNode) =>
    pinnedCount > 0 ? (
      <ResultSection title={props.mainTitle}>{content}</ResultSection>
    ) : (
      content
    );

  if (state.status === 'error') {
    return inSection(
      <BlankSlate
        placement={placement}
        small={pinnedCount > 0}
        error
        icon={<CircleExclamationIcon />}
        title={`Couldn't load the ${labels.resultMany}`}
        description={errorMessage(state.error)}
        actions={
          <Button
            ref={props.retryRef}
            label="Try again"
            onClick={props.onRetry}
          />
        }
      />,
    );
  }
  // While new results load, the last ones stay; but when the new search or
  // filters leave none of them (a collection's products are matched in the
  // browser), "no match" would be wrong until the new first page arrives:
  // the loading state stands in for them.
  if (state.status !== 'ready' || (state.reloading && isEmpty)) {
    return inSection(
      <BlankSlate
        placement={placement}
        small={pinnedCount > 0}
        loading
        title={`Loading the ${labels.resultMany}`}
      />,
    );
  }
  if (isEmpty && !state.hasNextPage) {
    return pinnedCount > 0 ? (
      inSection(
        <BlankSlate
          placement="section"
          small
          icon={<MagnifyingGlassIcon />}
          title={`No other ${labels.resultMany} match`}
        />,
      )
    ) : (
      <EmptyState
        labels={labels}
        searching={props.searching}
        filtersActive={props.filtersActive}
        scoped={props.scoped}
        onClearFilters={props.onClearFilters}
      />
    );
  }
  const body = isEmpty ? (
    <BlankSlate
      placement="section"
      small
      icon={<MagnifyingGlassIcon />}
      title={`None of the ${labels.resultMany} loaded so far match`}
    />
  ) : (
    props.children
  );
  return (
    <>
      {inSection(body)}
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
  if (state.status === 'loading' || state.reloading) {
    return `Loading ${labels.resultMany}…`;
  }
  if (state.status === 'error')
    return `Couldn't load the ${labels.resultMany}.`;
  if (state.status !== 'ready') return '';
  if (state.loadingMore) return `Loading more ${labels.resultMany}…`;
  if (state.loadMoreError) return `Couldn't load more ${labels.resultMany}.`;
  if (visibleCount === 0 && props.pinnedCount === 0) return labels.emptyTitle;
  const count = visibleCount + props.pinnedCount;
  return `${pluralize(count, labels.resultOne, labels.resultMany, props.locale)} shown`;
}

/** Keeps loading pages while the end of the list is in view. */
function useAutoLoad(
  sentinelRef: RefObject<HTMLDivElement | null>,
  state: ResultsState,
) {
  const canAutoLoad =
    state.status === 'ready' &&
    !state.reloading &&
    state.hasNextPage &&
    !state.loadMoreError &&
    state.loadedCount < AUTO_LOAD_LIMIT;
  const inView = useInView(sentinelRef, { enabled: canAutoLoad });
  const { loadingMore, loadMore } = state;
  useEffect(() => {
    if (inView && canAutoLoad && !loadingMore) loadMore();
  }, [inView, canAutoLoad, loadingMore, loadMore]);
}

/**
 * The results, in the Pane's scrolling content: the market notice, the
 * pinned SKU matches, the main grid or table, every loading, empty and error
 * state, and infinite scroll with a visible "Load more" fallback.
 */
export default function ResultsPane(
  props: ResultsPaneProps & {
    visibleCount: number;
    /** Where focus goes when a retry leaves nothing to focus. */
    onFocusLost: () => void;
  },
) {
  const statusRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLElement>(null);
  // The ListArea takes no ref: its first child's parent is the area. The
  // items are found by their markers in it, without a wrapper.
  const area = () => statusRef.current?.parentElement ?? null;
  useAutoLoad(sentinelRef, props.state);
  const keepRetryFocus = useRetryFocus({
    firstItem: () => itemTargets(area())[0] ?? null,
    retryButton: retryRef,
    status: props.state.status,
    fallback: props.onFocusLost,
  });
  const { retry } = props.state;
  const onRetry = () => {
    keepRetryFocus();
    retry();
  };

  return (
    <ListArea>
      <div
        ref={statusRef}
        className="visually-hidden"
        role="status"
        aria-live="polite"
      >
        {announcement(props, props.visibleCount)}
      </div>
      {props.marketNotice && (
        <Callout tone="warning">{props.marketNotice}</Callout>
      )}
      {props.filtersNotice && (
        <Callout tone="warning">{props.filtersNotice}</Callout>
      )}
      {props.pinned}
      <MainResults
        {...props}
        onRetry={onRetry}
        retryRef={retryRef}
        area={area}
      />
      <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
    </ListArea>
  );
}
