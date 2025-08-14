import type { SchemaTypes } from '@datocms/cma-client';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { ISchemaSource } from './ISchemaSource';

export class ProjectSchemaSource implements ISchemaSource {
  private schema: ProjectSchema;

  constructor(schema: ProjectSchema) {
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
    return this.schema.getItemTypeFieldsAndFieldsets(itemType);
  }

  async getKnownPluginIds(): Promise<Set<string>> {
    const plugins = await this.schema.getAllPlugins();
    return new Set(plugins.map((p) => p.id));
  }
}
