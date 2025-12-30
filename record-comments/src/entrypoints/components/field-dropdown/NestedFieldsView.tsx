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
            onClick={() => onSelect(field)}
            onMouseEnter={() => onHover(index)}
          >
            <span className={styles.mentionFieldLabel}>{field.label}</span>
            <span className={styles.mentionFieldMeta}>
              {isBlockContainer && !hasMultipleLocales && (
                <span className={styles.mentionBlockIndicator} title="Contains blocks">
                  ▶
                </span>
              )}
              {hasMultipleLocales && (
                <span className={styles.mentionLocaleIndicator} title="Localized field">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
                  </svg>
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
