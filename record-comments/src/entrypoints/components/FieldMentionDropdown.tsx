import { useEffect, useRef, useState } from 'react';
import type { FieldInfo } from '../hooks/useMentions';
import styles from '../styles/comment.module.css';

type FieldMentionDropdownProps = {
  fields: FieldInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (field: FieldInfo, locale?: string) => void;
  onClose: () => void;
  // For keyboard-driven locale selection (from useMentions)
  pendingFieldForLocale?: FieldInfo | null;
  onClearPendingField?: () => void;
};

const FieldMentionDropdown = ({
  fields,
  query,
  selectedIndex,
  onSelect,
  onClose,
  pendingFieldForLocale,
  onClearPendingField,
}: FieldMentionDropdownProps) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  
  // Flag to prevent click-outside from closing dropdown immediately after internal click
  const justClickedInsideRef = useRef(false);
  
  // State for locale selection (when a localized field with multiple locales is selected)
  const [pendingField, setPendingField] = useState<FieldInfo | null>(null);
  const [localeSelectedIndex, setLocaleSelectedIndex] = useState(0);

  // Scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Skip if we just clicked inside (flag set by button handlers)
      // This prevents false "outside" detection when React re-renders and removes the clicked element
      if (justClickedInsideRef.current) {
        justClickedInsideRef.current = false;
        return;
      }
      
      const isInside = dropdownRef.current?.contains(e.target as Node);
      if (!isInside) {
        setPendingField(null);
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Handle field selection
  const handleFieldClick = (field: FieldInfo) => {
    // If field has multiple locales, show locale picker
    if (field.availableLocales && field.availableLocales.length > 1) {
      setPendingField(field);
      setLocaleSelectedIndex(0);
    } else if (field.localized && field.availableLocales && field.availableLocales.length === 1) {
      // Only one locale available - auto-select it
      onSelect(field, field.availableLocales[0]);
    } else {
      // Non-localized field - no locale needed
      onSelect(field);
    }
  };

  if (fields.length === 0) {
    return (
      <div ref={dropdownRef} className={styles.mentionDropdown}>
        <div className={styles.mentionEmpty}>
          {query ? `No fields matching "${query}"` : 'No fields available'}
        </div>
      </div>
    );
  }

  // Determine which field to show locale picker for (mouse-driven or keyboard-driven)
  const fieldForLocalePicker = pendingField ?? pendingFieldForLocale;
  
  // Show locale picker if a field with multiple locales was selected (via mouse or keyboard)
  if (fieldForLocalePicker?.availableLocales) {
    // Use selectedIndex for keyboard navigation when using keyboard-driven selection
    const currentLocaleIndex = pendingFieldForLocale ? selectedIndex : localeSelectedIndex;
    
    const handleLocaleSelection = (locale: string) => {
      onSelect(fieldForLocalePicker, locale);
      // Clear both internal state and parent state
      setPendingField(null);
      onClearPendingField?.();
    };
    
    const handleBackFromLocale = () => {
      setPendingField(null);
      onClearPendingField?.();
    };
    
    return (
      <div ref={dropdownRef} className={styles.mentionDropdown}>
        <div className={styles.mentionHeader}>
          <button
            type="button"
            className={styles.mentionBackButton}
            onMouseDown={(e) => {
              e.preventDefault();
              justClickedInsideRef.current = true;
              handleBackFromLocale();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <title>Go back</title>
              <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
            </svg>
          </button>
          Select locale for {fieldForLocalePicker.label}
        </div>
        <div className={styles.mentionList}>
          {fieldForLocalePicker.availableLocales.map((locale, index) => (
            <button
              key={locale}
              ref={index === currentLocaleIndex ? selectedRef : null}
              type="button"
              className={`${styles.mentionOption} ${index === currentLocaleIndex ? styles.mentionOptionSelected : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                justClickedInsideRef.current = true;
                handleLocaleSelection(locale);
              }}
              onMouseEnter={() => setLocaleSelectedIndex(index)}
            >
              <span className={styles.mentionLocaleBadge}>{locale.toUpperCase()}</span>
              <span className={styles.mentionFieldLabel}>{locale}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={styles.mentionDropdown}>
      <div className={styles.mentionHeader}>Fields</div>
      <div className={styles.mentionList}>
        {fields.map((field, index) => {
          const isNested = field.depth > 0;
          const hasMultipleLocales = field.availableLocales && field.availableLocales.length > 1;
          return (
            <button
              key={field.fieldPath}
              ref={index === selectedIndex ? selectedRef : null}
              type="button"
              className={`${styles.mentionOption} ${index === selectedIndex ? styles.mentionOptionSelected : ''}`}
              style={{ paddingLeft: `${8 + field.depth * 12}px` }}
              onMouseDown={(e) => {
                // Prevent blur on textarea
                e.preventDefault();
                // Set flag to prevent click-outside from closing (React re-render removes clicked element)
                justClickedInsideRef.current = true;
                handleFieldClick(field);
              }}
              onMouseEnter={() => {
                // Visual feedback on hover is handled by CSS,
                // selectedIndex is controlled by keyboard
              }}
            >
              <span className={styles.mentionFieldLabel}>
                {isNested ? field.displayLabel : field.label}
              </span>
              <span className={styles.mentionFieldMeta}>
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
    </div>
  );
};

export default FieldMentionDropdown;

