import type { MutableRefObject, ReactNode, Ref } from 'react';
import type { FieldInfo } from '@hooks/useMentions';
import styles from '@styles/comment.module.css';

/**
 * ARCHITECTURE NOTE: FieldListView, NestedFieldsView, and BlockPickerView share similar
 * button rendering patterns but are intentionally kept as separate components rather than
 * extracting a shared DropdownOption component. The reasons:
 *
 * 1. **Different prop signatures**: FieldListView doesn't have onHover, NestedFieldsView
 *    and BlockPickerView do. Unifying would require optional props and conditionals.
 *
 * 2. **Different content structures**: FieldListView has a header ("Fields"), others don't.
 *    BlockPickerView has a special "Select entire field" option at the top.
 *
 * 3. **Different loading/empty states**: Each view handles these differently based on context.
 *
 * 4. **Readability over DRY**: The ~15 lines of duplicated button JSX across 3 files is
 *    acceptable duplication. Extracting would create an over-abstracted component with
 *    complex conditional rendering that's harder to understand than the current explicit code.
 *
 * If a fourth or fifth view is needed, consider extracting a FieldOptionButton component.
 */
type FieldListViewProps = {
  fields: FieldInfo[];
  selectedIndex: number;
  onSelect: (field: FieldInfo) => void;
  selectedRef: Ref<HTMLButtonElement>;
  justClickedInsideRef: MutableRefObject<boolean>;
};

export function FieldListView({
  fields,
  selectedIndex,
  onSelect,
  selectedRef,
  justClickedInsideRef,
}: FieldListViewProps): ReactNode {
  return (
    <>
      <div className={styles.mentionHeader}>Fields</div>
      <div className={styles.mentionList} role="listbox">
        {fields.map((field, index) => {
          const isNested = field.depth > 0;
          const hasMultipleLocales = field.availableLocales && field.availableLocales.length > 1;
          const isBlockContainer = field.isBlockContainer;

          return (
            <button
              key={field.fieldPath}
              ref={index === selectedIndex ? selectedRef : null}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={`${styles.mentionOption} ${index === selectedIndex ? styles.mentionOptionSelected : ''}`}
              style={{ paddingLeft: `${8 + field.depth * 12}px` }}
              onMouseDown={(e) => {
                e.preventDefault();
                justClickedInsideRef.current = true;
                onSelect(field);
              }}
            >
              <span className={styles.mentionFieldLabel}>
                {isNested ? field.displayLabel : field.label}
              </span>
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
    </>
  );
}

export default FieldListView;
