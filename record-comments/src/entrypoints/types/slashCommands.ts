export type SlashCommandType = 'user' | 'field' | 'record' | 'asset' | 'model';

export type SlashCommandDefinition = {
  name: SlashCommandType;
  label: string;
  description: string;
  icon: string;
};

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { name: 'user', label: 'User', description: 'Mention a team member', icon: '👤' },
  { name: 'field', label: 'Field', description: 'Reference a field', icon: '#' },
  { name: 'record', label: 'Record', description: 'Link to a record', icon: '📄' },
  { name: 'asset', label: 'Asset', description: 'Link to an asset', icon: '📎' },
  { name: 'model', label: 'Model', description: 'Reference a model', icon: '📦' },
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
