import { createContext } from 'react';

/**
 * Provides the currently selected export entities so node renderers can mark excluded items.
 */
export const EntitiesToExportContext = createContext<
  undefined | { itemTypeIds: string[]; pluginIds: string[] }
>(undefined);
