import type { FieldInfo } from '@hooks/useMentions';
import styles from '@styles/comment.module.css';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { BackIcon } from 'datocms-react-ui';
import { useEffect } from 'react';
import { cn } from '@/utils/cn';
import { FieldMentionIcon } from './Icons';
import { MentionDropdownBase } from './shared/MentionDropdownBase';
import { MentionDropdownOptionContent } from './shared/MentionDropdownOptionContent';

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
        headerLeading={
          <button
            aria-label="Back to fields"
            className={styles.mentionBackButton}
            onClick={() => onClearPendingField?.()}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            <BackIcon height={10} width={6} />
          </button>
        }
        headerText={`Locale · ${localeField.label}`}
        items={locales}
        keyExtractor={(locale) => locale}
        onClose={onClose}
        position={position}
        renderItem={(locale, _index, isSelected, selectedRef) => (
          <button
            className={cn(
              styles.mentionOption,
              isSelected && styles.mentionOptionSelected,
            )}
            role="menuitem"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => onSelect(localeField, locale)}
            onMouseEnter={() => onSelectedIndexChange?.(_index)}
            ref={isSelected ? selectedRef : null}
            type="button"
          >
            <span className={styles.mentionLocaleBadge}>
              {locale.toUpperCase()}
            </span>
            <span className={styles.mentionOptionTitle}>{locale}</span>
          </button>
        )}
        selectedIndex={Math.min(selectedIndex, Math.max(0, locales.length - 1))}
      />
    );
  }

  const emptyMessage = isLoading
    ? 'Loading fields…'
    : errorMessage || (query ? `No fields matching "${query}"` : 'No fields');
  const retryAction =
    errorMessage && onRetry ? (
      <button
        className={styles.mentionRetryButton}
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    ) : undefined;

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
          role="menuitem"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            if (field.localized && (field.availableLocales?.length ?? 0) > 1) {
              onSelect(field);
              return;
            }
            onSelect(field, field.availableLocales?.[0]);
          }}
          onMouseEnter={() => onSelectedIndexChange?.(_index)}
          ref={isSelected ? selectedRef : null}
          type="button"
        >
          <MentionDropdownOptionContent
            leading={<FieldMentionIcon aria-hidden="true" />}
            title={field.displayLabel}
            trailing={
              <span className={styles.mentionFieldApiKey}>#{field.apiKey}</span>
            }
          />
        </button>
      )}
      emptyAction={retryAction}
      selectedIndex={selectedIndex}
      statusAction={retryAction}
      statusMessage={
        isLoading
          ? 'Loading fields…'
          : errorMessage
            ? 'Couldn’t refresh fields.'
            : undefined
      }
    />
  );
}
