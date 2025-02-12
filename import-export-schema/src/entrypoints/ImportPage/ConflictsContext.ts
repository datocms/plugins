import { createContext } from 'react';
import type { Conflicts } from './buildConflicts';

export const ConflictsContext = createContext<undefined | Conflicts>(undefined);
