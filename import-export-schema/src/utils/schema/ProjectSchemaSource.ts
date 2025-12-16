import type { SchemaTypes } from '@datocms/cma-client';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { ISchemaSource } from './ISchemaSource';

/** Adapts the live CMA-backed project schema to the generic graph interface. */
export class ProjectSchemaSource implements ISchemaSource {
  private schema: ProjectSchema;
  private cachedPluginIds?: Set<string>;

  constructor(
    schema: ProjectSchema,
    options: { installedPluginIds?: Set<string> } = {},
  ) {
    this.schema = schema;
    this.cachedPluginIds = options.installedPluginIds;
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
    if (this.cachedPluginIds) {
      return this.cachedPluginIds;
    }
    const plugins = await this.schema.getAllPlugins();
    this.cachedPluginIds = new Set(plugins.map((p) => p.id));
    return this.cachedPluginIds;
  }
}
