import type { SchemaTypes } from '@datocms/cma-client';

/** Canonical export document shapes handled by the importer/exporter. */
export type ExportDocV1 = {
  version: '1';
  entities: Array<
    | SchemaTypes.ItemType
    | SchemaTypes.Field
    | SchemaTypes.Fieldset
    | SchemaTypes.Plugin
  >;
};

export type ExportDocV2 = {
  version: '2';
  rootItemTypeId: string;
  entities: Array<
    | SchemaTypes.ItemType
    | SchemaTypes.Field
    | SchemaTypes.Fieldset
    | SchemaTypes.Plugin
  >;
};

export type ExportDoc = ExportDocV1 | ExportDocV2;
