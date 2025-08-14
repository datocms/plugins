import type { SchemaTypes } from '@datocms/cma-client';
import { buildHierarchyNodes } from '@/utils/graph/buildHierarchyNodes';
import { buildEdgesForItemType } from '@/utils/graph/edges';
import { buildItemTypeNode, buildPluginNode } from '@/utils/graph/nodes';
import { rebuildGraphWithPositionsFromHierarchy } from '@/utils/graph/rebuildGraphWithPositionsFromHierarchy';
import { deterministicGraphSort } from '@/utils/graph/sort';
import type { Graph } from '@/utils/graph/types';
import type { ISchemaSource } from '@/utils/schema/ISchemaSource';

type BuildGraphOptions = {
  source: ISchemaSource;
  initialItemTypes: SchemaTypes.ItemType[];
  selectedItemTypeIds?: string[]; // export use-case to include edges
  itemTypeIdsToSkip?: string[]; // import use-case to avoid edges
  onProgress?: (update: {
    done: number;
    total: number;
    label: string;
    phase?: 'scan' | 'build';
  }) => void;
};

export async function buildGraph({
  source,
  initialItemTypes,
  selectedItemTypeIds = [],
  itemTypeIdsToSkip = [],
  onProgress,
}: BuildGraphOptions): Promise<Graph> {
  const graph: Graph = { nodes: [], edges: [] };

  const knownPluginIds = await source.getKnownPluginIds();

  const rootItemTypeIds = new Set(initialItemTypes.map((it) => it.id));
  const visitedItemTypeIds = new Set<string>(Array.from(rootItemTypeIds));
  const itemTypesById = new Map<string, SchemaTypes.ItemType>(
    initialItemTypes.map((it) => [it.id, it]),
  );
  const fieldsByItemTypeId = new Map<string, SchemaTypes.Field[]>();
  const fieldsetsByItemTypeId = new Map<string, SchemaTypes.Fieldset[]>();
  const discoveredPluginIdsInOrder: string[] = [];
  const pluginsById = new Map<string, SchemaTypes.Plugin>();

  const toExplore: SchemaTypes.ItemType[] = [...initialItemTypes];
  onProgress?.({ done: 0, total: 0, label: 'Scanning schema…', phase: 'scan' });

  while (toExplore.length > 0) {
    const current = toExplore.shift();
    if (!current) break;
    const [fields, fieldsets] =
      await source.getItemTypeFieldsAndFieldsets(current);
    fieldsByItemTypeId.set(current.id, fields);
    fieldsetsByItemTypeId.set(current.id, fieldsets);

    onProgress?.({
      done: 0,
      total: 0,
      label: `Scanning: ${current.attributes.name}`,
      phase: 'scan',
    });

    // Discover neighbors via edges helper
    const [, linkedItemTypeIds, linkedPluginIds] = buildEdgesForItemType(
      current,
      fields,
      new Set(initialItemTypes.map((it) => it.id)),
      knownPluginIds,
    );

    for (const linkedItemTypeId of linkedItemTypeIds) {
      if (!visitedItemTypeIds.has(linkedItemTypeId)) {
        const linked = await source.getItemTypeById(linkedItemTypeId);
        visitedItemTypeIds.add(linkedItemTypeId);
        itemTypesById.set(linkedItemTypeId, linked);
        toExplore.push(linked);
      }
    }
    for (const linkedPluginId of linkedPluginIds) {
      if (!pluginsById.has(linkedPluginId)) {
        const plugin = await source.getPluginById(linkedPluginId);
        pluginsById.set(linkedPluginId, plugin);
        discoveredPluginIdsInOrder.push(linkedPluginId);
      }
    }
  }

  // Total is count of nodes to render
  const total = visitedItemTypeIds.size + pluginsById.size;
  let done = 0;
  onProgress?.({ done, total, label: 'Preparing export…', phase: 'build' });

  for (const itemTypeId of visitedItemTypeIds) {
    const itemType = itemTypesById.get(itemTypeId);
    if (!itemType) {
      continue;
    }
    const fields = fieldsByItemTypeId.get(itemTypeId) || [];
    const fieldsets = fieldsetsByItemTypeId.get(itemTypeId) || [];

    onProgress?.({
      done,
      total,
      label: `Model/Block: ${itemType.attributes.name}`,
      phase: 'build',
    });

    graph.nodes.push(buildItemTypeNode(itemType, fields, fieldsets));

    if (!itemTypeIdsToSkip.includes(itemType.id)) {
      const [edges, linkedItemTypeIds, linkedPluginIds] = buildEdgesForItemType(
        itemType,
        fields,
        rootItemTypeIds,
        knownPluginIds,
      );

      // Include edges when:
      // - No selection was provided (eg. Import graph) → include all edges
      // - The source item type is selected
      // - Any target item type of this edge set is selected
      const includeEdges =
        selectedItemTypeIds.length === 0 ||
        selectedItemTypeIds.includes(itemType.id) ||
        Array.from(linkedItemTypeIds).some((id) =>
          selectedItemTypeIds.includes(id),
        );

      if (includeEdges) {
        graph.edges.push(...edges);
      }

      // Queue discovered neighbors
      for (const linkedItemTypeId of linkedItemTypeIds) {
        if (!visitedItemTypeIds.has(linkedItemTypeId)) {
          const linked = await source.getItemTypeById(linkedItemTypeId);
          visitedItemTypeIds.add(linkedItemTypeId);
          itemTypesById.set(linkedItemTypeId, linked);
          toExplore.push(linked);
        }
      }

      for (const linkedPluginId of linkedPluginIds) {
        if (!pluginsById.has(linkedPluginId)) {
          const plugin = await source.getPluginById(linkedPluginId);
          pluginsById.set(linkedPluginId, plugin);
          discoveredPluginIdsInOrder.push(linkedPluginId);
        }
      }
    }

    done += 1;
    onProgress?.({
      done,
      total,
      label: `Fields/Fieldsets for ${itemType.attributes.name}`,
      phase: 'build',
    });
  }

  for (const pluginId of discoveredPluginIdsInOrder) {
    const plugin = pluginsById.get(pluginId);
    if (!plugin) continue;
    graph.nodes.push(buildPluginNode(plugin));
    done += 1;
    onProgress?.({
      done,
      total,
      label: `Plugin: ${plugin.attributes.name}`,
      phase: 'build',
    });
  }

  const sortedGraph = deterministicGraphSort(graph);
  if (sortedGraph.nodes.length === 0) return sortedGraph;

  const hierarchy = buildHierarchyNodes(sortedGraph, selectedItemTypeIds);
  return rebuildGraphWithPositionsFromHierarchy(hierarchy, sortedGraph.edges);
}
