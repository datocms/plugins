import { createContext } from 'react';

export const SelectedEntitiesContext = createContext<
  undefined | { itemTypeIds: string[]; pluginIds: string[] }
>(undefined);
