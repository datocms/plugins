import type { SchemaTypes } from '@datocms/cma-client';
import { GRAPH_NODE_THRESHOLD } from '@/shared/constants/graph';
import {
  findLinkedItemTypeIds,
  findLinkedPluginIds,
} from '@/utils/datocms/schema';
import { buildHierarchyNodes } from '@/utils/graph/buildHierarchyNodes';
import { buildEdgesForItemType } from '@/utils/graph/edges';
import {
  mapWithConcurrency,
  yieldGraphWork,
} from '@/utils/graph/mapWithConcurrency';
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
  shouldCancel?: () => boolean;
};

type DiscoveryState = {
  itemTypesById: Map<string, SchemaTypes.ItemType>;
  fieldsByItemTypeId: Map<string, SchemaTypes.Field[]>;
  fieldsetsByItemTypeId: Map<string, SchemaTypes.Fieldset[]>;
  pluginsById: Map<string, SchemaTypes.Plugin>;
  discoveredPluginIdsInOrder: string[];
  visitedItemTypeIds: Set<string>;
  scannedItemTypeCount: number;
};

function ensureNotCancelled(shouldCancel: (() => boolean) | undefined) {
  if (shouldCancel?.()) throw new Error('Schema preparation cancelled');
}

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
  newPluginIds: Set<string>,
) {
  state.fieldsByItemTypeId.set(current.id, fields);
  state.fieldsetsByItemTypeId.set(current.id, fieldsets);

  // Discovery only needs IDs: do not allocate the complete edge/field graph twice.
  for (const field of fields) {
    for (const linkedItemTypeId of findLinkedItemTypeIds(field)) {
      if (
        !initialItemTypeIds.has(linkedItemTypeId) &&
        !state.visitedItemTypeIds.has(linkedItemTypeId)
      ) {
        state.visitedItemTypeIds.add(linkedItemTypeId);
        nextFrontierIds.add(linkedItemTypeId);
      }
    }
    for (const linkedPluginId of findLinkedPluginIds(field, knownPluginIds)) {
      if (!state.pluginsById.has(linkedPluginId)) {
        newPluginIds.add(linkedPluginId);
      }
    }
  }

  onProgress?.({
    done: state.scannedItemTypeCount,
    // This is the number discovered so far; it grows as links are scanned.
    total: state.visitedItemTypeIds.size,
    label: `Scanning: ${current.attributes.name}`,
    phase: 'scan',
  });
}

/**
 * Traverse breadth-first without allocating one promise/request per model.
 * Results are consumed in discovery order, regardless of request completion order.
 */
async function processBfsFrontiers(
  initialFrontier: SchemaTypes.ItemType[],
  source: ISchemaSource,
  initialItemTypeIds: Set<string>,
  knownPluginIds: Set<string>,
  onProgress: ((update: SchemaProgressUpdate) => void) | undefined,
  state: DiscoveryState,
  shouldCancel: (() => boolean) | undefined,
): Promise<void> {
  let frontier = initialFrontier;
  const concurrency = source.maxConcurrentRequests ?? 2;

  while (frontier.length > 0) {
    // biome-ignore lint/performance/noAwaitInLoops: each bounded frontier discovers the next one.
    const fieldResults = await mapWithConcurrency(
      frontier,
      concurrency,
      async (current) => {
        const result = await source.getItemTypeFieldsAndFieldsets(current);
        ensureNotCancelled(shouldCancel);
        state.scannedItemTypeCount += 1;
        onProgress?.({
          done: state.scannedItemTypeCount,
          total: state.visitedItemTypeIds.size,
          label: `Scanning: ${current.attributes.name}`,
          phase: 'scan',
        });
        return result;
      },
      shouldCancel,
    );
    const nextFrontierIds = new Set<string>();
    const newPluginIds = new Set<string>();

    for (let i = 0; i < frontier.length; i++) {
      if (i > 0 && i % 50 === 0) {
        // biome-ignore lint/performance/noAwaitInLoops: dependency scans must leave time for browser progress and cancellation.
        await yieldGraphWork();
      }
      ensureNotCancelled(shouldCancel);
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

    const references = [
      ...Array.from(nextFrontierIds, (id) => ({
        id,
        type: 'itemType' as const,
      })),
      ...Array.from(newPluginIds, (id) => ({ id, type: 'plugin' as const })),
    ];
    const newItemTypes: SchemaTypes.ItemType[] = [];
    const entities = await mapWithConcurrency(
      references,
      concurrency,
      async (reference): Promise<SchemaTypes.ItemType | SchemaTypes.Plugin> =>
        reference.type === 'itemType'
          ? source.getItemTypeById(reference.id)
          : source.getPluginById(reference.id),
      shouldCancel,
    );
    for (const entity of entities) {
      if (entity.type === 'item_type') {
        state.itemTypesById.set(entity.id, entity);
        newItemTypes.push(entity);
      } else {
        state.pluginsById.set(entity.id, entity);
        state.discoveredPluginIdsInOrder.push(entity.id);
      }
    }
    frontier = newItemTypes;
  }
}

/**
 * Discover all item types and plugins reachable from the initial set.
 */
async function discoverReachableEntities(
  source: ISchemaSource,
  initialItemTypes: SchemaTypes.ItemType[],
  knownPluginIds: Set<string>,
  onProgress: ((update: SchemaProgressUpdate) => void) | undefined,
  shouldCancel: (() => boolean) | undefined,
): Promise<DiscoveryState> {
  const initialItemTypeIds = new Set(initialItemTypes.map((it) => it.id));

  const state: DiscoveryState = {
    visitedItemTypeIds: new Set(initialItemTypeIds),
    itemTypesById: new Map(initialItemTypes.map((it) => [it.id, it])),
    fieldsByItemTypeId: new Map(),
    fieldsetsByItemTypeId: new Map(),
    discoveredPluginIdsInOrder: [],
    pluginsById: new Map(),
    scannedItemTypeCount: 0,
  };

  onProgress?.({
    done: 0,
    total: initialItemTypeIds.size,
    label: 'Scanning schema…',
    phase: 'scan',
  });

  await processBfsFrontiers(
    Array.from(state.itemTypesById.values()),
    source,
    initialItemTypeIds,
    knownPluginIds,
    onProgress,
    state,
    shouldCancel,
  );

  return state;
}

type ProcessItemTypeOptions = {
  itemType: SchemaTypes.ItemType;
  fields: SchemaTypes.Field[];
  fieldsets: SchemaTypes.Fieldset[];
  rootItemTypeIds: Set<string>;
  knownPluginIds: Set<string>;
  itemTypeIdsToSkip: Set<string>;
  graph: Graph;
};

function processItemTypeNode({
  itemType,
  fields,
  fieldsets,
  rootItemTypeIds,
  knownPluginIds,
  itemTypeIdsToSkip,
  graph,
}: ProcessItemTypeOptions) {
  graph.nodes.push(buildItemTypeNode(itemType, fields, fieldsets));

  if (itemTypeIdsToSkip.has(itemType.id)) {
    return;
  }

  const [edges] = buildEdgesForItemType(
    itemType,
    fields,
    rootItemTypeIds,
    knownPluginIds,
  );

  graph.edges.push(...edges);
}

export async function buildGraph({
  source,
  initialItemTypes,
  selectedItemTypeIds = [],
  itemTypeIdsToSkip = [],
  onProgress,
  shouldCancel,
}: BuildGraphOptions): Promise<Graph> {
  const graph: Graph = { nodes: [], edges: [] };

  ensureNotCancelled(shouldCancel);
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
    shouldCancel,
  );

  const itemTypeIdsToSkipSet = new Set(itemTypeIdsToSkip);

  const total = visitedItemTypeIds.size + pluginsById.size;
  let done = 0;
  onProgress?.({ done, total, label: 'Preparing export…', phase: 'build' });

  for (const itemTypeId of visitedItemTypeIds) {
    if (done > 0 && done % 50 === 0) {
      // biome-ignore lint/performance/noAwaitInLoops: graph construction must remain responsive for large local schemas.
      await yieldGraphWork();
    }
    ensureNotCancelled(shouldCancel);
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
      itemTypeIdsToSkip: itemTypeIdsToSkipSet,
      graph,
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
    ensureNotCancelled(shouldCancel);
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
  ensureNotCancelled(shouldCancel);

  // The UI already switches to the list above this threshold. Keep the optional
  // "Render it anyway" view usable without constructing a large D3 tree.
  if (sortedGraph.nodes.length > GRAPH_NODE_THRESHOLD) {
    const columns = Math.ceil(Math.sqrt(sortedGraph.nodes.length));
    return {
      ...sortedGraph,
      nodes: sortedGraph.nodes.map((node, index) => ({
        ...node,
        position: {
          x: (index % columns) * 250,
          y: Math.floor(index / columns) * 250,
        },
      })),
    };
  }

  const hierarchy = buildHierarchyNodes(sortedGraph, selectedItemTypeIds);
  return rebuildGraphWithPositionsFromHierarchy(hierarchy, sortedGraph.edges);
}
