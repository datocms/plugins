import {
  findLinkedItemTypeIds,
  findLinkedPluginIds,
} from '@/utils/datocms/schema';
import type { ExportDoc } from '@/utils/types';
import type { SchemaTypes } from '@datocms/cma-client';
import { ExportSchema } from '../ExportPage/ExportSchema';
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

export async function buildImportDoc(
  exportDoc: ExportDoc,
  conflicts: Conflicts,
  resolutions: Resolutions,
): Promise<ImportDoc> {
  const exportSchema = new ExportSchema(exportDoc);

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

  const queue: QueueItem[][] = [[exportSchema.rootItemType]];
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
        const itemType = itemTypeOrPlugin;

        const resolution = resolutions.itemTypes[itemType.id];

        if (resolution?.strategy === 'reuseExisting') {
          result.itemTypes.idsToReuse[itemType.id] =
            conflicts.itemTypes[itemType.id].id;

          continue;
        }

        const fields = exportSchema.getItemTypeFields(itemType);
        const fieldsets = exportSchema.getItemTypeFieldsets(itemType);

        result.itemTypes.entitiesToCreate.push({
          entity: itemType,
          fields,
          fieldsets,
          rename: resolution,
        });

        for (const field of fields) {
          for (const linkedItemTypeId of findLinkedItemTypeIds(field)) {
            const linkedItemType =
              exportSchema.itemTypesById.get(linkedItemTypeId)!;
            nextLevelQueue.add(linkedItemType);
          }

          for (const linkedPluginId of await findLinkedPluginIds(field)) {
            const linkedPlugin = exportSchema.pluginsById.get(linkedPluginId)!;

            nextLevelQueue.add(linkedPlugin);
          }
        }
      } else {
        const plugin = itemTypeOrPlugin;

        const resolution = resolutions.plugins[plugin.id];

        if (resolution?.strategy === 'reuseExisting') {
          result.plugins.idsToReuse[plugin.id] =
            conflicts.plugins[plugin.id].id;
        }

        if (!resolution) {
          result.plugins.entitiesToCreate.push(plugin);
        }
      }
    }

    // If we have nodes for the next level, add them to the queue
    if (nextLevelQueue.size > 0) {
      queue.push([...nextLevelQueue]);
    }
  }

  return result;
}
