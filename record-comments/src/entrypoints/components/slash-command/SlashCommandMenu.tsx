import { memo, useRef, useEffect } from 'react';
import type { SlashCommandDefinition } from '@ctypes/slashCommands';
import { cn } from '@/utils/cn';
import styles from '@styles/comment.module.css';

type SlashCommandMenuProps = {
  commands: SlashCommandDefinition[];
  selectedIndex: number;
  onSelect: (command: SlashCommandDefinition) => void;
  onClose: () => void;
  position?: 'above' | 'below';
};

export const SlashCommandMenu = memo(function SlashCommandMenu({
  commands,
  selectedIndex,
  onSelect,
  onClose,
  position = 'below',
}: SlashCommandMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current && listRef.current) {
      const container = listRef.current;
      const selected = selectedRef.current;
      const containerRect = container.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();

      if (selectedRect.top < containerRect.top) {
        selected.scrollIntoView({ block: 'nearest' });
      } else if (selectedRect.bottom > containerRect.bottom) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const dropdownClassName = cn(
    styles.mentionDropdown,
    styles.slashCommandMenu,
    position === 'above' && styles.mentionDropdownAbove
  );

  if (commands.length === 0) {
    return (
      <div className={dropdownClassName}>
        <div className={styles.mentionHeader}>Commands</div>
        <div className={styles.mentionEmpty}>No matching commands</div>
      </div>
    );
  }

  return (
    <div className={dropdownClassName}>
      <div className={styles.mentionHeader}>Commands</div>
      <div className={styles.mentionList} ref={listRef}>
        {commands.map((command, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={command.name}
              ref={isSelected ? selectedRef : null}
              type="button"
              className={cn(
                styles.mentionOption,
                styles.slashCommandItem,
                isSelected && styles.mentionOptionSelected
              )}
              onClick={() => onSelect(command)}
              onMouseEnter={(e) => e.currentTarget.focus()}
            >
              <span className={styles.slashCommandIcon}>{command.icon}</span>
              <span className={styles.slashCommandContent}>
                <span className={styles.slashCommandName}>/{command.name}</span>
                <span className={styles.slashCommandDescription}>
                  {command.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
