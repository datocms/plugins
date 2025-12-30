import { useCallback, useRef, useEffect } from 'react';
import type { UserInfo, FieldInfo, ModelInfo } from './useMentionFiltering';

type UseMentionKeyboardOptions = {
  activeDropdown: 'user' | 'field' | 'model' | 'asset' | 'record' | null;
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  setCursorPosition: (pos: number) => void;
  filteredUsers: UserInfo[];
  filteredFields: FieldInfo[];
  filteredModels: ModelInfo[];
  pendingFieldForLocale: FieldInfo | null;
  setPendingFieldForLocale: React.Dispatch<React.SetStateAction<FieldInfo | null>>;
  handleSelectUser: (user: UserInfo) => void;
  handleSelectField: (field: FieldInfo, locale?: string) => void;
  handleSelectModel: (model: ModelInfo) => void;
  closeDropdown: () => void;
};

type UseMentionKeyboardReturn = {
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  registerDropdownKeyHandler: (handler: (key: string) => boolean) => void;
};

export function useMentionKeyboard({
  activeDropdown,
  selectedIndex,
  setSelectedIndex,
  setCursorPosition,
  filteredUsers,
  filteredFields,
  filteredModels,
  pendingFieldForLocale,
  setPendingFieldForLocale,
  handleSelectUser,
  handleSelectField,
  handleSelectModel,
  closeDropdown,
}: UseMentionKeyboardOptions): UseMentionKeyboardReturn {
  const dropdownKeyHandlerRef = useRef<((key: string) => boolean) | null>(null);

  // Single-timer pattern: each new timer clears previous to prevent accumulation
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, []);

  const registerDropdownKeyHandler = useCallback((handler: (key: string) => boolean) => {
    dropdownKeyHandlerRef.current = handler;
  }, []);

  // Dependencies include full arrays (not .length) to prevent stale closure issues
  const getCurrentListLength = useCallback(() => {
    if (pendingFieldForLocale) {
      return pendingFieldForLocale.availableLocales?.length ?? 0;
    }
    if (activeDropdown === 'user') return filteredUsers.length;
    if (activeDropdown === 'field') return filteredFields.length;
    if (activeDropdown === 'model') return filteredModels.length;
    return 0;
  }, [pendingFieldForLocale, activeDropdown, filteredUsers, filteredFields, filteredModels]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const target = e.currentTarget;
      const currentListLength = getCurrentListLength();

      if (!activeDropdown) {
        if (pendingTimerRef.current !== null) {
          clearTimeout(pendingTimerRef.current);
        }
        pendingTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setCursorPosition(target.selectionStart);
          }
          pendingTimerRef.current = null;
        }, 0);
        return false;
      }

      if (dropdownKeyHandlerRef.current) {
        const handled = dropdownKeyHandlerRef.current(e.key);
        if (handled) {
          e.preventDefault();
          return true;
        }
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < currentListLength - 1 ? prev + 1 : prev
          );
          return true;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          return true;

        case 'Enter':
        case 'Tab': {
          if (pendingFieldForLocale?.availableLocales) {
            e.preventDefault();
            const selectedLocale = pendingFieldForLocale.availableLocales[selectedIndex];
            handleSelectField(pendingFieldForLocale, selectedLocale);
            setPendingFieldForLocale(null);
            return true;
          }

          if (currentListLength > 0) {
            e.preventDefault();
            if (activeDropdown === 'user') {
              handleSelectUser(filteredUsers[selectedIndex]);
            } else if (activeDropdown === 'field') {
              const field = filteredFields[selectedIndex];
              if (field.isBlockContainer || (field.localized && field.availableLocales && field.availableLocales.length > 1)) {
                setPendingFieldForLocale(field);
                setSelectedIndex(0);
              } else if (field.localized && field.availableLocales?.length === 1) {
                handleSelectField(field, field.availableLocales[0]);
              } else {
                handleSelectField(field);
              }
            } else if (activeDropdown === 'model') {
              handleSelectModel(filteredModels[selectedIndex]);
            }
            return true;
          }
          return false;
        }

        case 'Escape':
          e.preventDefault();
          if (pendingFieldForLocale) {
            setPendingFieldForLocale(null);
            setSelectedIndex(0);
          } else {
            closeDropdown();
          }
          return true;

        default:
          if (pendingTimerRef.current !== null) {
            clearTimeout(pendingTimerRef.current);
          }
          pendingTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              setCursorPosition(target.selectionStart);
            }
            pendingTimerRef.current = null;
          }, 0);
          return false;
      }
    },
    [
      activeDropdown,
      getCurrentListLength,
      filteredUsers,
      filteredFields,
      filteredModels,
      selectedIndex,
      setSelectedIndex,
      setCursorPosition,
      handleSelectUser,
      handleSelectField,
      handleSelectModel,
      closeDropdown,
      pendingFieldForLocale,
      setPendingFieldForLocale,
    ]
  );

  return {
    handleKeyDown,
    registerDropdownKeyHandler,
  };
}
