import {
  SLASH_COMMANDS,
  type SlashCommandDefinition,
} from '@ctypes/slashCommands';

export type ParsedSlashQuery = {
  commandPart: string;
  searchQuery: string;
  matchedCommands: SlashCommandDefinition[];
  exactMatch: SlashCommandDefinition | null;
  isComplete: boolean;
};

export function parseSlashQuery(rawQuery: string): ParsedSlashQuery {
  const spaceIndex = rawQuery.indexOf(' ');

  if (spaceIndex === -1) {
    // Still typing command (e.g., "us" from "/us")
    const commandPart = rawQuery.toLowerCase();
    const matchedCommands = SLASH_COMMANDS.filter((cmd) =>
      cmd.name.startsWith(commandPart),
    );
    const exactMatch =
      SLASH_COMMANDS.find((cmd) => cmd.name === commandPart) ?? null;

    return {
      commandPart,
      searchQuery: '',
      matchedCommands,
      exactMatch,
      isComplete: false,
    };
  }

  // Command complete, rest is search (e.g., "user john" from "/user john")
  const commandPart = rawQuery.substring(0, spaceIndex).toLowerCase();
  const searchQuery = rawQuery.substring(spaceIndex + 1);
  const exactMatch =
    SLASH_COMMANDS.find((cmd) => cmd.name === commandPart) ?? null;

  return {
    commandPart,
    searchQuery,
    matchedCommands: exactMatch ? [exactMatch] : [],
    exactMatch,
    isComplete: true,
  };
}

export function filterSlashCommands(query: string): SlashCommandDefinition[] {
  if (!query) return SLASH_COMMANDS;
  const lowerQuery = query.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(lowerQuery));
}
