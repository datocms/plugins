import { useEffect, useRef, useState } from 'react';
import type { ModelInfo } from '../hooks/useMentions';
import { useScrollSelectedIntoView, useClickOutside } from '../hooks/useDropdown';
import styles from '../styles/comment.module.css';

type RecordModelSelectorDropdownProps = {
  models: ModelInfo[];
  onSelect: (model: ModelInfo) => void;
  onClose: () => void;
};

const RecordModelSelectorDropdown = ({
  models,
  onSelect,
  onClose,
}: RecordModelSelectorDropdownProps) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter out block models (they don't have standalone records)
  const nonBlockModels = models.filter((m) => !m.isBlockModel);

  // Filter by search query
  const filteredModels = nonBlockModels.filter((model) => {
    const lowerQuery = query.toLowerCase();
    return (
      model.name.toLowerCase().includes(lowerQuery) ||
      model.apiKey.toLowerCase().includes(lowerQuery)
    );
  });

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useScrollSelectedIntoView(selectedRef, selectedIndex);
  useClickOutside(dropdownRef, onClose);

  // Handle keyboard navigation
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

  return (
    <div
      ref={dropdownRef}
      className={styles.mentionDropdown}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.mentionHeader}>Select a Model</div>
      <div className={styles.recordModelSearchWrapper}>
        <input
          ref={inputRef}
          type="text"
          className={styles.recordModelSearchInput}
          placeholder="Search models..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {filteredModels.length === 0 ? (
        <div className={styles.mentionEmpty}>
          {query ? `No models matching "${query}"` : 'No models available'}
        </div>
      ) : (
        <div className={styles.mentionList}>
          {filteredModels.map((model, index) => (
            <button
              key={model.id}
              ref={index === selectedIndex ? selectedRef : null}
              type="button"
              className={`${styles.mentionOption} ${index === selectedIndex ? styles.mentionOptionSelected : ''}`}
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
          ))}
        </div>
      )}
    </div>
  );
};

export default RecordModelSelectorDropdown;


