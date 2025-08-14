import type { SchemaTypes } from '@datocms/cma-client';

export interface ISchemaSource {
  getItemTypeById(id: string): Promise<SchemaTypes.ItemType>;
  getPluginById(id: string): Promise<SchemaTypes.Plugin>;
  getItemTypeFieldsAndFieldsets(
    itemType: SchemaTypes.ItemType,
  ): Promise<[SchemaTypes.Field[], SchemaTypes.Fieldset[]]>;
  getKnownPluginIds(): Promise<Set<string>> | Set<string>;
}
