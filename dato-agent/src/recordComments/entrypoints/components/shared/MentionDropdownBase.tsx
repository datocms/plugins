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
        <div className={styles.mentionList}>
          {items.map((item, index) => (
            <div key={keyExtractor(item)}>
              {renderItem(
                item,
                index,
                index === selectedIndex,
                index === selectedIndex ? selectedRef : { current: null },
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
