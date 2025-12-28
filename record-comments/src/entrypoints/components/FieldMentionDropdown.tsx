import { useEffect, useRef } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import type { FieldInfo } from '@hooks/useMentions';
import { useFieldNavigation } from '@hooks/useFieldNavigation';
import { useClickOutside } from '@hooks/useDropdown';
import {
  FieldDropdownHeader,
  LocalePickerView,
  BlockPickerView,
  NestedFieldsView,
  FieldListView,
} from './field-dropdown';
import { cn } from '@/utils/cn';
import styles from '@styles/comment.module.css';

type FieldMentionDropdownProps = {
  fields: FieldInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (field: FieldInfo, locale?: string) => void;
  onClose: () => void;
  pendingFieldForLocale?: FieldInfo | null;
  onClearPendingField?: () => void;
  ctx?: RenderItemFormSidebarCtx;
  registerKeyHandler?: (handler: (key: string) => boolean) => void;
  position?: 'above' | 'below';
};

const FieldMentionDropdown = ({
  fields,
  query,
  selectedIndex,
  onSelect,
  onClose,
  pendingFieldForLocale,
  onClearPendingField,
  ctx,
  registerKeyHandler,
  position = 'below',
}: FieldMentionDropdownProps) => {
  const dropdownClassName = cn(
    styles.mentionDropdown,
    position === 'above' && styles.mentionDropdownAbove
  );
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  // Track if user clicked inside to prevent immediate close when clicking navigation
  const justClickedInsideRef = useRef(false);

  // Use shared click-outside hook instead of duplicating the logic
  // The hook uses a ref for the callback to avoid event listener churn
  useClickOutside(dropdownRef, () => {
    // Don't close if user just clicked inside (prevents closing during navigation)
    if (justClickedInsideRef.current) {
      justClickedInsideRef.current = false;
      return;
    }
    onClose();
  });

  const {
    navigationStack,
    localSelectedIndex,
    setLocalSelectedIndex,
    currentBlocks,
    currentNestedFields,
    isLoadingBlocks,
    viewMode,
    currentField,
    breadcrumb,
    handleBack,
    handleFieldClick,
    handleLocaleClick,
    handleBlockClick,
    handleSelectEntireField,
    handleKeyboardNavigation,
    handlePendingLocaleSelection,
  } = useFieldNavigation({
    ctx,
    onSelect,
    pendingFieldForLocale,
    onClearPendingField,
    selectedIndex,
  });

  // Scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [localSelectedIndex, selectedIndex]);

  // Register keyboard handler with parent
  useEffect(() => {
    if (registerKeyHandler) {
      registerKeyHandler(handleKeyboardNavigation);
    }
  }, [registerKeyHandler, handleKeyboardNavigation]);

  // Pending locale selection mode (from keyboard navigation)
  if (pendingFieldForLocale?.availableLocales && navigationStack.length === 0) {
    return (
      <div ref={dropdownRef} className={dropdownClassName}>
        <FieldDropdownHeader
          title={`Select locale for ${pendingFieldForLocale.label}`}
          onBack={() => onClearPendingField?.()}
          justClickedInsideRef={justClickedInsideRef}
        />
        <LocalePickerView
          locales={pendingFieldForLocale.availableLocales}
          selectedIndex={selectedIndex}
          onSelect={handlePendingLocaleSelection}
          onHover={setLocalSelectedIndex}
          selectedRef={selectedRef}
          justClickedInsideRef={justClickedInsideRef}
        />
      </div>
    );
  }

  // Empty state for field list
  if (viewMode === 'fields' && fields.length === 0) {
    return (
      <div ref={dropdownRef} className={dropdownClassName}>
        <div className={styles.mentionEmpty}>
          {query ? `No fields matching "${query}"` : 'No fields available'}
        </div>
      </div>
    );
  }

  // Locale picker view (drill-down mode)
  if (viewMode === 'locales' && currentField?.availableLocales) {
    return (
      <div ref={dropdownRef} className={dropdownClassName}>
        <FieldDropdownHeader
          title={`Select locale for ${currentField.label}`}
          onBack={handleBack}
          justClickedInsideRef={justClickedInsideRef}
        />
        <LocalePickerView
          locales={currentField.availableLocales}
          selectedIndex={localSelectedIndex}
          onSelect={handleLocaleClick}
          onHover={setLocalSelectedIndex}
          selectedRef={selectedRef}
          justClickedInsideRef={justClickedInsideRef}
        />
      </div>
    );
  }

  // Block picker view
  if (viewMode === 'blocks') {
    return (
      <div ref={dropdownRef} className={dropdownClassName}>
        <FieldDropdownHeader
          title={breadcrumb}
          onBack={handleBack}
          justClickedInsideRef={justClickedInsideRef}
        />
        <BlockPickerView
          blocks={currentBlocks}
          selectedIndex={localSelectedIndex}
          isLoading={isLoadingBlocks}
          onSelectEntireField={handleSelectEntireField}
          onSelectBlock={handleBlockClick}
          onHover={setLocalSelectedIndex}
          selectedRef={selectedRef}
          justClickedInsideRef={justClickedInsideRef}
        />
      </div>
    );
  }

  // Nested fields view (inside a block)
  if (viewMode === 'nestedFields') {
    return (
      <div ref={dropdownRef} className={dropdownClassName}>
        <FieldDropdownHeader
          title={breadcrumb}
          onBack={handleBack}
          justClickedInsideRef={justClickedInsideRef}
        />
        <NestedFieldsView
          fields={currentNestedFields}
          selectedIndex={localSelectedIndex}
          isLoading={isLoadingBlocks}
          onSelect={handleFieldClick}
          onHover={setLocalSelectedIndex}
          selectedRef={selectedRef}
          justClickedInsideRef={justClickedInsideRef}
        />
      </div>
    );
  }

  // Default: Field list view
  return (
    <div ref={dropdownRef} className={dropdownClassName}>
      <FieldListView
        fields={fields}
        selectedIndex={selectedIndex}
        onSelect={handleFieldClick}
        selectedRef={selectedRef}
        justClickedInsideRef={justClickedInsideRef}
      />
    </div>
  );
};

export default FieldMentionDropdown;
