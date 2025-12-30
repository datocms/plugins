import { useCallback } from 'react';
import type { Mention, MentionMapKey } from '@ctypes/mentions';
import { useMentionTrigger } from './useMentionTrigger';
import { useMentionFiltering } from './useMentionFiltering';
import { useMentionSelection } from './useMentionSelection';
import { useMentionKeyboard } from './useMentionKeyboard';

// Re-export types for consumers
export type { UserInfo, FieldInfo, ModelInfo } from './useMentionFiltering';

type UseMentionsOptions = {
  users: import('./useMentionFiltering').UserInfo[];
  fields: import('./useMentionFiltering').FieldInfo[];
  models: import('./useMentionFiltering').ModelInfo[];
  value: string;
  onChange: (value: string) => void;
  mentionsMap: Map<MentionMapKey, Mention>;
  onMentionsMapChange: (map: Map<MentionMapKey, Mention>) => void;
  canMentionAssets?: boolean;
  canMentionModels?: boolean;
  canMentionFields?: boolean;
};

type UseMentionsReturn = {
  activeDropdown: 'user' | 'field' | 'model' | 'asset' | 'record' | null;
  filteredUsers: import('./useMentionFiltering').UserInfo[];
  filteredFields: import('./useMentionFiltering').FieldInfo[];
  filteredModels: import('./useMentionFiltering').ModelInfo[];
  selectedIndex: number;
  triggerInfo: { type: 'user' | 'field' | 'model' | 'asset' | 'record'; query: string; startIndex: number } | null;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSelectUser: (user: import('./useMentionFiltering').UserInfo) => void;
  handleSelectField: (field: import('./useMentionFiltering').FieldInfo, locale?: string) => void;
  handleSelectModel: (model: import('./useMentionFiltering').ModelInfo) => void;
  closeDropdown: () => void;
  cursorPosition: number;
  setCursorPosition: (pos: number) => void;
  // For keyboard-driven locale selection
  pendingFieldForLocale: import('./useMentionFiltering').FieldInfo | null;
  clearPendingFieldForLocale: () => void;
  // For dropdown keyboard handling delegation
  registerDropdownKeyHandler: (handler: (key: string) => boolean) => void;
};

export function useMentions({
  users,
  fields,
  models,
  value,
  onChange,
  mentionsMap,
  onMentionsMapChange,
  canMentionAssets = true,
  canMentionModels = true,
  canMentionFields = true,
}: UseMentionsOptions): UseMentionsReturn {
  const {
    cursorPosition,
    setCursorPosition,
    triggerInfo,
    activeDropdown,
  } = useMentionTrigger({
    value,
    permissions: {
      canMentionAssets,
      canMentionModels,
      canMentionFields,
    },
  });

  const {
    filteredUsers,
    filteredFields,
    filteredModels,
  } = useMentionFiltering({
    users,
    fields,
    models,
    triggerInfo,
  });

  const {
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
  } = useMentionSelection({
    value,
    cursorPosition,
    triggerInfo,
    onChange,
    setCursorPosition,
    mentionsMap,
    onMentionsMapChange,
  });

  const {
    handleKeyDown,
    registerDropdownKeyHandler,
  } = useMentionKeyboard({
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
  });

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      setCursorPosition(e.target.selectionStart);
      resetSelection();
    },
    [onChange, setCursorPosition, resetSelection]
  );

  return {
    activeDropdown,
    filteredUsers,
    filteredFields,
    filteredModels,
    selectedIndex,
    triggerInfo,
    handleKeyDown,
    handleChange,
    handleSelectUser,
    handleSelectField,
    handleSelectModel,
    closeDropdown,
    cursorPosition,
    setCursorPosition,
    pendingFieldForLocale,
    clearPendingFieldForLocale,
    registerDropdownKeyHandler,
  };
}
