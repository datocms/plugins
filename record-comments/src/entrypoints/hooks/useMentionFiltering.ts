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
