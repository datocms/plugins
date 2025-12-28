import { useMemo } from 'react';
import { filterUsers, filterFields, filterModels } from '@utils/mentions';
import type { TriggerInfo } from '@utils/mentions';

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

type UseMentionFilteringOptions = {
  users: UserInfo[];
  fields: FieldInfo[];
  models: ModelInfo[];
  triggerInfo: TriggerInfo | null;
};

type UseMentionFilteringReturn = {
  filteredUsers: UserInfo[];
  filteredFields: FieldInfo[];
  filteredModels: ModelInfo[];
};

/**
 * Hook for filtering mention options based on the current trigger query.
 * Memoizes filtered results to avoid unnecessary recalculations.
 */
export function useMentionFiltering({
  users,
  fields,
  models,
  triggerInfo,
}: UseMentionFilteringOptions): UseMentionFilteringReturn {
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

  return {
    filteredUsers,
    filteredFields,
    filteredModels,
  };
}
