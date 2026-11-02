export type SlashCommandType = 'user' | 'field' | 'record' | 'asset' | 'model';

export type SlashCommandDefinition = {
  name: SlashCommandType;
  /** What the command inserts, as the slash panel and the toolbar name it */
  label: string;
};

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { name: 'user', label: 'Collaborator' },
  { name: 'field', label: 'Field' },
  { name: 'record', label: 'Record' },
  { name: 'asset', label: 'Asset' },
  { name: 'model', label: 'Model' },
];

export type ActiveSlashCommand = {
  phase: 'command_selection' | 'type_selection';
  rawQuery: string;
  commandPart: string;
  searchQuery: string;
  selectedType: SlashCommandType | null;
  range: { from: number; to: number };
  clientRect: (() => DOMRect | null) | null;
  /**
   * Opened from the Mention menu, with no typed command: the panel has its
   * own search field, and searchQuery is its text
   */
  fromMenu?: boolean;
};
