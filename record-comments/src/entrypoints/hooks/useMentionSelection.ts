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

  const handleSelectUser = useCallback(
    (user: UserInfo) => {
      if (!triggerInfo || triggerInfo.type !== 'user') return;

      const { newText, newCursorPosition, mention } = insertUserMention(
        value,
        triggerInfo.startIndex,
        cursorPosition,
        user
      );

      const newMap = new Map(mentionsMap);
      newMap.set(createMentionKey(mention), mention);
      onMentionsMapChange(newMap);

      onChange(newText);
      setCursorPosition(newCursorPosition);
      setSelectedIndex(0);
    },
    [value, cursorPosition, triggerInfo, onChange, setCursorPosition, mentionsMap, onMentionsMapChange]
  );

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

      const newMap = new Map(mentionsMap);
      newMap.set(createMentionKey(mention), mention);
      onMentionsMapChange(newMap);

      onChange(newText);
      setCursorPosition(newCursorPosition);
      setSelectedIndex(0);
    },
    [value, cursorPosition, triggerInfo, onChange, setCursorPosition, mentionsMap, onMentionsMapChange]
  );

  const handleSelectModel = useCallback(
    (model: ModelInfo) => {
      if (!triggerInfo || triggerInfo.type !== 'model') return;

      const { newText, newCursorPosition, mention } = insertModelMention(
        value,
        triggerInfo.startIndex,
        cursorPosition,
        model
      );

      const newMap = new Map(mentionsMap);
      newMap.set(createMentionKey(mention), mention);
      onMentionsMapChange(newMap);

      onChange(newText);
      setCursorPosition(newCursorPosition);
      setSelectedIndex(0);
    },
    [value, cursorPosition, triggerInfo, onChange, setCursorPosition, mentionsMap, onMentionsMapChange]
  );

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
