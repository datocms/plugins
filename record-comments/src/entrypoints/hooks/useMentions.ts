import { useState, useCallback, useMemo, useRef } from 'react';
import type { Mention, MentionMapKey } from '../types/mentions';
import { createMentionKey } from '../types/mentions';
import {
  detectActiveTrigger,
  filterUsers,
  filterFields,
  filterModels,
  insertUserMention,
  insertFieldMention,
  insertModelMention,
} from '../utils/mentionSerializer';

export type UserInfo = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

export type FieldInfo = {
  apiKey: string;
  label: string;
  localized: boolean;
  fieldPath: string;           // Navigation path with indices: "title" or "blocks.0.heading"
  displayLabel: string;        // For dropdown: "Hero #1 > heading"
  depth: number;               // Nesting level for indentation
  availableLocales?: string[]; // Locales with values (only for localized fields with multiple locales)
  fieldType?: string;          // Editor type from appearance.editor (e.g., "single_line", "structured_text")
  isBlockContainer?: boolean;  // true for modular_content, structured_text, single_block
  blockFieldType?: 'modular_content' | 'structured_text' | 'single_block' | 'rich_text'; // The actual field_type for block containers
};

export type ModelInfo = {
  id: string;
  apiKey: string;
  name: string;
  isBlockModel: boolean;
};

type UseMentionsOptions = {
  users: UserInfo[];
  fields: FieldInfo[];
  models: ModelInfo[];
  value: string;
  onChange: (value: string) => void;
  mentionsMap: Map<MentionMapKey, Mention>;
  onMentionsMapChange: (map: Map<MentionMapKey, Mention>) => void;
};

type UseMentionsReturn = {
  activeDropdown: 'user' | 'field' | 'model' | 'asset' | 'record' | null;
  filteredUsers: UserInfo[];
  filteredFields: FieldInfo[];
  filteredModels: ModelInfo[];
  selectedIndex: number;
  triggerInfo: { type: 'user' | 'field' | 'model' | 'asset' | 'record'; query: string; startIndex: number } | null;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSelectUser: (user: UserInfo) => void;
  handleSelectField: (field: FieldInfo, locale?: string) => void;
  handleSelectModel: (model: ModelInfo) => void;
  closeDropdown: () => void;
  cursorPosition: number;
  setCursorPosition: (pos: number) => void;
  // For keyboard-driven locale selection
  pendingFieldForLocale: FieldInfo | null;
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
}: UseMentionsOptions): UseMentionsReturn {
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  // State for locale selection via keyboard - when set, dropdown shows locale picker
  const [pendingFieldForLocale, setPendingFieldForLocale] = useState<FieldInfo | null>(null);

  // Ref to store the dropdown's keyboard handler for drill-down navigation
  const dropdownKeyHandlerRef = useRef<((key: string) => boolean) | null>(null);
  
  // Function to register the dropdown's keyboard handler
  const registerDropdownKeyHandler = useCallback((handler: (key: string) => boolean) => {
    dropdownKeyHandlerRef.current = handler;
  }, []);

  // Detect if we're in a mention trigger
  const triggerInfo = useMemo(
    () => detectActiveTrigger(value, cursorPosition),
    [value, cursorPosition]
  );

  const activeDropdown = triggerInfo?.type ?? null;

  // Filter based on trigger type and query
  const filteredUsers = useMemo(() => {
    if (triggerInfo?.type !== 'user') return [];
    return filterUsers(users, triggerInfo.query);
  }, [users, triggerInfo]);

  const filteredFields = useMemo(() => {
    if (triggerInfo?.type !== 'field') return [];
    return filterFields(fields, triggerInfo.query);
  }, [fields, triggerInfo]);

  const filteredModels = useMemo(() => {
    if (triggerInfo?.type !== 'model') return [];
    return filterModels(models, triggerInfo.query);
  }, [models, triggerInfo]);

  // Get the current list length for keyboard navigation
  // When in locale selection mode, use the locale list length
  const currentListLength = pendingFieldForLocale 
    ? (pendingFieldForLocale.availableLocales?.length ?? 0)
    : activeDropdown === 'user' 
      ? filteredUsers.length 
      : activeDropdown === 'field' 
        ? filteredFields.length 
        : activeDropdown === 'model'
          ? filteredModels.length
          : 0;

  // Reset selection when filtered results change
  const resetSelection = useCallback(() => {
    setSelectedIndex(0);
  }, []);

  // Handle text change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      setCursorPosition(e.target.selectionStart);
      resetSelection();
    },
    [onChange, resetSelection]
  );

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
    [value, cursorPosition, triggerInfo, onChange, mentionsMap, onMentionsMapChange]
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
    [value, cursorPosition, triggerInfo, onChange, mentionsMap, onMentionsMapChange]
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
    [value, cursorPosition, triggerInfo, onChange, mentionsMap, onMentionsMapChange]
  );

  // Close dropdown by inserting a space
  const closeDropdown = useCallback(() => {
    if (triggerInfo) {
      const before = value.slice(0, cursorPosition);
      const after = value.slice(cursorPosition);
      onChange(`${before} ${after}`);
      setCursorPosition(cursorPosition + 1);
    }
  }, [value, cursorPosition, triggerInfo, onChange]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const target = e.currentTarget;

      // If no dropdown is open, don't intercept
      if (!activeDropdown) {
        setTimeout(() => {
          setCursorPosition(target.selectionStart);
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
              if (field.isBlockContainer) {
                // Block container - show locale picker (if localized) or block picker
                if (field.localized && field.availableLocales && field.availableLocales.length > 1) {
                  setPendingFieldForLocale(field);
                  setSelectedIndex(0);
                } else {
                  // Non-localized block container - still need to drill down
                  // Use pendingFieldForLocale to trigger the drill-down UI
                  setPendingFieldForLocale(field);
                  setSelectedIndex(0);
                }
              } else if (field.localized && field.availableLocales && field.availableLocales.length > 1) {
                setPendingFieldForLocale(field);
                setSelectedIndex(0); // Reset selection for locale list
              } else if (field.localized && field.availableLocales && field.availableLocales.length === 1) {
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

        case 'Tab':
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
              if (field.isBlockContainer) {
                // Block container - show locale picker (if localized) or block picker
                if (field.localized && field.availableLocales && field.availableLocales.length > 1) {
                  setPendingFieldForLocale(field);
                  setSelectedIndex(0);
                } else {
                  // Non-localized block container - still need to drill down
                  setPendingFieldForLocale(field);
                  setSelectedIndex(0);
                }
              } else if (field.localized && field.availableLocales && field.availableLocales.length > 1) {
                setPendingFieldForLocale(field);
                setSelectedIndex(0); // Reset selection for locale list
              } else if (field.localized && field.availableLocales && field.availableLocales.length === 1) {
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
          setTimeout(() => {
            setCursorPosition(target.selectionStart);
          }, 0);
          return false;
      }
    },
    [
      activeDropdown,
      currentListLength,
      filteredUsers,
      filteredFields,
      filteredModels,
      selectedIndex,
      handleSelectUser,
      handleSelectField,
      handleSelectModel,
      closeDropdown,
      pendingFieldForLocale,
    ]
  );

  const clearPendingFieldForLocale = useCallback(() => {
    setPendingFieldForLocale(null);
  }, []);

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




