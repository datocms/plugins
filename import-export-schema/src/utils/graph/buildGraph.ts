import type { SchemaTypes } from '@datocms/cma-client';
import { buildHierarchyNodes } from '@/utils/graph/buildHierarchyNodes';
import { buildEdgesForItemType } from '@/utils/graph/edges';
import { buildItemTypeNode, buildPluginNode } from '@/utils/graph/nodes';
import { rebuildGraphWithPositionsFromHierarchy } from '@/utils/graph/rebuildGraphWithPositionsFromHierarchy';
import { deterministicGraphSort } from '@/utils/graph/sort';
import type { Graph, SchemaProgressUpdate } from '@/utils/graph/types';
import type { ISchemaSource } from '@/utils/schema/ISchemaSource';

/** Build a dependency graph from any schema source, reporting progress as we traverse. */
type BuildGraphOptions = {
  source: ISchemaSource;
  initialItemTypes: SchemaTypes.ItemType[];
  selectedItemTypeIds?: string[]; // export use-case to include edges
  itemTypeIdsToSkip?: string[]; // import use-case to avoid edges
  onProgress?: (update: SchemaProgressUpdate) => void;
};

type DiscoveryState = {
  itemTypesById: Map<string, SchemaTypes.ItemType>;
  fieldsByItemTypeId: Map<string, SchemaTypes.Field[]>;
  fieldsetsByItemTypeId: Map<string, SchemaTypes.Fieldset[]>;
  pluginsById: Map<string, SchemaTypes.Plugin>;
  discoveredPluginIdsInOrder: string[];
  visitedItemTypeIds: Set<string>;
};

/**
 * Process one BFS frontier item: store its fields, discover linked item types and plugins.
 */
function processFrontierItem(
  current: SchemaTypes.ItemType,
  fields: SchemaTypes.Field[],
  fieldsets: SchemaTypes.Fieldset[],
  initialItemTypeIds: Set<string>,
  knownPluginIds: Set<string>,
  onProgress: ((update: SchemaProgressUpdate) => void) | undefined,
  state: DiscoveryState,
  nextFrontierIds: Set<string>,
  newPluginIds: string[],
) {
  state.fieldsByItemTypeId.set(current.id, fields);
  state.fieldsetsByItemTypeId.set(current.id, fieldsets);

  onProgress?.({
    done: 0,
    total: 0,
    label: `Scanning: ${current.attributes.name}`,
    phase: 'scan',
  });

  const [, linkedItemTypeIds, linkedPluginIds] = buildEdgesForItemType(
    current,
    fields,
    initialItemTypeIds,
    knownPluginIds,
  );

  for (const linkedItemTypeId of linkedItemTypeIds) {
    if (!state.visitedItemTypeIds.has(linkedItemTypeId)) {
      state.visitedItemTypeIds.add(linkedItemTypeId);
      nextFrontierIds.add(linkedItemTypeId);
    }
  }

  for (const linkedPluginId of linkedPluginIds) {
    if (!state.pluginsById.has(linkedPluginId)) {
      newPluginIds.push(linkedPluginId);
    }
  }
}

/**
 * Process one BFS frontier level and schedule the next via recursion.
 * Each level's items are fetched in parallel; levels are chained recursively
 * to avoid await inside a loop construct.
 */
async function processBfsFrontier(
  frontier: SchemaTypes.ItemType[],
  source: ISchemaSource,
  initialItemTypeIds: Set<string>,
  knownPluginIds: Set<string>,
  onProgress: ((update: SchemaProgressUpdate) => void) | undefined,
  state: DiscoveryState,
): Promise<void> {
  if (frontier.length === 0) return;

  // Fetch fields for all item types in the current frontier level in parallel
  const fieldResults = await Promise.all(
    frontier.map((current) => source.getItemTypeFieldsAndFieldsets(current)),
  );

  const nextFrontierIds = new Set<string>();
  const newPluginIds: string[] = [];

  for (let i = 0; i < frontier.length; i++) {
    processFrontierItem(
      frontier[i],
      fieldResults[i][0],
      fieldResults[i][1],
      initialItemTypeIds,
      knownPluginIds,
      onProgress,
      state,
      nextFrontierIds,
      newPluginIds,
    );
  }

  // Fetch all newly discovered item types and plugins in parallel
  const [newItemTypes, newPlugins] = await Promise.all([
    Promise.all(
      Array.from(nextFrontierIds).map((id) => source.getItemTypeById(id)),
    ),
    Promise.all(newPluginIds.map((id) => source.getPluginById(id))),
  ]);

  for (const itemType of newItemTypes) {
    state.itemTypesById.set(itemType.id, itemType);
  }

  for (let i = 0; i < newPluginIds.length; i++) {
    const pluginId = newPluginIds[i];
    if (!state.pluginsById.has(pluginId)) {
      state.pluginsById.set(pluginId, newPlugins[i]);
      state.discoveredPluginIdsInOrder.push(pluginId);
    }
  }

  // Recurse into the next BFS level (avoids await-in-loop)
  await processBfsFrontier(
    newItemTypes,
    source,
    initialItemTypeIds,
    knownPluginIds,
    onProgress,
    state,
  );
}

/**
 * Discover all item types and plugins reachable from the initial set.
 */
async function discoverReachableEntities(
  source: ISchemaSource,
  initialItemTypes: SchemaTypes.ItemType[],
  knownPluginIds: Set<string>,
  onProgress: ((update: SchemaProgressUpdate) => void) | undefined,
): Promise<DiscoveryState> {
  const initialItemTypeIds = new Set(initialItemTypes.map((it) => it.id));

  const state: DiscoveryState = {
    visitedItemTypeIds: new Set(initialItemTypeIds),
    itemTypesById: new Map(initialItemTypes.map((it) => [it.id, it])),
    fieldsByItemTypeId: new Map(),
    fieldsetsByItemTypeId: new Map(),
    discoveredPluginIdsInOrder: [],
    pluginsById: new Map(),
  };

  onProgress?.({ done: 0, total: 0, label: 'Scanning schema…', phase: 'scan' });

  await processBfsFrontier(
    [...initialItemTypes],
    source,
    initialItemTypeIds,
    knownPluginIds,
    onProgress,
    state,
  );

  return state;
}

type ProcessItemTypeOptions = {
  itemType: SchemaTypes.ItemType;
  fields: SchemaTypes.Field[];
  fieldsets: SchemaTypes.Fieldset[];
  rootItemTypeIds: Set<string>;
  knownPluginIds: Set<string>;
  selectedItemTypeIds: string[];
  itemTypeIdsToSkip: string[];
  graph: Graph;
  hierarchyEdgeSet: Set<string>;
  hierarchyEdges: Array<{ source: string; target: string }>;
};

function recordHierarchyEdge(
  sourceId: string,
  targetId: string,
  hierarchyEdgeSet: Set<string>,
  hierarchyEdges: Array<{ source: string; target: string }>,
) {
  const key = `${sourceId}->${targetId}`;
  if (hierarchyEdgeSet.has(key)) {
    return;
  }
  hierarchyEdgeSet.add(key);
  hierarchyEdges.push({ source: sourceId, target: targetId });
}

function processItemTypeNode({
  itemType,
  fields,
  fieldsets,
  rootItemTypeIds,
  knownPluginIds,
  selectedItemTypeIds,
  itemTypeIdsToSkip,
  graph,
  hierarchyEdgeSet,
  hierarchyEdges,
}: ProcessItemTypeOptions) {
  graph.nodes.push(buildItemTypeNode(itemType, fields, fieldsets));

  if (itemTypeIdsToSkip.includes(itemType.id)) {
    return;
  }

  const [edges, linkedItemTypeIds, linkedPluginIds] = buildEdgesForItemType(
    itemType,
    fields,
    rootItemTypeIds,
    knownPluginIds,
  );

  for (const linkedItemTypeId of linkedItemTypeIds) {
    recordHierarchyEdge(
      `itemType--${itemType.id}`,
      `itemType--${linkedItemTypeId}`,
      hierarchyEdgeSet,
      hierarchyEdges,
    );
  }

  for (const linkedPluginId of linkedPluginIds) {
    recordHierarchyEdge(
      `itemType--${itemType.id}`,
      `plugin--${linkedPluginId}`,
      hierarchyEdgeSet,
      hierarchyEdges,
    );
  }

  const includeEdges =
    selectedItemTypeIds.length === 0 ||
    selectedItemTypeIds.includes(itemType.id) ||
    Array.from(linkedItemTypeIds).some((id) =>
      selectedItemTypeIds.includes(id),
    ) ||
    edges.length > 0;

  if (includeEdges) {
    graph.edges.push(...edges);
  }
}

export async function buildGraph({
  source,
  initialItemTypes,
  selectedItemTypeIds = [],
  itemTypeIdsToSkip = [],
  onProgress,
}: BuildGraphOptions): Promise<Graph> {
  const graph: Graph = { nodes: [], edges: [] };
  const hierarchyEdgeSet = new Set<string>();
  const hierarchyEdges: Array<{ source: string; target: string }> = [];

  const knownPluginIds = await source.getKnownPluginIds();
  const rootItemTypeIds = new Set(initialItemTypes.map((it) => it.id));

  const {
    itemTypesById,
    fieldsByItemTypeId,
    fieldsetsByItemTypeId,
    pluginsById,
    discoveredPluginIdsInOrder,
    visitedItemTypeIds,
  } = await discoverReachableEntities(
    source,
    initialItemTypes,
    knownPluginIds,
    onProgress,
  );

  const total = visitedItemTypeIds.size + pluginsById.size;
  let done = 0;
  onProgress?.({ done, total, label: 'Preparing export…', phase: 'build' });

  for (const itemTypeId of visitedItemTypeIds) {
    const itemType = itemTypesById.get(itemTypeId);
    if (!itemType) {
      continue;
    }
    const fields = fieldsByItemTypeId.get(itemTypeId) ?? [];
    const fieldsets = fieldsetsByItemTypeId.get(itemTypeId) ?? [];

    onProgress?.({
      done,
      total,
      label: `Model/Block: ${itemType.attributes.name}`,
      phase: 'build',
    });

    processItemTypeNode({
      itemType,
      fields,
      fieldsets,
      rootItemTypeIds,
      knownPluginIds,
      selectedItemTypeIds,
      itemTypeIdsToSkip,
      graph,
      hierarchyEdgeSet,
      hierarchyEdges,
    });

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

  const hierarchy = buildHierarchyNodes(
    sortedGraph,
    selectedItemTypeIds,
    hierarchyEdges,
  );
  return rebuildGraphWithPositionsFromHierarchy(hierarchy, sortedGraph.edges);
}
