export type SlashCommandType = 'user' | 'field' | 'record' | 'asset' | 'model';

export type SlashCommandDefinition = {
  name: SlashCommandType;
  /** What the command inserts, as the slash panel and the toolbar name it */
  label: string;
};

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { name: 'user', label: 'Mention a collaborator' },
  { name: 'field', label: 'Mention a field' },
  { name: 'record', label: 'Mention a record' },
  { name: 'asset', label: 'Mention an asset' },
  { name: 'model', label: 'Mention a model' },
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
