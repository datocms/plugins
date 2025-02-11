import type { ItemTypeNode } from '@/components/ItemTypeNodeRenderer';
import { PluginNode } from '@/components/PluginNodeRenderer';
import type { ItemTypeManager } from '@/utils/itemTypeManager';
import {
  type AppEdge,
  type Graph,
  findLinkedItemTypeIds,
  findLinkedPluginIds,
} from '@/utils/types';
import type { SchemaTypes } from '@datocms/cma-client';
import { MarkerType } from '@xyflow/react';
import { find, sortBy } from 'lodash-es';

type Options = {
  initialItemType: SchemaTypes.ItemType;
  selectedItemTypeIds: string[];
  schema: ItemTypeManager;
};

type QueueItem = SchemaTypes.ItemType | SchemaTypes.Plugin;

export async function buildGraphFromSchema({
  initialItemType,
  selectedItemTypeIds,
  schema,
}: Options): Promise<Graph> {
  const graph: Graph = { nodes: [], edges: [] };

  const queue: QueueItem[][] = [[initialItemType]];
  const processedNodes = new Set<QueueItem>();

  // Process each level of the graph
  while (queue.length > 0) {
    const currentLevelItems = queue.shift();

    if (!currentLevelItems) {
      throw new Error('Unexpected error: currentLevelItemTypes is undefined');
    }

    const nextLevelQueue = new Set<QueueItem>();

    // Process all nodes at the current level in parallel
    await Promise.all(
      currentLevelItems.map(async (itemTypeOrPlugin) => {
        // Skip if already processed
        if (processedNodes.has(itemTypeOrPlugin)) {
          return;
        }

        if (itemTypeOrPlugin.type === 'item_type') {
          const itemType = itemTypeOrPlugin;

          // Process fields and collect child nodes
          const [fields, fieldsets] =
            await schema.getItemTypeFieldsAndFieldsets(itemType);

          // Add current node to graph
          graph.nodes.push(buildItemTypeNode(itemType, fields, fieldsets));

          // Mark as processed
          processedNodes.add(itemType);

          if (!selectedItemTypeIds.includes(itemType.id)) {
            return;
          }

          const [edges, linkedItemTypeIds, linkedPluginIds] =
            buildEdgesForItemType(itemType, fields);

          graph.edges.push(...edges);

          // Process all item types in parallel
          await Promise.all([
            ...Array.from(linkedItemTypeIds).map(async (linkedItemTypeId) => {
              const linkedItemType =
                await schema.getItemTypeById(linkedItemTypeId);

              if (!processedNodes.has(linkedItemType)) {
                nextLevelQueue.add(linkedItemType);
              }
            }),
            ...Array.from(linkedPluginIds).map(async (linkedPluginId) => {
              const linkedPlugin = await schema.getPluginById(linkedPluginId);

              if (!processedNodes.has(linkedPlugin)) {
                nextLevelQueue.add(linkedPlugin);
              }
            }),
          ]);
        } else {
          const plugin = itemTypeOrPlugin;

          // Add current node to graph
          graph.nodes.push(buildPluginNode(plugin));

          // Mark as processed
          processedNodes.add(plugin);
        }
      }),
    );

    // If we have nodes for the next level, add them to the queue
    if (nextLevelQueue.size > 0) {
      queue.push([...nextLevelQueue]);
    }
  }

  return deterministicGraphSort(graph);
}

export function buildEdgesForItemType(
  itemType: SchemaTypes.ItemType,
  fields: SchemaTypes.Field[],
) {
  const edges: AppEdge[] = [];
  const linkedItemTypeIds = new Set<string>();
  const linkedPluginIds = new Set<string>();

  for (const field of fields) {
    for (const linkedItemTypeId of findLinkedItemTypeIds(field)) {
      const id = `toItemType--${itemType.id}->${linkedItemTypeId}`;
      linkedItemTypeIds.add(linkedItemTypeId);

      const edge = find(edges, { id });

      if (edge) {
        edge.data!.fields.push(field);
      } else {
        edges.push({
          id,
          source: `itemType--${itemType.id}`,
          target: `itemType--${linkedItemTypeId}`,
          type: 'field',
          data: { fields: [field] },
          markerEnd: { type: MarkerType.ArrowClosed },
        });
      }
    }

    for (const linkedPluginId of findLinkedPluginIds(field)) {
      const id = `toPlugin--${itemType.id}->${linkedPluginId}`;
      const edge = find(edges, { id });
      linkedPluginIds.add(linkedPluginId);

      if (edge) {
        edge.data!.fields.push(field);
      } else {
        edges.push({
          id,
          source: `itemType--${itemType.id}`,
          target: `plugin--${linkedPluginId}`,
          type: 'field',
          data: { fields: [field] },
          markerEnd: { type: MarkerType.ArrowClosed },
        });
      }
    }
  }

  return [edges, linkedItemTypeIds, linkedPluginIds] as const;
}

export function buildPluginNode(plugin: SchemaTypes.Plugin): PluginNode {
  return {
    id: `plugin--${plugin.id}`,
    position: {
      x: 0,
      y: 0,
    },
    type: 'plugin',
    data: {
      plugin,
    },
  };
}

export function buildItemTypeNode(
  itemType: SchemaTypes.ItemType,
  fields: SchemaTypes.Field[],
  fieldsets: SchemaTypes.Fieldset[],
): ItemTypeNode {
  return {
    id: `itemType--${itemType.id}`,
    position: {
      x: 0,
      y: 0,
    },
    type: 'itemType',
    data: {
      itemType,
      fields,
      fieldsets,
    },
  };
}

export function deterministicGraphSort(graph: Graph) {
  return {
    nodes: sortBy(graph.nodes, [
      'type',
      'data.itemType.attributes.api_key',
      'data.itemType.attributes.name',
    ]),
    edges: graph.edges,
  };
}
