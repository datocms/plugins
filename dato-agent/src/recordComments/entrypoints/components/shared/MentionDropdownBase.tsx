import { useClickOutside, useScrollSelectedIntoView } from '@hooks/useDropdown';
import styles from '@styles/comment.module.css';
import { type ReactNode, useRef } from 'react';
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
  statusMessage?: ReactNode;
  statusAction?: ReactNode;
  emptyAction?: ReactNode;
  headerLeading?: ReactNode;
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
  statusMessage,
  statusAction,
  emptyAction,
  headerLeading,
}: MentionDropdownBaseProps<T>): ReactNode {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useScrollSelectedIntoView(selectedRef, selectedIndex);
  useClickOutside(dropdownRef, onClose);

  const dropdownClassName = cn(
    styles.mentionDropdown,
    position === 'above' && styles.mentionDropdownAbove,
  );

  return (
    <div ref={dropdownRef} className={dropdownClassName}>
      <div className={styles.mentionHeader}>
        {headerLeading}
        <span className={styles.mentionHeaderLabel}>{headerText}</span>
      </div>
      {searchSlot}
      {(statusMessage || statusAction) && items.length > 0 && (
        <div aria-live="polite" className={styles.mentionStatus} role="status">
          <span>{statusMessage}</span>
          {statusAction}
        </div>
      )}
      {items.length === 0 ? (
        <div aria-live="polite" className={styles.mentionEmpty} role="status">
          <span>{emptyMessage}</span>
          {emptyAction}
        </div>
      ) : (
        <div aria-label={headerText} className={styles.mentionList} role="menu">
          {items.map((item, index) => (
            <div key={keyExtractor(item)} role="none">
              {renderItem(item, index, index === selectedIndex, selectedRef)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
