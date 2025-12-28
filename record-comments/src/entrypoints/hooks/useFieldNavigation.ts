import { useEffect, useState, useCallback, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import type { FieldInfo } from './useMentions';
import type { BlockInfo } from '@ctypes/mentions';
import {
  getBlocksForField,
  getFieldsForBlock,
  getBlockAttributesAtPath,
} from '@utils/fieldLoader';

// Navigation step types for the drill-down stack
export type NavigationStep =
  | { type: 'field'; field: FieldInfo }
  | { type: 'locale'; locale: string }
  | { type: 'block'; blockIndex: number; blockModelId: string; blockModelName: string };

// ============================================
// Pure helper functions (extracted for performance)
// ============================================

/** Get the current field from navigation stack (the last field step) */
function getCurrentField(stack: NavigationStep[]): FieldInfo | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const step = stack[i];
    if (step.type === 'field') {
      return step.field;
    }
  }
  return null;
}

/** Get the selected locale from navigation stack */
function getSelectedLocale(stack: NavigationStep[]): string | undefined {
  for (const step of stack) {
    if (step.type === 'locale') {
      return step.locale;
    }
  }
  return undefined;
}

/** Build the current field path from the navigation stack */
function buildFieldPath(stack: NavigationStep[]): string {
  let path = '';
  let lastField: FieldInfo | null = null;

  for (const step of stack) {
    if (step.type === 'field') {
      path = step.field.fieldPath;
      lastField = step.field;
    } else if (step.type === 'locale') {
      path = `${path}.${step.locale}`;
    } else if (step.type === 'block') {
      if (lastField?.blockFieldType !== 'single_block') {
        path = `${path}.${step.blockIndex}`;
      }
    }
  }
  return path;
}

/** Determine current view mode based on navigation stack */
function getCurrentViewMode(stack: NavigationStep[]): ViewMode {
  if (stack.length === 0) {
    return 'fields';
  }

  const lastStep = stack[stack.length - 1];

  if (lastStep.type === 'block') {
    return 'nestedFields';
  }

  if (lastStep.type === 'locale') {
    const field = getCurrentField(stack);
    if (field?.isBlockContainer) {
      return 'blocks';
    }
    return 'fields';
  }

  if (lastStep.type === 'field') {
    const field = lastStep.field;
    if (field.localized && field.availableLocales && field.availableLocales.length > 1) {
      return 'locales';
    }
    if (field.isBlockContainer) {
      return 'blocks';
    }
    return 'fields';
  }

  return 'fields';
}

/** Build breadcrumb for header */
function buildBreadcrumb(stack: NavigationStep[]): string {
  const parts: string[] = [];
  for (const step of stack) {
    if (step.type === 'field') {
      parts.push(step.field.label);
    } else if (step.type === 'locale') {
      parts.push(`(${step.locale.toUpperCase()})`);
    } else if (step.type === 'block') {
      parts.push(`${step.blockModelName} #${step.blockIndex + 1}`);
    }
  }
  return parts.join(' > ');
}

/** Helper for keyboard navigation in list views */
function handleListKeyNav(
  key: string,
  setIndex: Dispatch<SetStateAction<number>>,
  maxIndex: number,
  onSelect: () => void,
  onBack: () => void
): boolean {
  switch (key) {
    case 'ArrowDown':
      setIndex((prev) => (prev < maxIndex ? prev + 1 : prev));
      return true;
    case 'ArrowUp':
      setIndex((prev) => (prev > 0 ? prev - 1 : prev));
      return true;
    case 'Enter':
    case 'Tab':
      onSelect();
      return true;
    case 'Escape':
    case 'Backspace':
      onBack();
      return true;
    default:
      return true;
  }
}

export type ViewMode = 'fields' | 'locales' | 'blocks' | 'nestedFields';

type UseFieldNavigationParams = {
  ctx?: RenderItemFormSidebarCtx;
  onSelect: (field: FieldInfo, locale?: string) => void;
  pendingFieldForLocale?: FieldInfo | null;
  onClearPendingField?: () => void;
  selectedIndex: number; // From parent for keyboard-driven locale picker
};

type UseFieldNavigationReturn = {
  // State
  navigationStack: NavigationStep[];
  localSelectedIndex: number;
  setLocalSelectedIndex: (index: number) => void;
  currentBlocks: BlockInfo[];
  currentNestedFields: FieldInfo[];
  isLoadingBlocks: boolean;

  // Computed
  viewMode: ViewMode;
  currentField: FieldInfo | null;
  selectedLocale: string | undefined;
  breadcrumb: string;

  // Actions
  handleBack: () => void;
  handleFieldClick: (field: FieldInfo) => void;
  handleLocaleClick: (locale: string) => void;
  handleBlockClick: (block: BlockInfo) => void;
  handleSelectEntireField: () => void;
  handleKeyboardNavigation: (key: string) => boolean;
  handlePendingLocaleSelection: (locale: string) => void;
  resetNavigation: () => void;
};

export function useFieldNavigation({
  ctx,
  onSelect,
  pendingFieldForLocale,
  onClearPendingField,
  selectedIndex,
}: UseFieldNavigationParams): UseFieldNavigationReturn {
  // Navigation stack for drill-down
  const [navigationStack, setNavigationStack] = useState<NavigationStep[]>([]);
  const [localSelectedIndex, setLocalSelectedIndex] = useState(0);

  // Current view state derived from navigation stack
  const [currentBlocks, setCurrentBlocks] = useState<BlockInfo[]>([]);
  const [currentNestedFields, setCurrentNestedFields] = useState<FieldInfo[]>([]);
  const [isLoadingBlocks, setIsLoadingBlocks] = useState(false);

  // Sequence number to prevent stale async updates
  const loadOperationRef = useRef(0);

  // Derive values from navigation stack using pure functions (memoized for performance)
  const viewMode = useMemo(() => getCurrentViewMode(navigationStack), [navigationStack]);
  const currentField = useMemo(() => getCurrentField(navigationStack), [navigationStack]);
  const selectedLocale = useMemo(() => getSelectedLocale(navigationStack), [navigationStack]);
  const breadcrumb = useMemo(() => buildBreadcrumb(navigationStack), [navigationStack]);

  // Auto-navigate for single_block fields
  useEffect(() => {
    if (viewMode !== 'blocks') return;
    if (currentField?.blockFieldType !== 'single_block') return;
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
  }, [currentBlocks, currentField, viewMode]);

  // Load blocks when we reach the blocks view
  useEffect(() => {
    if (viewMode !== 'blocks' || !ctx) {
      setCurrentBlocks([]);
      return;
    }

    if (!currentField?.isBlockContainer || !currentField.blockFieldType) {
      setCurrentBlocks([]);
      return;
    }

    setIsLoadingBlocks(true);
    const blocks = getBlocksForField(ctx, currentField.fieldPath, currentField.blockFieldType, selectedLocale);
    setCurrentBlocks(blocks);
    setLocalSelectedIndex(0);
    setIsLoadingBlocks(false);
  }, [navigationStack, ctx, currentField, viewMode, selectedLocale]);

  // Load nested fields when inside a block
  //
  // ASYNC CLEANUP NOTE:
  // We use an isMounted flag + operation counter pattern instead of AbortController because:
  // 1. The DatoCMS Plugin SDK methods don't accept AbortSignals
  // 2. The underlying fetch requests can't be cancelled
  // 3. The isMounted + operation counter pattern effectively prevents:
  //    - State updates after unmount (memory safety)
  //    - Stale async results from overwriting newer data (race condition safety)
  // This is the recommended pattern when AbortController isn't supported by the underlying API.
  useEffect(() => {
    if (viewMode !== 'nestedFields' || !ctx) {
      setCurrentNestedFields([]);
      return;
    }

    // Track if component is mounted to prevent state updates after unmount
    let isMounted = true;

    const loadNestedFields = async () => {
      // Capture current operation sequence to detect stale updates
      const currentOperation = ++loadOperationRef.current;

      setIsLoadingBlocks(true);

      let lastBlockStep: NavigationStep | null = null;
      for (let i = navigationStack.length - 1; i >= 0; i--) {
        if (navigationStack[i].type === 'block') {
          lastBlockStep = navigationStack[i];
          break;
        }
      }

      if (!lastBlockStep || lastBlockStep.type !== 'block') {
        // Don't update state if component unmounted or operation is stale
        if (!isMounted || loadOperationRef.current !== currentOperation) return;
        setCurrentNestedFields([]);
        setIsLoadingBlocks(false);
        return;
      }

      if (!currentField?.blockFieldType) {
        // Don't update state if component unmounted or operation is stale
        if (!isMounted || loadOperationRef.current !== currentOperation) return;
        setCurrentNestedFields([]);
        setIsLoadingBlocks(false);
        return;
      }

      const blockAttrs = getBlockAttributesAtPath(
        ctx,
        currentField.fieldPath,
        lastBlockStep.blockIndex,
        currentField.blockFieldType,
        selectedLocale
      );

      let basePath = currentField.fieldPath;
      if (currentField.blockFieldType !== 'single_block') {
        basePath = `${basePath}.${lastBlockStep.blockIndex}`;
      }

      const nestedFields = await getFieldsForBlock(
        ctx,
        lastBlockStep.blockModelId,
        blockAttrs,
        basePath
      );

      // Don't update state if component unmounted or operation is stale
      if (!isMounted || loadOperationRef.current !== currentOperation) return;

      setCurrentNestedFields(nestedFields);
      setLocalSelectedIndex(0);
      setIsLoadingBlocks(false);
    };

    loadNestedFields();

    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
    };
  }, [navigationStack, ctx, currentField, viewMode, selectedLocale]);

  // Handle non-localized block container from keyboard navigation
  useEffect(() => {
    if (pendingFieldForLocale?.isBlockContainer && !pendingFieldForLocale.localized && navigationStack.length === 0) {
      setNavigationStack([{ type: 'field', field: pendingFieldForLocale }]);
      setLocalSelectedIndex(0);
      onClearPendingField?.();
    }
  }, [pendingFieldForLocale, navigationStack.length, onClearPendingField]);

  // Actions
  const handleBack = useCallback(() => {
    if (navigationStack.length > 0) {
      setNavigationStack((prev) => prev.slice(0, -1));
      setLocalSelectedIndex(0);
    }
    onClearPendingField?.();
  }, [navigationStack.length, onClearPendingField]);

  const handleFieldClick = useCallback((field: FieldInfo) => {
    if (field.isBlockContainer) {
      setNavigationStack((prev) => [...prev, { type: 'field', field }]);
      setLocalSelectedIndex(0);
      return;
    }

    if (field.localized && field.availableLocales && field.availableLocales.length > 1) {
      setNavigationStack((prev) => [...prev, { type: 'field', field }]);
      setLocalSelectedIndex(0);
      return;
    }

    const currentPath = buildFieldPath(navigationStack);
    const finalPath = currentPath ? `${currentPath}.${field.apiKey}` : field.fieldPath;

    const finalField: FieldInfo = {
      ...field,
      fieldPath: finalPath,
      localized: field.localized || !!selectedLocale,
    };

    onSelect(finalField, selectedLocale);
    setNavigationStack([]);
  }, [navigationStack, selectedLocale, onSelect]);

  const handleLocaleClick = useCallback((locale: string) => {
    if (currentField?.isBlockContainer) {
      setNavigationStack((prev) => [...prev, { type: 'locale', locale }]);
      setLocalSelectedIndex(0);
    } else if (currentField) {
      onSelect(currentField, locale);
      setNavigationStack([]);
    }
  }, [currentField, onSelect]);

  const handleSelectEntireField = useCallback(() => {
    if (!currentField) return;

    onSelect(currentField, selectedLocale);
    setNavigationStack([]);
  }, [currentField, selectedLocale, onSelect]);

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

  const handlePendingLocaleSelection = useCallback((locale: string) => {
    if (!pendingFieldForLocale) return;

    if (pendingFieldForLocale.isBlockContainer) {
      setNavigationStack([
        { type: 'field', field: pendingFieldForLocale },
        { type: 'locale', locale },
      ]);
      setLocalSelectedIndex(0);
      onClearPendingField?.();
    } else {
      onSelect(pendingFieldForLocale, locale);
      onClearPendingField?.();
    }
  }, [pendingFieldForLocale, onSelect, onClearPendingField]);

  const resetNavigation = useCallback(() => {
    loadOperationRef.current++; // Invalidate in-flight operations
    setNavigationStack([]);
    setLocalSelectedIndex(0);
  }, []);

  // Keyboard navigation handler
  const handleKeyboardNavigation = useCallback((key: string): boolean => {
    // Handle keyboard-driven locale picker (pendingFieldForLocale mode)
    if (pendingFieldForLocale?.availableLocales && navigationStack.length === 0) {
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        return false; // Let parent handle arrow navigation
      }
      if (key === 'Enter' || key === 'Tab') {
        const locale = pendingFieldForLocale.availableLocales[selectedIndex];
        if (locale) {
          handlePendingLocaleSelection(locale);
        }
        return true;
      }
      if (key === 'Escape') {
        onClearPendingField?.();
        return true;
      }
      return false;
    }

    // Handle keyboard navigation for blocks view
    if (viewMode === 'blocks') {
      return handleListKeyNav(
        key,
        setLocalSelectedIndex,
        currentBlocks.length, // +1 for "entire field" option at index 0
        () => {
          if (localSelectedIndex === 0) {
            handleSelectEntireField();
          } else if (localSelectedIndex - 1 < currentBlocks.length) {
            handleBlockClick(currentBlocks[localSelectedIndex - 1]);
          }
        },
        handleBack
      );
    }

    // Handle keyboard navigation for nested fields view
    if (viewMode === 'nestedFields') {
      return handleListKeyNav(
        key,
        setLocalSelectedIndex,
        currentNestedFields.length - 1,
        () => {
          if (localSelectedIndex < currentNestedFields.length) {
            handleFieldClick(currentNestedFields[localSelectedIndex]);
          }
        },
        handleBack
      );
    }

    // Handle keyboard navigation for locale picker (within drill-down)
    if (viewMode === 'locales' && currentField?.availableLocales) {
      return handleListKeyNav(
        key,
        setLocalSelectedIndex,
        currentField.availableLocales.length - 1,
        () => {
          if (localSelectedIndex < currentField.availableLocales!.length) {
            handleLocaleClick(currentField.availableLocales![localSelectedIndex]);
          }
        },
        handleBack
      );
    }

    return false;
  }, [
    viewMode, localSelectedIndex, currentBlocks, currentNestedFields, currentField,
    handleSelectEntireField, handleBlockClick, handleFieldClick, handleLocaleClick, handleBack,
    pendingFieldForLocale, navigationStack, selectedIndex, onClearPendingField, handlePendingLocaleSelection
  ]);

  return {
    navigationStack,
    localSelectedIndex,
    setLocalSelectedIndex,
    currentBlocks,
    currentNestedFields,
    isLoadingBlocks,
    viewMode,
    currentField,
    selectedLocale,
    breadcrumb,
    handleBack,
    handleFieldClick,
    handleLocaleClick,
    handleBlockClick,
    handleSelectEntireField,
    handleKeyboardNavigation,
    handlePendingLocaleSelection,
    resetNavigation,
  };
}
