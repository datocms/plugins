export type SlashCommandType = 'user' | 'field' | 'record' | 'asset' | 'model';

export type SlashCommandDefinition = {
  name: SlashCommandType;
  label: string;
  /** A hint that adds to the label, when the label alone is not enough */
  description?: string;
};

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    name: 'user',
    label: 'User',
  },
  {
    name: 'field',
    label: 'Field',
  },
  {
    name: 'record',
    label: 'Record',
  },
  {
    name: 'asset',
    label: 'Asset',
  },
  {
    name: 'model',
    label: 'Model',
  },
];

export type ActiveSlashCommand = {
  phase: 'command_selection' | 'type_selection';
  rawQuery: string;
  commandPart: string;
  searchQuery: string;
  selectedType: SlashCommandType | null;
  range: { from: number; to: number };
  clientRect: (() => DOMRect | null) | null;
};
