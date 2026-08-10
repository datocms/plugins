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

export function parseSlashQuery(rawQuery?: string | null): ParsedSlashQuery {
  const normalizedQuery = rawQuery ?? '';
  const spaceIndex = normalizedQuery.indexOf(' ');

  if (spaceIndex === -1) {
    // Still typing command (e.g., "us" from "/us")
    const commandPart = normalizedQuery.toLowerCase();
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
  const commandPart = normalizedQuery.substring(0, spaceIndex).toLowerCase();
  const searchQuery = normalizedQuery.substring(spaceIndex + 1);
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

export function filterSlashCommands(
  query?: string | null,
): SlashCommandDefinition[] {
  if (!query) return SLASH_COMMANDS;
  const lowerQuery = query.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(lowerQuery));
}
