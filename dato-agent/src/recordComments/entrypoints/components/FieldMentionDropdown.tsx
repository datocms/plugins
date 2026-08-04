import type { FieldInfo } from '@hooks/useMentions';
import styles from '@styles/comment.module.css';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useEffect } from 'react';
import { cn } from '@/utils/cn';
import { MentionDropdownBase } from './shared/MentionDropdownBase';

type FieldMentionDropdownProps = {
  fields: FieldInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (field: FieldInfo, locale?: string) => void;
  onClose: () => void;
  pendingFieldForLocale?: FieldInfo | null;
  onClearPendingField?: () => void;
  registerKeyHandler?: (handler: (key: string) => boolean) => void;
  onSelectedIndexChange?: (index: number) => void;
  position?: 'above' | 'below';
  onPathChange?: (path: string) => void;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  ctx?: RenderItemFormSidebarCtx;
};

function handleLocaleKey({
  key,
  localeField,
  selectedIndex,
  onSelect,
  onClear,
  onSelectedIndexChange,
}: {
  key: string;
  localeField: FieldInfo;
  selectedIndex: number;
  onSelect: (field: FieldInfo, locale?: string) => void;
  onClear: () => void;
  onSelectedIndexChange?: (index: number) => void;
}): boolean {
  const locales = localeField.availableLocales ?? [];
  const currentIndex = Math.min(selectedIndex, Math.max(0, locales.length - 1));

  if (key === 'ArrowDown' && locales.length > 0) {
    onSelectedIndexChange?.((currentIndex + 1) % locales.length);
    return true;
  }
  if (key === 'ArrowUp' && locales.length > 0) {
    onSelectedIndexChange?.(
      (currentIndex - 1 + locales.length) % locales.length,
    );
    return true;
  }
  if ((key === 'Enter' || key === 'Tab') && locales[currentIndex]) {
    onSelect(localeField, locales[currentIndex]);
    return true;
  }
  if (key === 'Escape' || key === 'Backspace') {
    onClear();
    return true;
  }
  return false;
}

export default function FieldMentionDropdown({
  fields,
  query,
  selectedIndex,
  onSelect,
  onClose,
  pendingFieldForLocale,
  onClearPendingField,
  registerKeyHandler,
  onSelectedIndexChange,
  position = 'below',
  onPathChange,
  isLoading = false,
  errorMessage = null,
  onRetry,
}: FieldMentionDropdownProps) {
  const localeField = pendingFieldForLocale?.availableLocales?.length
    ? pendingFieldForLocale
    : null;

  useEffect(() => {
    registerKeyHandler?.((key) => {
      if (localeField) {
        return handleLocaleKey({
          key,
          localeField,
          selectedIndex,
          onSelect,
          onClear: () => onClearPendingField?.(),
          onSelectedIndexChange,
        });
      }
      if (key === 'Escape') {
        onClose();
        return true;
      }
      return false;
    });
  }, [
    localeField,
    onClearPendingField,
    onClose,
    onSelect,
    onSelectedIndexChange,
    registerKeyHandler,
    selectedIndex,
  ]);

  useEffect(() => {
    onPathChange?.('');
  }, [onPathChange]);

  if (localeField) {
    const locales = localeField.availableLocales ?? [];
    return (
      <MentionDropdownBase
        emptyMessage="No locales available"
        headerText={`Select locale for ${localeField.label}`}
        items={locales}
        keyExtractor={(locale) => locale}
        onClose={() => onClearPendingField?.()}
        position={position}
        renderItem={(locale, _index, isSelected, selectedRef) => (
          <button
            className={cn(
              styles.mentionOption,
              isSelected && styles.mentionOptionSelected,
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(localeField, locale);
            }}
            onMouseEnter={() => onSelectedIndexChange?.(_index)}
            ref={isSelected ? selectedRef : null}
            type="button"
          >
            <span className={styles.mentionLocaleBadge}>
              {locale.toUpperCase()}
            </span>
            <span className={styles.mentionFieldLabel}>{locale}</span>
          </button>
        )}
        selectedIndex={Math.min(selectedIndex, Math.max(0, locales.length - 1))}
      />
    );
  }

  const emptyMessage = isLoading
    ? 'Loading fields…'
    : errorMessage || (query ? `No fields matching "${query}"` : 'No fields');

  return (
    <MentionDropdownBase
      emptyMessage={emptyMessage}
      headerText="Fields"
      items={fields}
      keyExtractor={(field) => field.fieldPath}
      onClose={onClose}
      position={position}
      renderItem={(field, _index, isSelected, selectedRef) => (
        <button
          className={cn(
            styles.mentionOption,
            isSelected && styles.mentionOptionSelected,
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            if (field.localized && (field.availableLocales?.length ?? 0) > 1) {
              onSelect(field);
              return;
            }
            onSelect(field, field.availableLocales?.[0]);
          }}
          ref={isSelected ? selectedRef : null}
          type="button"
        >
          <span className={styles.mentionFieldLabel}>{field.displayLabel}</span>
          <span className={styles.mentionFieldApiKey}>#{field.apiKey}</span>
        </button>
      )}
      searchSlot={
        errorMessage && onRetry ? (
          <button
            className={styles.mentionRetryButton}
            onClick={onRetry}
            type="button"
          >
            Retry
          </button>
        ) : undefined
      }
      selectedIndex={selectedIndex}
    />
  );
}
