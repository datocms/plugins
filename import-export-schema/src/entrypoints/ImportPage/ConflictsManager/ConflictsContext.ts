import { createContext } from 'react';
import type { Conflicts } from './buildConflicts';

export const ConflictsContext = createContext<Conflicts>({
  plugins: {},
  itemTypes: {},
  ids: {
    itemTypes: {},
    fields: {},
    fieldsets: {},
    plugins: {},
  },
  legacyIds: {
    itemTypes: {},
    fields: {},
    fieldsets: {},
    plugins: {},
  },
});

/**
 * The entities of the file whose conflict still needs a decision, as the
 * overview and the count of the toolbar tell them: the graph paints these
 * nodes as conflicts. Conflicts of IDs count too, not only of names.
 */
export const UnresolvedConflictsContext = createContext<{
  itemTypeIds: ReadonlySet<string>;
  pluginIds: ReadonlySet<string>;
}>({ itemTypeIds: new Set(), pluginIds: new Set() });
