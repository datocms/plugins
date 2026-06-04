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
