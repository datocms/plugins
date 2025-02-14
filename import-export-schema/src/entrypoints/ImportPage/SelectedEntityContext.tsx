import type { SchemaTypes } from '@datocms/cma-client';
import { createContext } from 'react';

type Context = {
  entity: undefined | SchemaTypes.ItemType | SchemaTypes.Plugin;
  set: (
    newEntity: undefined | SchemaTypes.ItemType | SchemaTypes.Plugin,
    zoomIn?: boolean,
  ) => void;
};

export const SelectedEntityContext = createContext<Context>({
  entity: undefined,
  set: () => {},
});
