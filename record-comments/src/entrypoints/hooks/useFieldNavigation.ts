import type { BlockInfo } from '@ctypes/mentions';
import {
  getBlockAttributesAtPath,
  getBlocksForField,
  getFieldsForBlock,
} from '@utils/fieldLoader';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FieldInfo } from './useMentions';

export type NavigationStep =
  | { type: 'field'; field: FieldInfo }
  | { type: 'locale'; locale: string }
  | {
      type: 'block';
      blockIndex: number;
      blockModelId: string;
      blockModelName: string;
    };

function getCurrentField(stack: NavigationStep[]): FieldInfo | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const step = stack[i];
    if (step.type === 'field') {
      return step.field;
    }
  }
  return null;
}

function getSelectedLocale(stack: NavigationStep[]): string | undefined {
  // Return the MOST RECENT locale in the stack (iterate in reverse)
  // This is important for nested localized fields where each level has its own locale
  for (let i = stack.length - 1; i >= 0; i--) {
    const step = stack[i];
    if (step.type === 'locale') {
      return step.locale;
    }
  }
  return undefined;
}

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
    if (
      field.localized &&
      field.availableLocales &&
      field.availableLocales.length > 1
    ) {
      return 'locales';
    }
    if (field.isBlockContainer) {
      return 'blocks';
    }
    return 'fields';
  }

  return 'fields';
}

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

export function handleListKeyNav(
  key: string,
  setIndex: Dispatch<SetStateAction<number>>,
  listLength: number,
  onSelect: () => void,
  onBack: () => void,
): boolean {
  switch (key) {
    case 'ArrowDown':
      if (listLength > 0) {
        setIndex((prev) => (prev + 1) % listLength);
      }
      return true;
    case 'ArrowUp':
      if (listLength > 0) {
        setIndex((prev) => (prev - 1 + listLength) % listLength);
      }
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
      return false;
  }
}

type ViewMode = 'fields' | 'locales' | 'blocks' | 'nestedFields';

type UseFieldNavigationParams = {
  ctx?: RenderItemFormSidebarCtx;
  onSelect: (field: FieldInfo, locale?: string) => void;
  pendingFieldForLocale?: FieldInfo | null;
  onClearPendingField?: () => void;
  selectedIndex: number;
  /** Called when field navigation path changes (for updating editor preview) */
  onPathChange?: (path: string) => void;
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
  selectedIndex: _selectedIndex,
  onPathChange,
}: UseFieldNavigationParams): UseFieldNavigationReturn {
  const [navigationStack, setNavigationStack] = useState<NavigationStep[]>([]);
  const [localSelectedIndex, setLocalSelectedIndex] = useState(0);

  const [currentBlocks, setCurrentBlocks] = useState<BlockInfo[]>([]);
  const [currentNestedFields, setCurrentNestedFields] = useState<FieldInfo[]>(
    [],
  );
  const [isLoadingBlocks, setIsLoadingBlocks] = useState(false);

  const loadOperationRef = useRef(0);

  const viewMode = useMemo(
    () => getCurrentViewMode(navigationStack),
    [navigationStack],
  );
  const currentField = useMemo(
    () => getCurrentField(navigationStack),
    [navigationStack],
  );
  const selectedLocale = useMemo(
    () => getSelectedLocale(navigationStack),
    [navigationStack],
  );
  const breadcrumb = useMemo(
    () => buildBreadcrumb(navigationStack),
    [navigationStack],
  );

  // Notify parent when navigation path changes (for editor text preview)
  const onPathChangeRef = useRef(onPathChange);
  onPathChangeRef.current = onPathChange;

  useEffect(() => {
    onPathChangeRef.current?.(breadcrumb);
  }, [breadcrumb]);

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
    const blocks = getBlocksForField(
      ctx,
      currentField.fieldPath,
      currentField.blockFieldType,
      selectedLocale,
    );
    setCurrentBlocks(blocks);
    setLocalSelectedIndex(0);
    setIsLoadingBlocks(false);
  }, [ctx, currentField, viewMode, selectedLocale]);

  useEffect(() => {
    if (viewMode !== 'nestedFields' || !ctx) {
      setCurrentNestedFields([]);
      return;
    }

    let isMounted = true;

    const findLastBlockStep = (
      stack: NavigationStep[],
    ): Extract<NavigationStep, { type: 'block' }> | null => {
      for (let i = stack.length - 1; i >= 0; i--) {
        const step = stack[i];
        if (step.type === 'block') {
          return step;
        }
      }
      return null;
    };

    const isOperationCurrent = (op: number) =>
      isMounted && loadOperationRef.current === op;

    const setEmptyNestedFields = () => {
      setCurrentNestedFields([]);
      setIsLoadingBlocks(false);
    };

    const loadNestedFields = async () => {
      const currentOperation = ++loadOperationRef.current;

      setIsLoadingBlocks(true);

      const lastBlockStep = findLastBlockStep(navigationStack);
      const blockFieldType = currentField?.blockFieldType;

      if (!lastBlockStep || !blockFieldType) {
        if (!isOperationCurrent(currentOperation)) return;
        setEmptyNestedFields();
        return;
      }

      const blockAttrs = getBlockAttributesAtPath(
        ctx,
        currentField.fieldPath,
        lastBlockStep.blockIndex,
        blockFieldType,
        selectedLocale,
      );

      // Use buildFieldPath to get the full path including locales
      // This handles nested localized fields correctly (e.g., "content.en.0" instead of "content.0")
      const basePath = buildFieldPath(navigationStack);

      const nestedFields = await getFieldsForBlock(
        ctx,
        lastBlockStep.blockModelId,
        blockAttrs,
        basePath,
      );

      if (!isOperationCurrent(currentOperation)) return;

      setCurrentNestedFields(nestedFields);
      setLocalSelectedIndex(0);
      setIsLoadingBlocks(false);
    };

    loadNestedFields();

    return () => {
      isMounted = false;
    };
  }, [navigationStack, ctx, currentField, viewMode, selectedLocale]);

  useEffect(() => {
    if (
      pendingFieldForLocale?.isBlockContainer &&
      !pendingFieldForLocale.localized &&
      navigationStack.length === 0
    ) {
      setNavigationStack([{ type: 'field', field: pendingFieldForLocale }]);
      setLocalSelectedIndex(0);
      onClearPendingField?.();
    }
  }, [pendingFieldForLocale, navigationStack.length, onClearPendingField]);

  const handleBack = useCallback(() => {
    if (navigationStack.length > 0) {
      setNavigationStack((prev) => prev.slice(0, -1));
      setLocalSelectedIndex(0);
    }
    onClearPendingField?.();
  }, [navigationStack.length, onClearPendingField]);

  const handleFieldClick = useCallback(
    (field: FieldInfo) => {
      if (field.isBlockContainer) {
        setNavigationStack((prev) => [...prev, { type: 'field', field }]);
        setLocalSelectedIndex(0);
        return;
      }

      if (
        field.localized &&
        field.availableLocales &&
        field.availableLocales.length > 1
      ) {
        setNavigationStack((prev) => [...prev, { type: 'field', field }]);
        setLocalSelectedIndex(0);
        return;
      }

      const currentPath = buildFieldPath(navigationStack);
      const finalPath = currentPath
        ? `${currentPath}.${field.apiKey}`
        : field.fieldPath;

      const finalField: FieldInfo = {
        ...field,
        fieldPath: finalPath,
        localized: field.localized || !!selectedLocale,
      };

      onSelect(finalField, selectedLocale);
      setNavigationStack([]);
    },
    [navigationStack, selectedLocale, onSelect],
  );

  const handleLocaleClick = useCallback(
    (locale: string) => {
      if (currentField?.isBlockContainer) {
        setNavigationStack((prev) => [...prev, { type: 'locale', locale }]);
        setLocalSelectedIndex(0);
      } else if (currentField) {
        onSelect(currentField, locale);
        setNavigationStack([]);
      }
    },
    [currentField, onSelect],
  );

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

  const handlePendingLocaleSelection = useCallback(
    (locale: string) => {
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
    },
    [pendingFieldForLocale, onSelect, onClearPendingField],
  );

  const resetNavigation = useCallback(() => {
    loadOperationRef.current++;
    setNavigationStack([]);
    setLocalSelectedIndex(0);
  }, []);

  useEffect(() => {
    if (
      pendingFieldForLocale?.availableLocales &&
      navigationStack.length === 0
    ) {
      setLocalSelectedIndex(0);
    }
  }, [pendingFieldForLocale, navigationStack.length]);

  const handlePendingLocaleKeyNav = useCallback(
    (key: string, locales: string[]): boolean => {
      const selectCurrentLocale = () => {
        const locale = locales[localSelectedIndex];
        if (locale) {
          handlePendingLocaleSelection(locale);
        }
      };

      return handleListKeyNav(
        key,
        setLocalSelectedIndex,
        locales.length,
        selectCurrentLocale,
        () => onClearPendingField?.(),
      );
    },
    [localSelectedIndex, handlePendingLocaleSelection, onClearPendingField],
  );

  const handleViewModeKeyNav = useCallback(
    (key: string): boolean => {
      if (viewMode === 'blocks') {
        const totalItems = currentBlocks.length + 1;
        return handleListKeyNav(
          key,
          setLocalSelectedIndex,
          totalItems,
          () => {
            if (localSelectedIndex === 0) {
              handleSelectEntireField();
            } else {
              const blockIndex = localSelectedIndex - 1;
              if (blockIndex < currentBlocks.length) {
                handleBlockClick(currentBlocks[blockIndex]);
              }
            }
          },
          handleBack,
        );
      }

      if (viewMode === 'nestedFields') {
        return handleListKeyNav(
          key,
          setLocalSelectedIndex,
          currentNestedFields.length,
          () => {
            if (localSelectedIndex < currentNestedFields.length) {
              handleFieldClick(currentNestedFields[localSelectedIndex]);
            }
          },
          handleBack,
        );
      }

      if (viewMode === 'locales' && currentField?.availableLocales) {
        return handleListKeyNav(
          key,
          setLocalSelectedIndex,
          currentField.availableLocales.length,
          () => {
            if (localSelectedIndex < currentField.availableLocales?.length) {
              handleLocaleClick(
                currentField.availableLocales?.[localSelectedIndex],
              );
            }
          },
          handleBack,
        );
      }

      return false;
    },
    [
      viewMode,
      localSelectedIndex,
      currentBlocks,
      currentNestedFields,
      currentField,
      handleSelectEntireField,
      handleBlockClick,
      handleFieldClick,
      handleLocaleClick,
      handleBack,
    ],
  );

  const handleKeyboardNavigation = useCallback(
    (key: string): boolean => {
      if (
        pendingFieldForLocale?.availableLocales &&
        navigationStack.length === 0
      ) {
        return handlePendingLocaleKeyNav(
          key,
          pendingFieldForLocale.availableLocales,
        );
      }

      return handleViewModeKeyNav(key);
    },
    [
      pendingFieldForLocale,
      navigationStack.length,
      handlePendingLocaleKeyNav,
      handleViewModeKeyNav,
    ],
  );

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
