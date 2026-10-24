import { Dropdown } from 'datocms-react-ui/Dropdown';
import {
  type ReactNode,
  type UIEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  getOffsetInPanel,
  getPanelViewport,
  MentionMenuItem,
  MentionPanel,
  type MentionPanelPosition,
  scrollIntoPanel,
} from './MentionPanel';

/** What an option of the list shows, and what its pick does */
export type MentionItemContent = {
  label: ReactNode;
  icon?: ReactNode;
  after?: ReactNode;
  onPick: () => void;
};

type MentionDropdownBaseProps<T> = {
  items: T[];
  emptyMessage: string;
  /** The title of the group of options */
  headerText: string;
  /** The keyboard highlight, owned by the caller */
  selectedIndex: number;
  onClose: () => void;
  renderItem: (item: T, index: number) => MentionItemContent;
  keyExtractor: (item: T) => string;
  /** Moves the highlight to the option below the pointer */
  onHighlight?: (index: number) => void;
  position?: MentionPanelPosition;
  /** Content above the options, for example a search field */
  searchSlot?: ReactNode;
  /**
   * A state in place of the options while they cannot show: the first load,
   * or a load that failed. Without it, an empty list shows emptyMessage.
   */
  state?: ReactNode;
};

// Long lists (a project with hundreds of collaborators or models) render only
// the rows near the scroll position.
const WINDOW_THRESHOLD = 200;
const WINDOW_SIZE = 40;
const WINDOW_OVERSCAN = 5;
const DEFAULT_ROW_HEIGHT = 32;

/**
 * The highlighted row of a windowed list may be out of the rendered window:
 * place it from its offset in the list and the row height.
 */
function scrollWindowedRowIntoPanel(
  panel: HTMLElement,
  listTop: number,
  rowOffset: number,
  rowHeight: number,
) {
  const viewport = getPanelViewport(panel);
  const rowTop = listTop + rowOffset;
  if (rowTop < viewport.top) {
    panel.scrollTop -= viewport.top - rowTop;
  } else if (rowTop + rowHeight > viewport.bottom) {
    panel.scrollTop += rowTop + rowHeight - viewport.bottom;
  }
}

// The editor keeps the focus and drives the highlight: the list only shows it
// and scrolls it into view.
export function MentionDropdownBase<T>({
  items,
  emptyMessage,
  headerText,
  selectedIndex,
  onClose,
  renderItem,
  keyExtractor,
  onHighlight,
  position = 'below',
  searchSlot,
  state,
}: MentionDropdownBaseProps<T>): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const windowed = items.length > WINDOW_THRESHOLD;
  const firstIndex = windowed
    ? Math.min(
        Math.max(0, items.length - WINDOW_SIZE),
        Math.max(0, Math.floor(scrollOffset / rowHeight) - WINDOW_OVERSCAN),
      )
    : 0;
  const lastIndex = windowed
    ? Math.min(items.length, firstIndex + WINDOW_SIZE)
    : items.length;

  // The scroll of the panel inside the list: the search field and the group
  // title come before the first row.
  const readListOffset = useCallback(() => {
    const panel = panelRef.current;
    const list = listRef.current;
    if (!panel || !list) return null;
    const listTop = getOffsetInPanel(panel, list);
    return { panel, listTop };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-measure rows when the rendered window or query changes.
  useLayoutEffect(() => {
    if (!windowed) return;
    const list = listRef.current;
    if (!list) return;
    let measuredHeight = 0;
    for (const row of list.querySelectorAll('[data-mention-row]')) {
      measuredHeight = Math.max(
        measuredHeight,
        row.getBoundingClientRect().height,
      );
    }
    // A fraction of a pixel (a font that loads, a zoom) is no new height: a
    // new one places the highlight again, and would undo a scroll of the wheel
    if (measuredHeight > 0 && Math.abs(measuredHeight - rowHeight) >= 1) {
      setRowHeight(measuredHeight);
    }
  }, [firstIndex, items, rowHeight, windowed]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A new result list must restore the selected row even when its index is unchanged.
  useLayoutEffect(() => {
    const offset = readListOffset();
    if (!offset) return;
    const { panel, listTop } = offset;

    // The first row brings back the top of the panel: the search field of the
    // models scrolls with the options, and a new search starts from it.
    if (selectedIndex <= 0) {
      panel.scrollTop = 0;
      if (windowed) setScrollOffset(0);
      return;
    }

    if (!windowed) {
      if (highlightRef.current) {
        scrollIntoPanel(panel, highlightRef.current);
      }
      return;
    }

    scrollWindowedRowIntoPanel(
      panel,
      listTop,
      selectedIndex * rowHeight,
      rowHeight,
    );
    setScrollOffset(Math.max(0, panel.scrollTop - listTop));
  }, [items, rowHeight, selectedIndex, windowed]);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const offset = readListOffset();
      const listTop = offset?.listTop ?? 0;
      setScrollOffset(Math.max(0, event.currentTarget.scrollTop - listTop));
    },
    [readListOffset],
  );

  const options =
    items.length === 0 ? (
      <Dropdown.MenuEmpty>{emptyMessage}</Dropdown.MenuEmpty>
    ) : (
      <div ref={listRef}>
        {windowed && firstIndex > 0 && (
          <div aria-hidden="true" style={{ height: firstIndex * rowHeight }} />
        )}
        {items.slice(firstIndex, lastIndex).map((item, offset) => {
          const index = firstIndex + offset;
          const content = renderItem(item, index);
          return (
            <MentionMenuItem
              key={keyExtractor(item)}
              row={index}
              selected={index === selectedIndex}
              highlightRef={highlightRef}
              icon={content.icon}
              after={content.after}
              onPick={content.onPick}
              onHighlight={onHighlight ? () => onHighlight(index) : undefined}
            >
              {content.label}
            </MentionMenuItem>
          );
        })}
        {windowed && lastIndex < items.length && (
          <div
            aria-hidden="true"
            style={{ height: (items.length - lastIndex) * rowHeight }}
          />
        )}
      </div>
    );

  return (
    <MentionPanel
      position={position}
      onClose={onClose}
      panelRef={panelRef}
      onScroll={windowed ? handleScroll : undefined}
    >
      {searchSlot}
      <Dropdown.MenuGroup title={headerText}>
        {state ?? options}
      </Dropdown.MenuGroup>
    </MentionPanel>
  );
}
