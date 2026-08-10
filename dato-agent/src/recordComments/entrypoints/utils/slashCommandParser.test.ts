import { describe, expect, it } from 'vitest';
import { SLASH_COMMANDS } from '../types/slashCommands';
import { filterSlashCommands, parseSlashQuery } from './slashCommandParser';

describe('slashCommandParser', () => {
  it.each([undefined, null])(
    'treats a transient %s query as an empty command query',
    (query) => {
      expect(parseSlashQuery(query)).toEqual({
        commandPart: '',
        searchQuery: '',
        matchedCommands: SLASH_COMMANDS,
        exactMatch: null,
        isComplete: false,
      });
      expect(filterSlashCommands(query)).toEqual(SLASH_COMMANDS);
    },
  );
});
