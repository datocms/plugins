import { createContext } from 'react';

type GraphEntitiesContextValue = {
  hasItemTypeNode: (id: string) => boolean;
  hasPluginNode: (id: string) => boolean;
};

export const GraphEntitiesContext = createContext<GraphEntitiesContextValue>({
  hasItemTypeNode: () => false,
  hasPluginNode: () => false,
});
