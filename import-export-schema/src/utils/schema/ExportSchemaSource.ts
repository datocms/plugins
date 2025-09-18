import type { SchemaTypes } from '@datocms/cma-client';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import type { ISchemaSource } from './ISchemaSource';

/** Adapts an export document into the schema source interface for graph building. */
export class ExportSchemaSource implements ISchemaSource {
  private schema: ExportSchema;

  constructor(schema: ExportSchema) {
    this.schema = schema;
  }

  async getItemTypeById(id: string): Promise<SchemaTypes.ItemType> {
    return this.schema.getItemTypeById(id);
  }

  async getPluginById(id: string): Promise<SchemaTypes.Plugin> {
    return this.schema.getPluginById(id);
  }

  async getItemTypeFieldsAndFieldsets(
    itemType: SchemaTypes.ItemType,
  ): Promise<[SchemaTypes.Field[], SchemaTypes.Fieldset[]]> {
    return [
      this.schema.getItemTypeFields(itemType),
      this.schema.getItemTypeFieldsets(itemType),
    ];
  }

  getKnownPluginIds(): Set<string> {
    return new Set(Array.from(this.schema.pluginsById.keys()));
  }
}
