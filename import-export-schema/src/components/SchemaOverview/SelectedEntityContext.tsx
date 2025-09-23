import type { SchemaTypes } from '@datocms/cma-client';
import { createContext } from 'react';

type SelectedEntityContextValue = {
  entity?: SchemaTypes.ItemType | SchemaTypes.Plugin;
  set: (
    entity: SchemaTypes.ItemType | SchemaTypes.Plugin | undefined,
    zoomIn?: boolean,
  ) => void;
};

export const SelectedEntityContext = createContext<SelectedEntityContextValue>({
  entity: undefined,
  set: () => {},
});
