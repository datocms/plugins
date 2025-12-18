import { useRef } from 'react';
import type { ModelInfo } from '../hooks/useMentions';
import { useScrollSelectedIntoView, useClickOutside } from '../hooks/useDropdown';
import styles from '../styles/comment.module.css';

type ModelMentionDropdownProps = {
  models: ModelInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (model: ModelInfo) => void;
  onClose: () => void;
};

const ModelMentionDropdown = ({
  models,
  query,
  selectedIndex,
  onSelect,
  onClose,
}: ModelMentionDropdownProps) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useScrollSelectedIntoView(selectedRef, selectedIndex);
  useClickOutside(dropdownRef, onClose);

  if (models.length === 0) {
    return (
      <div ref={dropdownRef} className={styles.mentionDropdown}>
        <div className={styles.mentionEmpty}>
          {query ? `No models matching "${query}"` : 'No models available'}
        </div>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={styles.mentionDropdown}>
      <div className={styles.mentionHeader}>Models</div>
      <div className={styles.mentionList}>
        {models.map((model, index) => (
          <button
            key={model.id}
            ref={index === selectedIndex ? selectedRef : null}
            type="button"
            className={`${styles.mentionOption} ${index === selectedIndex ? styles.mentionOptionSelected : ''}`}
            onMouseDown={(e) => {
              // Prevent blur on textarea
              e.preventDefault();
              onSelect(model);
            }}
          >
            <span className={styles.mentionModelInfo}>
              <span className={styles.mentionModelName}>{model.name}</span>
              {model.isBlockModel && (
                <span className={styles.mentionModelBadge}>Block</span>
              )}
            </span>
            <span className={styles.mentionFieldApiKey}>${model.apiKey}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ModelMentionDropdown;


