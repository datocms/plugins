import { createContext } from 'react';
import type { Conflicts } from './buildConflicts';

export const ConflictsContext = createContext<Conflicts>({
  plugins: {},
  itemTypes: {},
});
