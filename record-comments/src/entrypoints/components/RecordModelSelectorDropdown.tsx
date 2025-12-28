import { useEffect, useRef, useState, useMemo } from 'react';
import type { ModelInfo } from '@hooks/useMentions';
import { MentionDropdownBase } from './shared/MentionDropdownBase';
import { cn } from '@/utils/cn';
import styles from '@styles/comment.module.css';

type RecordModelSelectorDropdownProps = {
  models: ModelInfo[];
  onSelect: (model: ModelInfo) => void;
  onClose: () => void;
  position?: 'above' | 'below';
};

const RecordModelSelectorDropdown = ({
  models,
  onSelect,
  onClose,
  position = 'below',
}: RecordModelSelectorDropdownProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter out block models (they don't have standalone records)
  const nonBlockModels = useMemo(
    () => models.filter((m) => !m.isBlockModel),
    [models]
  );

  // Filter by search query
  const filteredModels = useMemo(() => {
    const lowerQuery = query.toLowerCase();
    return nonBlockModels.filter(
      (model) =>
        model.name.toLowerCase().includes(lowerQuery) ||
        model.apiKey.toLowerCase().includes(lowerQuery)
    );
  }, [query, nonBlockModels]);

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Compute empty message
  const emptyMessage = query
    ? `No models matching "${query}"`
    : nonBlockModels.length === 0
      ? 'No models available with read permission'
      : 'No models available';

  /**
   * Handle keyboard navigation for the dropdown.
   *
   * ARCHITECTURE NOTE: KEYBOARD NAVIGATION NOT EXTRACTED TO SHARED HOOK
   *
   * This keyboard navigation logic is duplicated in FilterDropdown.tsx. While
   * it could be extracted to a shared useKeyboardNavigation hook, this was
   * intentionally NOT done for these reasons:
   *
   * 1. LOW DUPLICATION COST: Only ~30 lines duplicated across 2 components
   * 2. COMPONENT-SPECIFIC BEHAVIOR: Each dropdown has slightly different behavior
   *    - RecordModelSelectorDropdown: Tab selects item
   *    - FilterDropdown: Has "Select All" handling, different indexing
   * 3. READABILITY: Inline logic is easier to follow and modify per-component
   * 4. MAINTENANCE OVERHEAD: A generic hook would need configuration options
   *    that add complexity without proportional benefit
   *
   * If a third dropdown component is added with similar navigation, extraction
   * should be reconsidered. For now, the small duplication is acceptable.
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredModels.length - 1 ? prev + 1 : prev
        );
        break;

      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;

      case 'Enter':
        e.preventDefault();
        if (filteredModels.length > 0) {
          onSelect(filteredModels[selectedIndex]);
        }
        break;

      case 'Tab':
        e.preventDefault();
        if (filteredModels.length > 0) {
          onSelect(filteredModels[selectedIndex]);
        }
        break;

      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  // Search input slot
  const searchSlot = (
    <div className={styles.recordModelSearchWrapper} onKeyDown={handleKeyDown}>
      <input
        ref={inputRef}
        type="text"
        className={styles.recordModelSearchInput}
        placeholder="Search models..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </div>
  );

  return (
    <MentionDropdownBase
      items={filteredModels}
      emptyMessage={emptyMessage}
      headerText="Select a Model"
      selectedIndex={selectedIndex}
      onClose={onClose}
      position={position}
      keyExtractor={(model) => model.id}
      searchSlot={searchSlot}
      renderItem={(model, index, isSelected, selectedRef) => (
        <button
          ref={isSelected ? selectedRef : null}
          type="button"
          className={cn(styles.mentionOption, isSelected && styles.mentionOptionSelected)}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(model);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className={styles.mentionModelInfo}>
            <span className={styles.mentionModelName}>{model.name}</span>
          </span>
          <span className={styles.mentionFieldApiKey}>${model.apiKey}</span>
        </button>
      )}
    />
  );
};

export default RecordModelSelectorDropdown;
