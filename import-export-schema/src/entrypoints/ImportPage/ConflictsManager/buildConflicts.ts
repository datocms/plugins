import type { SchemaTypes } from '@datocms/cma-client';
import keyBy from 'lodash-es/keyBy';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import type { ProjectSchema } from '@/utils/ProjectSchema';

export type Conflicts = {
  plugins: Record<string, SchemaTypes.Plugin>;
  itemTypes: Record<string, SchemaTypes.ItemType>;
};

/**
 * Compare the export snapshot against the project and identify models/plugins that collide
 * by name, API key, or URL.
 */
export default async function buildConflicts(
  exportSchema: ExportSchema,
  projectSchema: ProjectSchema,
  onProgress?: (p: { done: number; total: number; label: string }) => void,
) {
  let done = 0;
  const total = 2 + exportSchema.itemTypes.length + exportSchema.plugins.length;

  onProgress?.({ done, total, label: 'Loading models…' });
  const projectItemTypes = await projectSchema.getAllItemTypes();
  done += 1;
  onProgress?.({ done, total, label: 'Loading plugins…' });
  const projectItemTypesByName = keyBy(projectItemTypes, 'attributes.name');
  const projectItemTypesByApiKey = keyBy(
    projectItemTypes,
    'attributes.api_key',
  );

  const projectPlugins = await projectSchema.getAllPlugins();
  done += 1;
  onProgress?.({ done, total, label: 'Scanning item types…' });
  const projectPluginsByName = keyBy(projectPlugins, 'attributes.name');
  const projectPluginsByUrl = keyBy(projectPlugins, 'attributes.url');

  const conflicts: Conflicts = { plugins: {}, itemTypes: {} };

  for (const itemType of exportSchema.itemTypes) {
    const conflictingItemType =
      projectItemTypesByName[itemType.attributes.name] ||
      projectItemTypesByApiKey[itemType.attributes.api_key];

    if (conflictingItemType) {
      conflicts.itemTypes[String(itemType.id)] = conflictingItemType;
    }
    done += 1;
    onProgress?.({
      done,
      total,
      label: `Item type: ${itemType.attributes.name}`,
    });
  }

  onProgress?.({ done, total, label: 'Scanning plugins…' });
  for (const plugin of exportSchema.plugins) {
    const conflictingPlugin =
      projectPluginsByUrl[plugin.attributes.url] ||
      projectPluginsByName[plugin.attributes.name];

    if (conflictingPlugin) {
      conflicts.plugins[String(plugin.id)] = conflictingPlugin;
    }
    done += 1;
    onProgress?.({ done, total, label: `Plugin: ${plugin.attributes.name}` });
  }

  return conflicts;
}
