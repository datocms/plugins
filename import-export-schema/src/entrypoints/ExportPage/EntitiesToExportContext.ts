import { createContext } from 'react';

export const EntitiesToExportContext = createContext<
  undefined | { itemTypeIds: string[]; pluginIds: string[] }
>(undefined);
