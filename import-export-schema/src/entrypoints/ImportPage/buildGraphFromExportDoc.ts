import { buildHierarchyNodes } from '@/utils/graph/buildHierarchyNodes';
import { rebuildGraphWithPositionsFromHierarchy } from '@/utils/graph/rebuildGraphWithPositionsFromHierarchy';
import type { Graph } from '@/utils/graph/types';
import type { ExportDoc } from '@/utils/types';
import type { SchemaTypes } from '@datocms/cma-client';
import { ExportSchema } from '../ExportPage/ExportSchema';
import {
  buildEdgesForItemType,
  buildItemTypeNode,
  buildPluginNode,
  deterministicGraphSort,
} from '../ExportPage/buildGraphFromSchema';

type QueueItem = SchemaTypes.ItemType | SchemaTypes.Plugin;

export async function buildGraphFromExportDoc(
  exportDoc: ExportDoc,
  itemTypeIdsToSkip: string[],
): Promise<Graph> {
  const exportSchema = new ExportSchema(exportDoc);

  const graph: Graph = { nodes: [], edges: [] };
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

        const fields = exportSchema.getItemTypeFields(itemType);
        const fieldsets = exportSchema.getItemTypeFieldsets(itemType);

        graph.nodes.push(buildItemTypeNode(itemType, fields, fieldsets));

        if (itemTypeIdsToSkip.includes(itemType.id)) {
          continue;
        }

        const [edges, linkedItemTypeIds, linkedPluginIds] =
          await buildEdgesForItemType(
            itemType,
            fields,
            exportSchema.rootItemType,
          );

        graph.edges.push(...edges);

        for (const linkedItemTypeId of linkedItemTypeIds) {
          const linkedItemType =
            exportSchema.itemTypesById.get(linkedItemTypeId)!;
          nextLevelQueue.add(linkedItemType);
        }

        for (const linkedPluginId of linkedPluginIds) {
          const linkedPlugin = exportSchema.pluginsById.get(linkedPluginId)!;

          nextLevelQueue.add(linkedPlugin);
        }
      } else {
        const plugin = itemTypeOrPlugin;

        // Add current node to graph
        graph.nodes.push(buildPluginNode(plugin));
      }
    }

    // If we have nodes for the next level, add them to the queue
    if (nextLevelQueue.size > 0) {
      queue.push([...nextLevelQueue]);
    }
  }

  const sortedGraph = deterministicGraphSort(graph);
  const hierarchy = buildHierarchyNodes(sortedGraph);
  return rebuildGraphWithPositionsFromHierarchy(hierarchy, sortedGraph.edges);
}
