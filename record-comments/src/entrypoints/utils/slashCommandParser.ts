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

/**
 * A command answers to its name and to the word of its label, as the menus
 * show it: "/coll" and "/collaborator" find the people, as "/user" does
 */
function startsCommand(cmd: SlashCommandDefinition, word: string): boolean {
  return cmd.name.startsWith(word) || cmd.label.toLowerCase().startsWith(word);
}

function findCommand(word: string): SlashCommandDefinition | null {
  return (
    SLASH_COMMANDS.find(
      (cmd) => cmd.name === word || cmd.label.toLowerCase() === word,
    ) ?? null
  );
}

export function parseSlashQuery(rawQuery: string): ParsedSlashQuery {
  const spaceIndex = rawQuery.indexOf(' ');

  if (spaceIndex === -1) {
    // Still typing command (e.g., "us" from "/us")
    const commandPart = rawQuery.toLowerCase();
    const matchedCommands = SLASH_COMMANDS.filter((cmd) =>
      startsCommand(cmd, commandPart),
    );
    const exactMatch = findCommand(commandPart);

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
  const exactMatch = findCommand(commandPart);

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
  return SLASH_COMMANDS.filter((cmd) => startsCommand(cmd, lowerQuery));
}
