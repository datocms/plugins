import type { FieldInfo } from '@hooks/useMentions';
import { formatLocale } from '@utils/mentionFormatters';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import ApiKey from 'datocms-react-ui/ApiKey';
import Button from 'datocms-react-ui/Button';
import { useEffect } from 'react';
import { ChevronLeftIcon, FieldIcon } from '../../../icons';
import {
  keepEditorFocus,
  MentionDropdownBase,
} from './shared/MentionDropdownBase';
import { repeatedTitles } from './shared/MentionDropdownOptionContent';

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

function emptyText(query: string, isLoading: boolean, error: string | null) {
  if (isLoading) return 'Loading fields…';
  if (error) return error;
  return query ? `No fields match “${query}”` : 'No fields available';
}

function statusText(isLoading: boolean, error: string | null) {
  if (isLoading) return 'Loading fields…';
  if (error) return 'Couldn’t refresh fields.';
  return undefined;
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
        emptyMessage="No languages available"
        headerIcon={
          <Button
            tone="ghost"
            size="micro"
            iconOnly
            icon={ChevronLeftIcon}
            label="Back to fields"
            onClick={() => onClearPendingField?.()}
            onMouseDown={keepEditorFocus}
          />
        }
        headerText={`Language · ${localeField.label}`}
        items={locales}
        keyExtractor={(locale) => locale}
        onClose={onClose}
        onSelect={(locale) => onSelect(localeField, locale)}
        onSelectedIndexChange={onSelectedIndexChange}
        position={position}
        renderOption={(locale) => ({
          title: `${formatLocale(locale)} (${locale})`,
        })}
        selectedIndex={Math.min(selectedIndex, Math.max(0, locales.length - 1))}
      />
    );
  }

  const sharedLabels = repeatedTitles(
    fields.map((field) => field.displayLabel),
  );

  return (
    <MentionDropdownBase
      busy={isLoading}
      emptyMessage={emptyText(query, isLoading, errorMessage)}
      headerIcon={<FieldIcon />}
      headerText="Fields"
      items={fields}
      keyExtractor={(field) => field.fieldPath}
      onClose={onClose}
      onRetry={errorMessage && onRetry ? onRetry : undefined}
      onSelect={(field) => {
        if (field.localized && (field.availableLocales?.length ?? 0) > 1) {
          onSelect(field);
          return;
        }
        onSelect(field, field.availableLocales?.[0]);
      }}
      onSelectedIndexChange={onSelectedIndexChange}
      position={position}
      renderOption={(field) => ({
        title: field.displayLabel,
        afterTitle: sharedLabels.has(field.displayLabel) ? (
          <ApiKey>{field.apiKey}</ApiKey>
        ) : undefined,
      })}
      selectedIndex={selectedIndex}
      status={statusText(isLoading, errorMessage)}
    />
  );
}
