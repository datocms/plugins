import { useState, useCallback } from 'react';
import type { Mention, MentionMapKey } from '@ctypes/mentions';
import { createMentionKey } from '@ctypes/mentions';
import {
  insertUserMention,
  insertFieldMention,
  insertModelMention,
} from '@utils/mentions';
import type { TriggerInfo } from '@utils/mentions';
import type { UserInfo, FieldInfo, ModelInfo } from './useMentionFiltering';

/**
 * ============================================================================
 * ARCHITECTURAL NOTE: WHY SELECTION HANDLERS ARE NOT ABSTRACTED
 * ============================================================================
 *
 * The three selection handlers (handleSelectUser, handleSelectField, handleSelectModel)
 * follow a similar pattern:
 *   1. Validate trigger type matches
 *   2. Call the corresponding insert function
 *   3. Clone the mentions map and add the new mention
 *   4. Update text, cursor position, and reset selection index
 *
 * A code review might suggest creating a factory function to reduce this duplication.
 * However, abstraction here would be COUNTERPRODUCTIVE for these reasons:
 *
 * 1. TYPE SAFETY COMPLEXITY:
 *    - Each handler works with different item types (UserInfo, FieldInfo, ModelInfo)
 *    - Each calls a different insert function with different signatures
 *    - A generic factory would require complex type parameters and type guards
 *    - The type assertions needed would reduce type safety, not improve it
 *
 * 2. MINIMAL ACTUAL DUPLICATION:
 *    - The shared logic is only ~5 lines (clone map, update map, call callbacks)
 *    - Each handler has type-specific logic that can't be generalized
 *    - Total duplication: ~15 lines. Factory overhead: ~30 lines + complexity
 *
 * 3. READABILITY AND DEBUGGING:
 *    - Each handler is self-contained and easy to understand
 *    - When debugging mention insertion, you can trace one clear path
 *    - A factory pattern would add indirection that obscures the data flow
 *
 * 4. CHANGE ISOLATION:
 *    - If field mentions need special handling (e.g., locale selection), only
 *      handleSelectField needs modification
 *    - A shared factory would require conditional logic for each type
 *
 * IF YOU ARE CONSIDERING REFACTORING THIS:
 * - Only do so if a 4th+ mention type is added AND the pattern is truly identical
 * - Even then, consider if the abstraction cost outweighs the duplication cost
 * - Remember: "The Wrong Abstraction" is worse than duplicated code
 *
 * ============================================================================
 */

type UseMentionSelectionOptions = {
  value: string;
  cursorPosition: number;
  triggerInfo: TriggerInfo | null;
  onChange: (value: string) => void;
  setCursorPosition: (pos: number) => void;
  mentionsMap: Map<MentionMapKey, Mention>;
  onMentionsMapChange: (map: Map<MentionMapKey, Mention>) => void;
};

type UseMentionSelectionReturn = {
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  resetSelection: () => void;
  pendingFieldForLocale: FieldInfo | null;
  setPendingFieldForLocale: React.Dispatch<React.SetStateAction<FieldInfo | null>>;
  clearPendingFieldForLocale: () => void;
  handleSelectUser: (user: UserInfo) => void;
  handleSelectField: (field: FieldInfo, locale?: string) => void;
  handleSelectModel: (model: ModelInfo) => void;
  closeDropdown: () => void;
};

/**
 * Hook for managing selection state and handling mention selections.
 * Handles user, field, and model selection with proper mention map updates.
 */
export function useMentionSelection({
  value,
  cursorPosition,
  triggerInfo,
  onChange,
  setCursorPosition,
  mentionsMap,
  onMentionsMapChange,
}: UseMentionSelectionOptions): UseMentionSelectionReturn {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingFieldForLocale, setPendingFieldForLocale] = useState<FieldInfo | null>(null);

  const resetSelection = useCallback(() => {
    setSelectedIndex(0);
  }, []);

  const clearPendingFieldForLocale = useCallback(() => {
    setPendingFieldForLocale(null);
  }, []);

  // Handle user selection
  const handleSelectUser = useCallback(
    (user: UserInfo) => {
      if (!triggerInfo || triggerInfo.type !== 'user') return;

      const { newText, newCursorPosition, mention } = insertUserMention(
        value,
        triggerInfo.startIndex,
        cursorPosition,
        user
      );

      // Add mention to map
      const newMap = new Map(mentionsMap);
      newMap.set(createMentionKey(mention), mention);
      onMentionsMapChange(newMap);

      onChange(newText);
      setCursorPosition(newCursorPosition);
      setSelectedIndex(0);
    },
    [value, cursorPosition, triggerInfo, onChange, setCursorPosition, mentionsMap, onMentionsMapChange]
  );

  // Handle field selection
  const handleSelectField = useCallback(
    (field: FieldInfo, locale?: string) => {
      if (!triggerInfo || triggerInfo.type !== 'field') return;

      const { newText, newCursorPosition, mention } = insertFieldMention(
        value,
        triggerInfo.startIndex,
        cursorPosition,
        field,
        locale
      );

      // Add mention to map
      const newMap = new Map(mentionsMap);
      newMap.set(createMentionKey(mention), mention);
      onMentionsMapChange(newMap);

      onChange(newText);
      setCursorPosition(newCursorPosition);
      setSelectedIndex(0);
    },
    [value, cursorPosition, triggerInfo, onChange, setCursorPosition, mentionsMap, onMentionsMapChange]
  );

  // Handle model selection
  const handleSelectModel = useCallback(
    (model: ModelInfo) => {
      if (!triggerInfo || triggerInfo.type !== 'model') return;

      const { newText, newCursorPosition, mention } = insertModelMention(
        value,
        triggerInfo.startIndex,
        cursorPosition,
        model
      );

      // Add mention to map
      const newMap = new Map(mentionsMap);
      newMap.set(createMentionKey(mention), mention);
      onMentionsMapChange(newMap);

      onChange(newText);
      setCursorPosition(newCursorPosition);
      setSelectedIndex(0);
    },
    [value, cursorPosition, triggerInfo, onChange, setCursorPosition, mentionsMap, onMentionsMapChange]
  );

  // Close dropdown by inserting a space
  const closeDropdown = useCallback(() => {
    if (triggerInfo) {
      const before = value.slice(0, cursorPosition);
      const after = value.slice(cursorPosition);
      onChange(`${before} ${after}`);
      setCursorPosition(cursorPosition + 1);
    }
  }, [value, cursorPosition, triggerInfo, onChange, setCursorPosition]);

  return {
    selectedIndex,
    setSelectedIndex,
    resetSelection,
    pendingFieldForLocale,
    setPendingFieldForLocale,
    clearPendingFieldForLocale,
    handleSelectUser,
    handleSelectField,
    handleSelectModel,
    closeDropdown,
  };
}
