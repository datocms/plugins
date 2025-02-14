import { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import type { ItemTypeManager } from '@/utils/itemTypeManager';
import type { ExportDoc } from '@/utils/types';
import type { SchemaTypes } from '@datocms/cma-client';
import { keyBy } from 'lodash-es';

export type Conflicts = {
  plugins: Record<string, SchemaTypes.Plugin>;
  itemTypes: Record<string, SchemaTypes.ItemType>;
};

export default async function buildConflicts(
  exportDoc: ExportDoc,
  projectSchema: ItemTypeManager,
) {
  const exportSchema = new ExportSchema(exportDoc);

  const projectItemTypes = await projectSchema.getAllItemTypes();
  const projectItemTypesByName = keyBy(projectItemTypes, 'attributes.name');
  const projectItemTypesByApiKey = keyBy(
    projectItemTypes,
    'attributes.api_key',
  );

  const projectPlugins = await projectSchema.getAllPlugins();
  const projectPluginsByName = keyBy(projectPlugins, 'attributes.name');
  const projectPluginsByUrl = keyBy(projectPlugins, 'attributes.url');

  const conflicts: Conflicts = { plugins: {}, itemTypes: {} };

  for (const itemType of exportSchema.itemTypes) {
    const conflictingItemType =
      projectItemTypesByName[itemType.attributes.name] ||
      projectItemTypesByApiKey[itemType.attributes.api_key];

    if (conflictingItemType) {
      conflicts.itemTypes[itemType.id] = conflictingItemType;
    }
  }

  for (const plugin of exportSchema.plugins) {
    const conflictingPlugin =
      projectPluginsByUrl[plugin.attributes.url] ||
      projectPluginsByName[plugin.attributes.name];

    if (conflictingPlugin) {
      conflicts.plugins[plugin.id] = conflictingPlugin;
    }
  }

  return conflicts;
}
