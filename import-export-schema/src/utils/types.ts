import type { SchemaTypes } from '@datocms/cma-client';

export type ExportDoc = {
  version: '1';
  entities: Array<
    | SchemaTypes.ItemType
    | SchemaTypes.Field
    | SchemaTypes.Fieldset
    | SchemaTypes.Plugin
  >;
};
