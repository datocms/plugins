import type { MutableRefObject, ReactNode, Ref } from 'react';
import type { FieldInfo } from '@hooks/useMentions';
import styles from '@styles/comment.module.css';

type NestedFieldsViewProps = {
  fields: FieldInfo[];
  selectedIndex: number;
  isLoading: boolean;
  onSelect: (field: FieldInfo) => void;
  onHover: (index: number) => void;
  selectedRef: Ref<HTMLButtonElement>;
  justClickedInsideRef: MutableRefObject<boolean>;
};

export function NestedFieldsView({
  fields,
  selectedIndex,
  isLoading,
  onSelect,
  onHover,
  selectedRef,
  justClickedInsideRef,
}: NestedFieldsViewProps): ReactNode {
  if (isLoading) {
    return (
      <div className={styles.mentionList}>
        <div className={styles.mentionEmpty}>Loading fields...</div>
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className={styles.mentionList}>
        <div className={styles.mentionEmpty}>No fields in this block</div>
      </div>
    );
  }

  return (
    <div className={styles.mentionList}>
      {fields.map((field, index) => {
        const hasMultipleLocales = field.availableLocales && field.availableLocales.length > 1;
        const isBlockContainer = field.isBlockContainer;

        return (
          <button
            key={field.fieldPath}
            ref={index === selectedIndex ? selectedRef : null}
            type="button"
            className={`${styles.mentionOption} ${index === selectedIndex ? styles.mentionOptionSelected : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              justClickedInsideRef.current = true;
              onSelect(field);
            }}
            onMouseEnter={() => onHover(index)}
          >
            <span className={styles.mentionFieldLabel}>{field.label}</span>
            <span className={styles.mentionFieldMeta}>
              {isBlockContainer && (
                <span className={styles.mentionBlockIndicator} title="Contains blocks">
                  ▶
                </span>
              )}
              {hasMultipleLocales && (
                <span className={styles.mentionLocaleIndicator} title="Multiple locales available">
                  {field.availableLocales?.length}
                </span>
              )}
              <span className={styles.mentionFieldApiKey}>#{field.apiKey}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default NestedFieldsView;
