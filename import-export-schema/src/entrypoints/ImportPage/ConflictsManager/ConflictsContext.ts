import { createContext } from 'react';
import type { Conflicts } from './buildConflicts';

/**
 * Stores the conflict mappings so detailed components can read and annotate results.
 */
export const ConflictsContext = createContext<Conflicts>({
  plugins: {},
  itemTypes: {},
});
