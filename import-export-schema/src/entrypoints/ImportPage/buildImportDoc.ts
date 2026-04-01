import type { SchemaTypes } from '@datocms/cma-client';
import {
  findLinkedItemTypeIds,
  findLinkedPluginIds,
} from '@/utils/datocms/schema';
import type { ExportSchema } from '../ExportPage/ExportSchema';
import type { Conflicts } from './ConflictsManager/buildConflicts';
import type {
  ItemTypeConflictResolutionRename,
  Resolutions,
} from './ResolutionsForm';

type QueueItem = SchemaTypes.ItemType | SchemaTypes.Plugin;

export type ImportDoc = {
  itemTypes: {
    entitiesToCreate: Array<{
      entity: SchemaTypes.ItemType;
      fields: SchemaTypes.Field[];
      fieldsets: SchemaTypes.Fieldset[];
      rename?: ItemTypeConflictResolutionRename;
    }>;
    idsToReuse: Record<string, string>;
  };
  plugins: {
    entitiesToCreate: SchemaTypes.Plugin[];
    idsToReuse: Record<string, string>;
  };
};

/**
 * Resolve linked item types from the export schema, returning only those that exist in the export.
 */
function resolveLinkedItemTypes(
  fields: SchemaTypes.Field[],
  exportSchema: ExportSchema,
): SchemaTypes.ItemType[] {
  const linked: SchemaTypes.ItemType[] = [];
  for (const field of fields) {
    for (const linkedItemTypeId of findLinkedItemTypeIds(field)) {
      const linkedItemType = exportSchema.itemTypesById.get(linkedItemTypeId);
      if (linkedItemType) {
        linked.push(linkedItemType);
      }
    }
  }
  return linked;
}

/**
 * Resolve linked plugins from the export schema, returning only those that exist.
 */
function resolveLinkedPlugins(
  fields: SchemaTypes.Field[],
  exportSchema: ExportSchema,
): SchemaTypes.Plugin[] {
  const exportedPluginIds = new Set(
    Array.from(exportSchema.pluginsById.keys()),
  );
  const linked: SchemaTypes.Plugin[] = [];
  for (const field of fields) {
    for (const linkedPluginId of findLinkedPluginIds(
      field,
      exportedPluginIds,
    )) {
      const linkedPlugin = exportSchema.pluginsById.get(linkedPluginId);
      if (linkedPlugin) {
        linked.push(linkedPlugin);
      }
    }
  }
  return linked;
}

/**
 * Process a single item type during BFS traversal, adding it to the result and
 * queuing its dependencies for the next level.
 */
function processItemType(
  itemType: SchemaTypes.ItemType,
  exportSchema: ExportSchema,
  conflicts: Conflicts,
  resolutions: Resolutions,
  result: ImportDoc,
  nextLevelQueue: Set<QueueItem>,
) {
  const resolution = resolutions.itemTypes[itemType.id];

  if (resolution?.strategy === 'reuseExisting') {
    result.itemTypes.idsToReuse[itemType.id] =
      conflicts.itemTypes[itemType.id].id;
    return;
  }

  const fields = exportSchema.getItemTypeFields(itemType);
  const fieldsets = exportSchema.getItemTypeFieldsets(itemType);

  result.itemTypes.entitiesToCreate.push({
    entity: itemType,
    fields,
    fieldsets,
    rename: resolution,
  });

  for (const linkedItemType of resolveLinkedItemTypes(fields, exportSchema)) {
    nextLevelQueue.add(linkedItemType);
  }

  for (const linkedPlugin of resolveLinkedPlugins(fields, exportSchema)) {
    nextLevelQueue.add(linkedPlugin);
  }
}

/**
 * Process a single plugin during BFS traversal, adding it to the result.
 */
function processPlugin(
  plugin: SchemaTypes.Plugin,
  conflicts: Conflicts,
  resolutions: Resolutions,
  result: ImportDoc,
) {
  const resolution = resolutions.plugins[plugin.id];

  if (resolution?.strategy === 'reuseExisting') {
    result.plugins.idsToReuse[plugin.id] = conflicts.plugins[plugin.id].id;
  }

  if (!resolution) {
    result.plugins.entitiesToCreate.push(plugin);
  }
}

/**
 * Walk the export graph while honoring conflict resolutions, producing a document for import.
 */
export async function buildImportDoc(
  exportSchema: ExportSchema,
  conflicts: Conflicts,
  resolutions: Resolutions,
): Promise<ImportDoc> {
  const result: ImportDoc = {
    itemTypes: {
      entitiesToCreate: [],
      idsToReuse: {},
    },
    plugins: {
      entitiesToCreate: [],
      idsToReuse: {},
    },
  };

  // Breadth-first traversal keeps dependencies ordered for creation.
  const queue: QueueItem[][] = [exportSchema.rootItemTypes];
  const processedNodes = new Set<QueueItem>();

  // Process each level of the graph
  while (queue.length > 0) {
    const currentLevelItems = queue.shift();

    if (!currentLevelItems) {
      throw new Error('Unexpected error: currentLevelItemTypes is undefined');
    }

    const nextLevelQueue = new Set<QueueItem>();

    for (const itemTypeOrPlugin of currentLevelItems) {
      if (processedNodes.has(itemTypeOrPlugin)) {
        continue;
      }

      processedNodes.add(itemTypeOrPlugin);

      if (itemTypeOrPlugin.type === 'item_type') {
        processItemType(
          itemTypeOrPlugin,
          exportSchema,
          conflicts,
          resolutions,
          result,
          nextLevelQueue,
        );
      } else {
        processPlugin(itemTypeOrPlugin, conflicts, resolutions, result);
      }
    }

    // If we have nodes for the next level, add them to the queue
    if (nextLevelQueue.size > 0) {
      queue.push([...nextLevelQueue]);
    }
  }

  return result;
}
