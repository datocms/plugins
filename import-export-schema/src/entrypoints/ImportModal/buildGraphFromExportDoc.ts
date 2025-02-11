import {
  type Graph,
  buildHierarchyNodes,
  rebuildGraphWithPositionsFromHierarchy,
} from '@/utils/types';
import type { SchemaTypes } from '@datocms/cma-client';
import { type ExportDoc, ExportSchema } from '../ExportModal/buildExportDoc';
import {
  buildEdgesForItemType,
  buildItemTypeNode,
  buildPluginNode,
  deterministicGraphSort,
} from '../ExportModal/buildGraphFromSchema';

type QueueItem = SchemaTypes.ItemType | SchemaTypes.Plugin;

export function buildGraphFromExportDoc(exportDoc: ExportDoc): Graph {
  const schema = new ExportSchema(exportDoc);

  const graph: Graph = { nodes: [], edges: [] };
  const queue: QueueItem[][] = [[schema.rootItemType]];
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

      if (itemTypeOrPlugin.type === 'item_type') {
        const itemType = itemTypeOrPlugin;

        const fields = schema.findItemTypeFields(itemType);
        const fieldsets = schema.findItemTypeFieldsets(itemType);

        graph.nodes.push(buildItemTypeNode(itemType, fields, fieldsets));

        processedNodes.add(itemType);

        const [edges, linkedItemTypeIds, linkedPluginIds] =
          buildEdgesForItemType(itemType, fields);

        graph.edges.push(...edges);

        for (const linkedItemTypeId of linkedItemTypeIds) {
          const linkedItemType = schema.itemTypesById.get(linkedItemTypeId)!;
          nextLevelQueue.add(linkedItemType);
        }

        for (const linkedPluginId of linkedPluginIds) {
          const linkedPlugin = schema.pluginsById.get(linkedPluginId)!;
          nextLevelQueue.add(linkedPlugin);
        }
      } else {
        const plugin = itemTypeOrPlugin;

        // Add current node to graph
        graph.nodes.push(buildPluginNode(plugin));

        // Mark as processed
        processedNodes.add(plugin);
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
