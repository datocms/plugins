import { useClickOutside, useScrollSelectedIntoView } from '@hooks/useDropdown';
import styles from '@styles/comment.module.css';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';

type MentionDropdownBaseProps<T> = {
  items: T[];
  emptyMessage: string;
  headerText: string;
  selectedIndex: number;
  onClose: () => void;
  renderItem: (
    item: T,
    index: number,
    isSelected: boolean,
    selectedRef: React.RefObject<HTMLButtonElement | null>,
  ) => ReactNode;
  keyExtractor: (item: T) => string;
  position?: 'above' | 'below';
  searchSlot?: ReactNode;
};

// Focus managed by TipTap; selectedRef used for scroll-into-view only
export function MentionDropdownBase<T>({
  items,
  emptyMessage,
  headerText,
  selectedIndex,
  onClose,
  renderItem,
  keyExtractor,
  position = 'below',
  searchSlot,
}: MentionDropdownBaseProps<T>): ReactNode {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [rowHeight, setRowHeight] = useState(40);
  const windowed = items.length > 200;
  const windowSize = 40;
  const firstIndex = windowed
    ? Math.min(
        Math.max(0, items.length - windowSize),
        Math.max(0, Math.floor(scrollOffset / rowHeight) - 5),
      )
    : 0;
  const lastIndex = windowed
    ? Math.min(items.length, firstIndex + windowSize)
    : items.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-measure rows when the rendered window or query changes.
  useLayoutEffect(() => {
    if (!windowed) return;
    const list = listRef.current;
    if (!list) return;
    let measuredHeight = 0;
    for (const row of list.querySelectorAll('[data-mention-row]')) {
      measuredHeight = Math.max(
        measuredHeight,
        row.firstElementChild?.getBoundingClientRect().height ?? 0,
      );
    }
    if (measuredHeight > 0 && measuredHeight !== rowHeight) {
      setRowHeight(measuredHeight);
    }
  }, [firstIndex, items, rowHeight, windowed]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A new result list must restore the selected row even when its index is unchanged.
  useLayoutEffect(() => {
    if (!windowed || !listRef.current) return;
    const list = listRef.current;
    const viewportHeight = list.clientHeight || 280;
    const selectedOffset = Math.max(0, selectedIndex) * rowHeight;
    let nextOffset = list.scrollTop;
    if (selectedOffset < nextOffset) {
      nextOffset = selectedOffset;
    } else if (selectedOffset + rowHeight > nextOffset + viewportHeight) {
      nextOffset = selectedOffset + rowHeight - viewportHeight;
    }
    list.scrollTop = nextOffset;
    setScrollOffset(nextOffset);
  }, [items, rowHeight, selectedIndex, windowed]);

  useScrollSelectedIntoView(selectedRef, selectedIndex);
  useClickOutside(dropdownRef, onClose);

  const dropdownClassName = cn(
    styles.mentionDropdown,
    position === 'above' && styles.mentionDropdownAbove,
  );

  if (items.length === 0 && !searchSlot) {
    return (
      <div ref={dropdownRef} className={dropdownClassName}>
        <div className={styles.mentionEmpty}>{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={dropdownClassName}>
      <div className={styles.mentionHeader}>{headerText}</div>
      {searchSlot}
      {items.length === 0 ? (
        <div className={styles.mentionEmpty}>{emptyMessage}</div>
      ) : (
        <div
          ref={listRef}
          className={styles.mentionList}
          onScroll={
            windowed
              ? (event) => setScrollOffset(event.currentTarget.scrollTop)
              : undefined
          }
        >
          {windowed && firstIndex > 0 && (
            <div
              aria-hidden="true"
              style={{ height: firstIndex * rowHeight }}
            />
          )}
          {items.slice(firstIndex, lastIndex).map((item, offset) => {
            const index = firstIndex + offset;
            return (
              <div
                key={keyExtractor(item)}
                data-mention-row={index}
                style={windowed ? { height: rowHeight } : undefined}
              >
                {renderItem(
                  item,
                  index,
                  index === selectedIndex,
                  index === selectedIndex ? selectedRef : { current: null },
                )}
              </div>
            );
          })}
          {windowed && lastIndex < items.length && (
            <div
              aria-hidden="true"
              style={{ height: (items.length - lastIndex) * rowHeight }}
            />
          )}
        </div>
      )}
    </div>
  );
}
