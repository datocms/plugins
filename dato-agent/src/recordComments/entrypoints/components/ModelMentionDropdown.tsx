import type { ModelInfo } from '@hooks/useMentions';
import styles from '@styles/comment.module.css';
import { cn } from '@/utils/cn';
import { ModelMentionIcon } from './Icons';
import { MentionDropdownBase } from './shared/MentionDropdownBase';
import { MentionDropdownOptionContent } from './shared/MentionDropdownOptionContent';

type ModelMentionDropdownProps = {
  models: ModelInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (model: ModelInfo) => void;
  onClose: () => void;
  position?: 'above' | 'below';
  onSelectedIndexChange?: (index: number) => void;
};

const ModelMentionDropdown = ({
  models,
  query,
  selectedIndex,
  onSelect,
  onClose,
  position = 'below',
  onSelectedIndexChange,
}: ModelMentionDropdownProps) => {
  const emptyMessage = query
    ? `No models matching "${query}"`
    : 'No models available';

  return (
    <MentionDropdownBase
      items={models}
      emptyMessage={emptyMessage}
      headerText="Models"
      selectedIndex={selectedIndex}
      onClose={onClose}
      position={position}
      keyExtractor={(model) => model.id}
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
            // Prevent blur on textarea
            e.preventDefault();
          }}
          onClick={() => onSelect(model)}
          onMouseEnter={() => onSelectedIndexChange?.(index)}
        >
          <MentionDropdownOptionContent
            leading={<ModelMentionIcon aria-hidden="true" />}
            title={model.name}
            trailing={
              <span className={styles.mentionOptionMeta}>
                {model.isBlockModel && (
                  <span className={styles.mentionModelBadge}>Block</span>
                )}
                <span className={styles.mentionFieldApiKey}>
                  ${model.apiKey}
                </span>
              </span>
            }
          />
        </button>
      )}
    />
  );
};

export default ModelMentionDropdown;
