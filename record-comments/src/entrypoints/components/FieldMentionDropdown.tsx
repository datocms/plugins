import { useEffect, useRef, useState, useCallback } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import type { FieldInfo } from '../hooks/useMentions';
import type { BlockInfo } from '../types/mentions';
import {
  getBlocksForField,
  getFieldsForBlock,
  getBlockAttributesAtPath,
} from '../utils/fieldLoader';
import styles from '../styles/comment.module.css';

// Navigation step types for the drill-down stack
type NavigationStep =
  | { type: 'field'; field: FieldInfo }
  | { type: 'locale'; locale: string }
  | { type: 'block'; blockIndex: number; blockModelId: string; blockModelName: string };

type FieldMentionDropdownProps = {
  fields: FieldInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (field: FieldInfo, locale?: string) => void;
  onClose: () => void;
  // For keyboard-driven locale selection (from useMentions)
  pendingFieldForLocale?: FieldInfo | null;
  onClearPendingField?: () => void;
  // Context for loading block data
  ctx?: RenderItemFormSidebarCtx;
  // Keyboard event handler - called by parent to let dropdown handle keys in drill-down mode
  onKeyDown?: (key: string) => boolean;
  // Register the keyboard handler with the parent
  registerKeyHandler?: (handler: (key: string) => boolean) => void;
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
}: FieldMentionDropdownProps) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  
  // Flag to prevent click-outside from closing dropdown immediately after internal click
  const justClickedInsideRef = useRef(false);
  
  // Navigation stack for drill-down
  const [navigationStack, setNavigationStack] = useState<NavigationStep[]>([]);
  const [localSelectedIndex, setLocalSelectedIndex] = useState(0);

  // Current view state derived from navigation stack
  const [currentBlocks, setCurrentBlocks] = useState<BlockInfo[]>([]);
  const [currentNestedFields, setCurrentNestedFields] = useState<FieldInfo[]>([]);
  const [isLoadingBlocks, setIsLoadingBlocks] = useState(false);

  // Get the current field from navigation stack (the last field step)
  const getCurrentField = useCallback((): FieldInfo | null => {
    for (let i = navigationStack.length - 1; i >= 0; i--) {
      const step = navigationStack[i];
      if (step.type === 'field') {
        return step.field;
      }
    }
    return null;
  }, [navigationStack]);

  // Get the selected locale from navigation stack
  const getSelectedLocale = useCallback((): string | undefined => {
    for (const step of navigationStack) {
      if (step.type === 'locale') {
        return step.locale;
      }
    }
    return undefined;
  }, [navigationStack]);

  // Build the current field path from the navigation stack
  const buildFieldPath = useCallback((): string => {
    let path = '';
    let lastField: FieldInfo | null = null;
    
    for (const step of navigationStack) {
      if (step.type === 'field') {
        // Each field step has its own complete path (computed during loading)
        path = step.field.fieldPath;
        lastField = step.field;
      } else if (step.type === 'locale') {
        // Include locale in path for localized parent fields (e.g., sections.it)
        path = `${path}.${step.locale}`;
      } else if (step.type === 'block') {
        // For single_block, don't add index (the field's path already points to the block)
        if (lastField?.blockFieldType === 'single_block') {
          // Path doesn't change for single_block
        } else {
          path = `${path}.${step.blockIndex}`;
        }
      }
    }
    return path;
  }, [navigationStack]);

  // Determine current view mode based on navigation stack
  const getCurrentViewMode = useCallback((): 'fields' | 'locales' | 'blocks' | 'nestedFields' => {
    if (navigationStack.length === 0) {
      return 'fields';
    }

    const lastStep = navigationStack[navigationStack.length - 1];

    if (lastStep.type === 'block') {
      return 'nestedFields';
    }

    if (lastStep.type === 'locale') {
      // After locale selection, if the field is a block container, show blocks
      const field = getCurrentField();
      if (field?.isBlockContainer) {
        return 'blocks';
      }
      // Otherwise this shouldn't happen, but fallback to fields
      return 'fields';
    }

    if (lastStep.type === 'field') {
      const field = lastStep.field;
      // If field needs locale selection first
      if (field.localized && field.availableLocales && field.availableLocales.length > 1) {
        return 'locales';
      }
      // If field is a block container, show blocks
      if (field.isBlockContainer) {
        return 'blocks';
      }
      // Otherwise shouldn't be in stack (should have been selected)
      return 'fields';
    }

    return 'fields';
  }, [navigationStack, getCurrentField]);

  // For single_block fields, auto-navigate into the block when blocks are loaded
  // This skips the block picker since there's only ever one block
  useEffect(() => {
    const viewMode = getCurrentViewMode();
    if (viewMode !== 'blocks') return;

    const field = getCurrentField();
    if (field?.blockFieldType !== 'single_block') return;

    // Only auto-navigate if we have exactly one block
    if (currentBlocks.length === 1) {
      const block = currentBlocks[0];
      setNavigationStack((prev) => [
        ...prev,
        {
          type: 'block',
          blockIndex: block.index,
          blockModelId: block.modelId,
          blockModelName: block.modelName,
        },
      ]);
      setLocalSelectedIndex(0);
    }
  }, [currentBlocks, getCurrentField, getCurrentViewMode]);

  // Load blocks when we reach the blocks view
  useEffect(() => {
    const viewMode = getCurrentViewMode();
    if (viewMode !== 'blocks' || !ctx) {
      setCurrentBlocks([]);
      return;
    }

    const field = getCurrentField();
    if (!field?.isBlockContainer || !field.blockFieldType) {
      setCurrentBlocks([]);
      return;
    }

    setIsLoadingBlocks(true);
    const locale = getSelectedLocale();
    const blocks = getBlocksForField(ctx, field.fieldPath, field.blockFieldType, locale);
    setCurrentBlocks(blocks);
    setLocalSelectedIndex(0);
    setIsLoadingBlocks(false);
  }, [navigationStack, ctx, getCurrentField, getCurrentViewMode, getSelectedLocale]);

  // Load nested fields when inside a block
  useEffect(() => {
    const viewMode = getCurrentViewMode();
    if (viewMode !== 'nestedFields' || !ctx) {
      setCurrentNestedFields([]);
      return;
    }

    const loadNestedFields = async () => {
      setIsLoadingBlocks(true);

      // Find the LAST block step (for deeply nested blocks)
      let lastBlockStep: NavigationStep | null = null;
      for (let i = navigationStack.length - 1; i >= 0; i--) {
        if (navigationStack[i].type === 'block') {
          lastBlockStep = navigationStack[i];
          break;
        }
      }
      
      if (!lastBlockStep || lastBlockStep.type !== 'block') {
        setCurrentNestedFields([]);
        setIsLoadingBlocks(false);
        return;
      }

      const field = getCurrentField();
      if (!field?.blockFieldType) {
        setCurrentNestedFields([]);
        setIsLoadingBlocks(false);
        return;
      }

      const locale = getSelectedLocale();
      const blockAttrs = getBlockAttributesAtPath(
        ctx,
        field.fieldPath,
        lastBlockStep.blockIndex,
        field.blockFieldType,
        locale
      );

      // Build the base path for nested fields
      let basePath = field.fieldPath;
      if (field.blockFieldType !== 'single_block') {
        basePath = `${basePath}.${lastBlockStep.blockIndex}`;
      }

      const nestedFields = await getFieldsForBlock(
        ctx,
        lastBlockStep.blockModelId,
        blockAttrs,
        basePath
      );

      setCurrentNestedFields(nestedFields);
      setLocalSelectedIndex(0);
      setIsLoadingBlocks(false);
    };

    loadNestedFields();
  }, [navigationStack, ctx, getCurrentField, getCurrentViewMode, getSelectedLocale]);

  // Scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [localSelectedIndex, selectedIndex]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (justClickedInsideRef.current) {
        justClickedInsideRef.current = false;
        return;
      }
      
      const isInside = dropdownRef.current?.contains(e.target as Node);
      if (!isInside) {
        setNavigationStack([]);
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Handle going back in navigation
  const handleBack = useCallback(() => {
    if (navigationStack.length > 0) {
      setNavigationStack((prev) => prev.slice(0, -1));
      setLocalSelectedIndex(0);
    }
    onClearPendingField?.();
  }, [navigationStack.length, onClearPendingField]);

  // Handle field selection from main list or nested list
  const handleFieldClick = useCallback((field: FieldInfo) => {
    // If field is a block container, start drill-down
    if (field.isBlockContainer) {
      setNavigationStack((prev) => [...prev, { type: 'field', field }]);
      setLocalSelectedIndex(0);
      return;
    }

    // If field has multiple locales, add to stack for locale selection
    if (field.localized && field.availableLocales && field.availableLocales.length > 1) {
      setNavigationStack((prev) => [...prev, { type: 'field', field }]);
      setLocalSelectedIndex(0);
      return;
    }

    // Get the locale from navigation stack (if parent was localized)
    const selectedLocale = getSelectedLocale();

    // Build the final field path from navigation stack + this field
    const currentPath = buildFieldPath();
    const finalPath = currentPath ? `${currentPath}.${field.apiKey}` : field.fieldPath;

    // Create the final field info with the correct path
    // Note: locale is already embedded in finalPath (e.g., sections.it.0.hero_title)
    // so we don't pass it separately to avoid double-encoding
    const finalField: FieldInfo = {
      ...field,
      fieldPath: finalPath,
      // Inherit localized flag from parent if we have a selected locale
      localized: field.localized || !!selectedLocale,
    };

    // For nested fields where locale is already in the path, don't pass locale separately
    // The locale is already encoded in the fieldPath (e.g., sections.it.0.hero_title)
    // We only set locale on the mention for the badge display, not for path encoding
    onSelect(finalField, selectedLocale);

    // Reset navigation
    setNavigationStack([]);
  }, [buildFieldPath, getSelectedLocale, onSelect]);

  // Handle locale selection
  const handleLocaleClick = useCallback((locale: string) => {
    const field = getCurrentField();

    if (field?.isBlockContainer) {
      // Add locale to stack and continue to blocks view
      setNavigationStack((prev) => [...prev, { type: 'locale', locale }]);
      setLocalSelectedIndex(0);
    } else if (field) {
      // Non-block container localized field - select it
      onSelect(field, locale);
      setNavigationStack([]);
    }
  }, [getCurrentField, onSelect]);

  // Handle "Select entire field" in block picker
  const handleSelectEntireField = useCallback(() => {
    const field = getCurrentField();
    if (!field) return;

    const locale = getSelectedLocale();
    onSelect(field, locale);
    setNavigationStack([]);
  }, [getCurrentField, getSelectedLocale, onSelect]);

  // Handle block selection
  const handleBlockClick = useCallback((block: BlockInfo) => {
    setNavigationStack((prev) => [
      ...prev,
      {
        type: 'block',
        blockIndex: block.index,
        blockModelId: block.modelId,
        blockModelName: block.modelName,
      },
    ]);
    setLocalSelectedIndex(0);
  }, []);

  // Build breadcrumb for header
  const buildBreadcrumb = useCallback((): string => {
    const parts: string[] = [];
    for (const step of navigationStack) {
      if (step.type === 'field') {
        parts.push(step.field.label);
      } else if (step.type === 'locale') {
        parts.push(`(${step.locale.toUpperCase()})`);
      } else if (step.type === 'block') {
        parts.push(`${step.blockModelName} #${step.blockIndex + 1}`);
      }
    }
    return parts.join(' > ');
  }, [navigationStack]);

  // Get items for current view
  const viewMode = getCurrentViewMode();
  const currentField = getCurrentField();

  // Keyboard handler for drill-down navigation
  // Returns true if the event was handled
  const handleKeyboardNavigation = useCallback((key: string): boolean => {
    // Handle keyboard-driven locale picker (pendingFieldForLocale mode)
    // This takes priority because it's rendered when pendingFieldForLocale is set and navigationStack is empty
    if (pendingFieldForLocale?.availableLocales && navigationStack.length === 0) {
      if (key === 'ArrowDown') {
        // Arrow keys are handled by parent's selectedIndex, not localSelectedIndex
        return false; // Let parent handle arrow navigation
      }
      if (key === 'ArrowUp') {
        return false; // Let parent handle arrow navigation
      }
      if (key === 'Enter' || key === 'Tab') {
        // Get the locale from parent's selectedIndex (passed as prop)
        const locale = pendingFieldForLocale.availableLocales[selectedIndex];
        if (locale) {
          if (pendingFieldForLocale.isBlockContainer) {
            // Push field and locale to stack to continue drill-down
            setNavigationStack([
              { type: 'field', field: pendingFieldForLocale },
              { type: 'locale', locale },
            ]);
            setLocalSelectedIndex(0);
            onClearPendingField?.();
          } else {
            // Non-block container - just select it
            onSelect(pendingFieldForLocale, locale);
            onClearPendingField?.();
          }
        }
        return true;
      }
      if (key === 'Escape') {
        onClearPendingField?.();
        return true;
      }
      return false; // Let parent handle other keys
    }

    // Handle keyboard navigation for blocks view
    if (viewMode === 'blocks') {
      if (key === 'ArrowDown') {
        setLocalSelectedIndex((prev) => 
          prev < currentBlocks.length ? prev + 1 : prev // +1 for "Select entire field"
        );
        return true;
      }
      if (key === 'ArrowUp') {
        setLocalSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        return true;
      }
      if (key === 'Enter' || key === 'Tab') {
        if (localSelectedIndex === 0) {
          // "Select entire field" option
          handleSelectEntireField();
        } else {
          // Block selection
          const blockIndex = localSelectedIndex - 1;
          if (blockIndex < currentBlocks.length) {
            handleBlockClick(currentBlocks[blockIndex]);
          }
        }
        return true;
      }
      if (key === 'Escape' || key === 'Backspace') {
        handleBack();
        return true;
      }
      return true; // Consume other keys while in blocks view
    }

    // Handle keyboard navigation for nested fields view
    if (viewMode === 'nestedFields') {
      if (key === 'ArrowDown') {
        setLocalSelectedIndex((prev) => 
          prev < currentNestedFields.length - 1 ? prev + 1 : prev
        );
        return true;
      }
      if (key === 'ArrowUp') {
        setLocalSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        return true;
      }
      if (key === 'Enter' || key === 'Tab') {
        if (localSelectedIndex < currentNestedFields.length) {
          handleFieldClick(currentNestedFields[localSelectedIndex]);
        }
        return true;
      }
      if (key === 'Escape' || key === 'Backspace') {
        handleBack();
        return true;
      }
      return true; // Consume other keys while in nested fields view
    }

    // Handle keyboard navigation for locale picker (within drill-down)
    if (viewMode === 'locales' && currentField?.availableLocales) {
      if (key === 'ArrowDown') {
        setLocalSelectedIndex((prev) => 
          prev < currentField.availableLocales!.length - 1 ? prev + 1 : prev
        );
        return true;
      }
      if (key === 'ArrowUp') {
        setLocalSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        return true;
      }
      if (key === 'Enter' || key === 'Tab') {
        if (localSelectedIndex < currentField.availableLocales!.length) {
          handleLocaleClick(currentField.availableLocales![localSelectedIndex]);
        }
        return true;
      }
      if (key === 'Escape' || key === 'Backspace') {
        handleBack();
        return true;
      }
      return true; // Consume other keys while in locale view
    }

    return false; // Not in drill-down mode, let parent handle
  }, [viewMode, localSelectedIndex, currentBlocks, currentNestedFields, currentField, 
      handleSelectEntireField, handleBlockClick, handleFieldClick, handleLocaleClick, handleBack,
      pendingFieldForLocale, navigationStack, selectedIndex, onClearPendingField, onSelect]);

  // Register keyboard handler with parent
  useEffect(() => {
    if (registerKeyHandler) {
      registerKeyHandler(handleKeyboardNavigation);
    }
  }, [registerKeyHandler, handleKeyboardNavigation]);

  // Handle non-localized block container from keyboard navigation
  // When user presses Enter on a non-localized block container, push it to navigation stack
  useEffect(() => {
    if (pendingFieldForLocale?.isBlockContainer && !pendingFieldForLocale.localized && navigationStack.length === 0) {
      setNavigationStack([{ type: 'field', field: pendingFieldForLocale }]);
      setLocalSelectedIndex(0);
      onClearPendingField?.();
    }
  }, [pendingFieldForLocale, navigationStack.length, onClearPendingField]);

  // Handle keyboard-driven pending field (from parent hook)
  // This handles localized fields needing locale selection
  const fieldForPending = pendingFieldForLocale;
  
  // Localized field (block container or not) - show locale picker
  if (fieldForPending?.availableLocales && navigationStack.length === 0) {
    const currentLocaleIndex = selectedIndex;
    
    const handleLocaleSelection = (locale: string) => {
      if (fieldForPending.isBlockContainer) {
        // Push field and locale to stack
        setNavigationStack([
          { type: 'field', field: fieldForPending },
          { type: 'locale', locale },
        ]);
        setLocalSelectedIndex(0);
      onClearPendingField?.();
      } else {
        onSelect(fieldForPending, locale);
      onClearPendingField?.();
      }
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
              onClearPendingField?.();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <title>Go back</title>
              <path
                fillRule="evenodd"
                d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"
              />
            </svg>
          </button>
          Select locale for {fieldForPending.label}
        </div>
        <div className={styles.mentionList}>
          {fieldForPending.availableLocales.map((locale, index) => (
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
              onMouseEnter={() => setLocalSelectedIndex(index)}
            >
              <span className={styles.mentionLocaleBadge}>{locale.toUpperCase()}</span>
              <span className={styles.mentionFieldLabel}>{locale}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Empty state for field list
  if (viewMode === 'fields' && fields.length === 0) {
    return (
      <div ref={dropdownRef} className={styles.mentionDropdown}>
        <div className={styles.mentionEmpty}>
          {query ? `No fields matching "${query}"` : 'No fields available'}
        </div>
      </div>
    );
  }

  // Locale picker view
  if (viewMode === 'locales' && currentField?.availableLocales) {
    return (
      <div ref={dropdownRef} className={styles.mentionDropdown}>
        <div className={styles.mentionHeader}>
          <button
            type="button"
            className={styles.mentionBackButton}
            onMouseDown={(e) => {
              e.preventDefault();
              justClickedInsideRef.current = true;
              handleBack();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <title>Go back</title>
              <path
                fillRule="evenodd"
                d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"
              />
            </svg>
          </button>
          Select locale for {currentField.label}
        </div>
        <div className={styles.mentionList}>
          {currentField.availableLocales.map((locale, index) => (
            <button
              key={locale}
              ref={index === localSelectedIndex ? selectedRef : null}
              type="button"
              className={`${styles.mentionOption} ${index === localSelectedIndex ? styles.mentionOptionSelected : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                justClickedInsideRef.current = true;
                handleLocaleClick(locale);
              }}
              onMouseEnter={() => setLocalSelectedIndex(index)}
            >
              <span className={styles.mentionLocaleBadge}>{locale.toUpperCase()}</span>
              <span className={styles.mentionFieldLabel}>{locale}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Block picker view
  if (viewMode === 'blocks') {
    const breadcrumb = buildBreadcrumb();

    return (
      <div ref={dropdownRef} className={styles.mentionDropdown}>
        <div className={styles.mentionHeader}>
          <button
            type="button"
            className={styles.mentionBackButton}
            onMouseDown={(e) => {
              e.preventDefault();
              justClickedInsideRef.current = true;
              handleBack();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <title>Go back</title>
              <path
                fillRule="evenodd"
                d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"
              />
            </svg>
          </button>
          {breadcrumb}
        </div>
        <div className={styles.mentionList}>
          {isLoadingBlocks ? (
            <div className={styles.mentionEmpty}>Loading blocks...</div>
          ) : (
            <>
              {/* Select entire field option */}
              <button
                ref={localSelectedIndex === 0 ? selectedRef : null}
                type="button"
                className={`${styles.mentionOption} ${styles.mentionOptionEntireField} ${localSelectedIndex === 0 ? styles.mentionOptionSelected : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  justClickedInsideRef.current = true;
                  handleSelectEntireField();
                }}
                onMouseEnter={() => setLocalSelectedIndex(0)}
              >
                <span className={styles.mentionFieldLabel}>Select entire field</span>
                <span className={styles.mentionFieldMeta}>
                  <span className={styles.mentionBlockCount}>
                    {currentBlocks.length} block{currentBlocks.length !== 1 ? 's' : ''}
                  </span>
                </span>
              </button>

              {/* Block list */}
              {currentBlocks.length === 0 ? (
                <div className={styles.mentionEmpty}>No blocks in this field</div>
              ) : (
                currentBlocks.map((block, index) => {
                  const itemIndex = index + 1; // +1 for "Select entire field"
                  return (
                    <button
                      key={`${block.modelId}-${block.index}`}
                      ref={itemIndex === localSelectedIndex ? selectedRef : null}
                      type="button"
                      className={`${styles.mentionOption} ${itemIndex === localSelectedIndex ? styles.mentionOptionSelected : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        justClickedInsideRef.current = true;
                        handleBlockClick(block);
                      }}
                      onMouseEnter={() => setLocalSelectedIndex(itemIndex)}
                    >
                      <span className={styles.mentionFieldLabel}>
                        {block.modelName} #{block.index + 1}
                      </span>
                      <span className={styles.mentionFieldMeta}>
                        <span className={styles.mentionBlockBadge}>{block.modelName}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // Nested fields view (inside a block)
  if (viewMode === 'nestedFields') {
    const breadcrumb = buildBreadcrumb();

    return (
      <div ref={dropdownRef} className={styles.mentionDropdown}>
        <div className={styles.mentionHeader}>
          <button
            type="button"
            className={styles.mentionBackButton}
            onMouseDown={(e) => {
              e.preventDefault();
              justClickedInsideRef.current = true;
              handleBack();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <title>Go back</title>
              <path
                fillRule="evenodd"
                d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"
              />
            </svg>
          </button>
          {breadcrumb}
        </div>
        <div className={styles.mentionList}>
          {isLoadingBlocks ? (
            <div className={styles.mentionEmpty}>Loading fields...</div>
          ) : currentNestedFields.length === 0 ? (
            <div className={styles.mentionEmpty}>No fields in this block</div>
          ) : (
            currentNestedFields.map((field, index) => {
              const hasMultipleLocales =
                field.availableLocales && field.availableLocales.length > 1;
              const isBlockContainer = field.isBlockContainer;

              return (
                <button
                  key={field.fieldPath}
                  ref={index === localSelectedIndex ? selectedRef : null}
                  type="button"
                  className={`${styles.mentionOption} ${index === localSelectedIndex ? styles.mentionOptionSelected : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    justClickedInsideRef.current = true;
                    handleFieldClick(field);
                  }}
                  onMouseEnter={() => setLocalSelectedIndex(index)}
                >
                  <span className={styles.mentionFieldLabel}>{field.label}</span>
                  <span className={styles.mentionFieldMeta}>
                    {isBlockContainer && (
                      <span className={styles.mentionBlockIndicator} title="Contains blocks">
                        ▶
                      </span>
                    )}
                    {hasMultipleLocales && (
                      <span
                        className={styles.mentionLocaleIndicator}
                        title="Multiple locales available"
                      >
                        {field.availableLocales?.length}
                      </span>
                    )}
                    <span className={styles.mentionFieldApiKey}>#{field.apiKey}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // Default: Field list view
  return (
    <div ref={dropdownRef} className={styles.mentionDropdown}>
      <div className={styles.mentionHeader}>Fields</div>
      <div className={styles.mentionList}>
        {fields.map((field, index) => {
          const isNested = field.depth > 0;
          const hasMultipleLocales =
            field.availableLocales && field.availableLocales.length > 1;
          const isBlockContainer = field.isBlockContainer;

          return (
            <button
              key={field.fieldPath}
              ref={index === selectedIndex ? selectedRef : null}
              type="button"
              className={`${styles.mentionOption} ${index === selectedIndex ? styles.mentionOptionSelected : ''}`}
              style={{ paddingLeft: `${8 + field.depth * 12}px` }}
              onMouseDown={(e) => {
                e.preventDefault();
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
                {isBlockContainer && (
                  <span className={styles.mentionBlockIndicator} title="Contains blocks">
                    ▶
                  </span>
                )}
                {hasMultipleLocales && (
                  <span
                    className={styles.mentionLocaleIndicator}
                    title="Multiple locales available"
                  >
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
