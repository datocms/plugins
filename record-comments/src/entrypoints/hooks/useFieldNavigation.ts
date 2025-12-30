import { useEffect, useState, useCallback, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import type { FieldInfo } from './useMentions';
import type { BlockInfo } from '@ctypes/mentions';
import {
  getBlocksForField,
  getFieldsForBlock,
  getBlockAttributesAtPath,
} from '@utils/fieldLoader';

export type NavigationStep =
  | { type: 'field'; field: FieldInfo }
  | { type: 'locale'; locale: string }
  | { type: 'block'; blockIndex: number; blockModelId: string; blockModelName: string };

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
  for (const step of stack) {
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

function handleListKeyNav(
  key: string,
  setIndex: Dispatch<SetStateAction<number>>,
  listLength: number,
  onSelect: () => void,
  onBack: () => void
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
      return true;
  }
}

export type ViewMode = 'fields' | 'locales' | 'blocks' | 'nestedFields';

type UseFieldNavigationParams = {
  ctx?: RenderItemFormSidebarCtx;
  onSelect: (field: FieldInfo, locale?: string) => void;
  pendingFieldForLocale?: FieldInfo | null;
  onClearPendingField?: () => void;
  selectedIndex: number;
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
  const [navigationStack, setNavigationStack] = useState<NavigationStep[]>([]);
  const [localSelectedIndex, setLocalSelectedIndex] = useState(0);

  const [currentBlocks, setCurrentBlocks] = useState<BlockInfo[]>([]);
  const [currentNestedFields, setCurrentNestedFields] = useState<FieldInfo[]>([]);
  const [isLoadingBlocks, setIsLoadingBlocks] = useState(false);

  const loadOperationRef = useRef(0);

  const viewMode = useMemo(() => getCurrentViewMode(navigationStack), [navigationStack]);
  const currentField = useMemo(() => getCurrentField(navigationStack), [navigationStack]);
  const selectedLocale = useMemo(() => getSelectedLocale(navigationStack), [navigationStack]);
  const breadcrumb = useMemo(() => buildBreadcrumb(navigationStack), [navigationStack]);

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
    const blocks = getBlocksForField(ctx, currentField.fieldPath, currentField.blockFieldType, selectedLocale);
    setCurrentBlocks(blocks);
    setLocalSelectedIndex(0);
    setIsLoadingBlocks(false);
  }, [navigationStack, ctx, currentField, viewMode, selectedLocale]);

  useEffect(() => {
    if (viewMode !== 'nestedFields' || !ctx) {
      setCurrentNestedFields([]);
      return;
    }

    let isMounted = true;

    const loadNestedFields = async () => {
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
        if (!isMounted || loadOperationRef.current !== currentOperation) return;
        setCurrentNestedFields([]);
        setIsLoadingBlocks(false);
        return;
      }

      if (!currentField?.blockFieldType) {
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

      if (!isMounted || loadOperationRef.current !== currentOperation) return;

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
    if (pendingFieldForLocale?.isBlockContainer && !pendingFieldForLocale.localized && navigationStack.length === 0) {
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
    loadOperationRef.current++;
    setNavigationStack([]);
    setLocalSelectedIndex(0);
  }, []);

  useEffect(() => {
    if (pendingFieldForLocale?.availableLocales && navigationStack.length === 0) {
      setLocalSelectedIndex(0);
    }
  }, [pendingFieldForLocale, navigationStack.length]);

  const handleKeyboardNavigation = useCallback((key: string): boolean => {
    if (pendingFieldForLocale?.availableLocales && navigationStack.length === 0) {
      const localesLength = pendingFieldForLocale.availableLocales.length;

      if (key === 'ArrowDown') {
        if (localesLength > 0) {
          setLocalSelectedIndex((prev) => (prev + 1) % localesLength);
        }
        return true;
      }
      if (key === 'ArrowUp') {
        if (localesLength > 0) {
          setLocalSelectedIndex((prev) => (prev - 1 + localesLength) % localesLength);
        }
        return true;
      }
      if (key === 'Enter' || key === 'Tab') {
        const locale = pendingFieldForLocale.availableLocales[localSelectedIndex];
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
        handleBack
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
        handleBack
      );
    }

    if (viewMode === 'locales' && currentField?.availableLocales) {
      return handleListKeyNav(
        key,
        setLocalSelectedIndex,
        currentField.availableLocales.length,
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
