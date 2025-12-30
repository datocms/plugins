import type { ModelInfo } from '@hooks/useMentions';
import { MentionDropdownBase } from './shared/MentionDropdownBase';
import { cn } from '@/utils/cn';
import styles from '@styles/comment.module.css';

type ModelMentionDropdownProps = {
  models: ModelInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (model: ModelInfo) => void;
  onClose: () => void;
  position?: 'above' | 'below';
};

const ModelMentionDropdown = ({
  models,
  query,
  selectedIndex,
  onSelect,
  onClose,
  position = 'below',
}: ModelMentionDropdownProps) => {
  const emptyMessage = query ? `No models matching "${query}"` : 'No models available';

  return (
    <MentionDropdownBase
      items={models}
      emptyMessage={emptyMessage}
      headerText="Models"
      selectedIndex={selectedIndex}
      onClose={onClose}
      position={position}
      keyExtractor={(model) => model.id}
      renderItem={(model, _index, isSelected, selectedRef) => (
        <button
          ref={isSelected ? selectedRef : null}
          type="button"
          className={cn(styles.mentionOption, isSelected && styles.mentionOptionSelected)}
          onMouseDown={(e) => {
            // Prevent blur on textarea
            e.preventDefault();
            onSelect(model);
          }}
          onClick={() => onSelect(model)}
        >
          <span className={styles.mentionModelInfo}>
            <span className={styles.mentionModelName}>{model.name}</span>
            {model.isBlockModel && (
              <span className={styles.mentionModelBadge}>Block</span>
            )}
          </span>
          <span className={styles.mentionFieldApiKey}>${model.apiKey}</span>
        </button>
      )}
    />
  );
};

export default ModelMentionDropdown;
