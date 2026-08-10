import type { ModelInfo } from '@hooks/useMentions';
import styles from '@styles/comment.module.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import { RecordMentionIcon } from './Icons';
import { MentionDropdownBase } from './shared/MentionDropdownBase';
import { MentionDropdownOptionContent } from './shared/MentionDropdownOptionContent';

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

  const nonBlockModels = useMemo(
    () => models.filter((m) => !m.isBlockModel),
    [models],
  );

  const filteredModels = useMemo(() => {
    const lowerQuery = query.toLowerCase();
    return nonBlockModels.filter(
      (model) =>
        model.name.toLowerCase().includes(lowerQuery) ||
        model.apiKey.toLowerCase().includes(lowerQuery),
    );
  }, [query, nonBlockModels]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const emptyMessage = query
    ? `No models matching "${query}"`
    : nonBlockModels.length === 0
      ? 'No models available with read permission'
      : 'No models available';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredModels.length - 1 ? prev + 1 : prev,
        );
        break;

      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;

      case 'Enter':
        if (filteredModels.length === 0) break;
        e.preventDefault();
        onSelect(filteredModels[selectedIndex] ?? filteredModels[0]);
        break;

      case 'Tab':
        if (filteredModels.length === 0) break;
        e.preventDefault();
        onSelect(filteredModels[selectedIndex] ?? filteredModels[0]);
        break;

      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  const searchSlot = (
    <div className={styles.recordModelSearchWrapper} onKeyDown={handleKeyDown}>
      <input
        aria-label="Search record models"
        autoComplete="off"
        ref={inputRef}
        spellCheck={false}
        type="text"
        className={styles.recordModelSearchInput}
        placeholder="Search models..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedIndex(0);
        }}
      />
    </div>
  );

  return (
    <MentionDropdownBase
      items={filteredModels}
      emptyMessage={emptyMessage}
      headerText="Records"
      selectedIndex={selectedIndex}
      onClose={onClose}
      position={position}
      keyExtractor={(model) => model.id}
      searchSlot={searchSlot}
      renderItem={(model, index, isSelected, selectedRef) => (
        <button
          ref={isSelected ? selectedRef : null}
          type="button"
          className={cn(
            styles.mentionOption,
            isSelected && styles.mentionOptionSelected,
          )}
          role="menuitem"
          onMouseDown={(e) => {
            e.preventDefault();
          }}
          onClick={() => onSelect(model)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <MentionDropdownOptionContent
            leading={<RecordMentionIcon aria-hidden="true" />}
            title={model.name}
            trailing={
              <span className={styles.mentionFieldApiKey}>${model.apiKey}</span>
            }
          />
        </button>
      )}
    />
  );
};

export default RecordModelSelectorDropdown;
