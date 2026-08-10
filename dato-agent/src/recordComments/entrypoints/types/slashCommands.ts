export type SlashCommandType = 'user' | 'field' | 'record' | 'asset' | 'model';

export type SlashCommandDefinition = {
  name: SlashCommandType;
  label: string;
  description: string;
};

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    name: 'user',
    label: 'User',
    description: 'Mention a team member',
  },
  {
    name: 'field',
    label: 'Field',
    description: 'Reference a field',
  },
  {
    name: 'record',
    label: 'Record',
    description: 'Link to a record',
  },
  {
    name: 'asset',
    label: 'Asset',
    description: 'Link to an asset',
  },
  {
    name: 'model',
    label: 'Model',
    description: 'Reference a model',
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
