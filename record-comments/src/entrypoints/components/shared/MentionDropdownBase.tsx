import { useRef, useEffect, type ReactNode } from 'react';
import { useScrollSelectedIntoView, useClickOutside } from '@hooks/useDropdown';
import { cn } from '@/utils/cn';
import styles from '@styles/comment.module.css';

type MentionDropdownBaseProps<T> = {
  items: T[];
  emptyMessage: string;
  headerText: string;
  selectedIndex: number;
  onClose: () => void;
  renderItem: (item: T, index: number, isSelected: boolean, selectedRef: React.RefObject<HTMLButtonElement>) => ReactNode;
  keyExtractor: (item: T) => string;
  position?: 'above' | 'below';
  /** Optional slot for search/filter input */
  searchSlot?: ReactNode;
};

/**
 * Generic base component for mention dropdowns
 * Provides consistent structure, keyboard navigation, and styling
 *
 * ACCESSIBILITY: This component manages focus for keyboard navigation.
 * When selectedIndex changes (via arrow keys), focus moves to the highlighted item.
 * This ensures screen reader users hear which item is selected as they navigate.
 */
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

  // ACCESSIBILITY: Move focus to the selected item when keyboard navigating.
  // This ensures screen readers announce the currently highlighted option.
  useEffect(() => {
    if (selectedIndex >= 0 && selectedRef.current) {
      selectedRef.current.focus();
    }
  }, [selectedIndex]);

  const dropdownClassName = cn(
    styles.mentionDropdown,
    position === 'above' && styles.mentionDropdownAbove
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
                index === selectedIndex ? selectedRef : { current: null }
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MentionDropdownBase;
