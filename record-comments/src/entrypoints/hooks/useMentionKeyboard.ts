import { useCallback, useRef, useEffect } from 'react';
import type { UserInfo, FieldInfo, ModelInfo } from './useMentionFiltering';

/**
 * ============================================================================
 * ARCHITECTURAL NOTE: HOOK COMPLEXITY JUSTIFICATION
 * ============================================================================
 *
 * This hook has a large dependency array (13 items) and handles keyboard
 * navigation for multiple dropdown types. This complexity was flagged in a
 * code review, but splitting it would NOT improve maintainability. Here's why:
 *
 * WHY SPLITTING WON'T HELP:
 * 1. Keyboard handling is INHERENTLY SHARED logic:
 *    - ArrowUp/ArrowDown/Escape work identically across all dropdown types
 *    - Only Enter/Tab differs based on `activeDropdown`
 *    - Splitting by dropdown type would duplicate 80% of the logic
 *
 * 2. Dependencies are UNAVOIDABLY interconnected:
 *    - `selectedIndex` and `setSelectedIndex` must be shared (single selection)
 *    - `pendingFieldForLocale` creates a sub-state within field dropdown
 *    - Escape key must know about both pending state AND dropdown state
 *
 * 3. Alternatives considered and rejected:
 *    - Switch-case per dropdown: Same dependencies, just nested differently
 *    - Separate hooks per dropdown: Would require prop drilling the ref handler
 *    - Strategy pattern: Over-engineered for 3 dropdown types
 *
 * ACCEPTABLE TRADEOFFS:
 * - Large dependency array is explicit about what triggers re-creation
 * - Single switch statement is readable and testable
 * - All keyboard logic is colocated for debugging
 *
 * IF YOU NEED TO MODIFY THIS HOOK:
 * - Test all dropdown types (user, field, model) after changes
 * - Test locale selection sub-flow in field dropdown
 * - Test Escape behavior in both normal and pending states
 *
 * ============================================================================
 */

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

/**
 * Hook for handling keyboard navigation in mention dropdowns.
 * Supports ArrowUp, ArrowDown, Enter, Tab, and Escape keys.
 */
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
  // Ref to store the dropdown's keyboard handler for drill-down navigation
  const dropdownKeyHandlerRef = useRef<((key: string) => boolean) | null>(null);

  // Ref to track pending setTimeout calls for cleanup.
  //
  // TIMER MANAGEMENT PATTERN:
  // -------------------------
  // This hook uses a single-timer pattern to debounce cursor position updates.
  // Each new timer clears the previous one before scheduling, preventing accumulation:
  //
  //   if (pendingTimerRef.current !== null) {
  //     clearTimeout(pendingTimerRef.current);  // Clear previous
  //   }
  //   pendingTimerRef.current = setTimeout(...);  // Schedule new
  //
  // This pattern appears in two places (no-dropdown case and default switch case)
  // because they handle different code paths, but both use the same ref, ensuring
  // only ONE timer is ever pending at any time.
  //
  // Memory leak prevention:
  // - Timers are cleared before scheduling new ones (prevents accumulation)
  // - Cleanup effect clears any pending timer on unmount
  // - isMountedRef prevents state updates after unmount
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount: clear any pending timer and mark as unmounted
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, []);

  // Function to register the dropdown's keyboard handler
  const registerDropdownKeyHandler = useCallback((handler: (key: string) => boolean) => {
    dropdownKeyHandlerRef.current = handler;
  }, []);

  // Get the current list length for keyboard navigation
  // When in locale selection mode, use the locale list length
  //
  // NOTE: Dependencies include full array references (not just .length) to ensure
  // the callback updates when array contents change even if length stays the same.
  // This prevents stale closure issues where the callback sees outdated data.
  const getCurrentListLength = useCallback(() => {
    if (pendingFieldForLocale) {
      return pendingFieldForLocale.availableLocales?.length ?? 0;
    }
    if (activeDropdown === 'user') return filteredUsers.length;
    if (activeDropdown === 'field') return filteredFields.length;
    if (activeDropdown === 'model') return filteredModels.length;
    return 0;
  }, [pendingFieldForLocale, activeDropdown, filteredUsers, filteredFields, filteredModels]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const target = e.currentTarget;
      const currentListLength = getCurrentListLength();

      // If no dropdown is open, don't intercept
      if (!activeDropdown) {
        // Clear any pending timer before scheduling a new one
        if (pendingTimerRef.current !== null) {
          clearTimeout(pendingTimerRef.current);
        }
        pendingTimerRef.current = setTimeout(() => {
          // Guard: only update if component is still mounted
          if (isMountedRef.current) {
            setCursorPosition(target.selectionStart);
          }
          pendingTimerRef.current = null;
        }, 0);
        return false;
      }

      // First, check if the dropdown wants to handle this key (for drill-down navigation)
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
          // Handle locale selection mode
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
              // For block container fields or localized fields with multiple locales, show picker
              if (field.isBlockContainer || (field.localized && field.availableLocales && field.availableLocales.length > 1)) {
                setPendingFieldForLocale(field);
                setSelectedIndex(0);
              } else if (field.localized && field.availableLocales?.length === 1) {
                // Only one locale - auto-select it
                handleSelectField(field, field.availableLocales[0]);
              } else {
                // Non-localized field
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
          // If in locale selection, go back to field list
          if (pendingFieldForLocale) {
            setPendingFieldForLocale(null);
            setSelectedIndex(0);
          } else {
            closeDropdown();
          }
          return true;

        default:
          // Clear any pending timer before scheduling a new one
          if (pendingTimerRef.current !== null) {
            clearTimeout(pendingTimerRef.current);
          }
          pendingTimerRef.current = setTimeout(() => {
            // Guard: only update if component is still mounted
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
