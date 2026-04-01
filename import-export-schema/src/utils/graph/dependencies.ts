import type { SchemaTypes } from '@datocms/cma-client';
import {
  findLinkedItemTypeIds,
  findLinkedPluginIds,
} from '@/utils/datocms/schema';
import type { Graph } from '@/utils/graph/types';

export type DependencyExpansionResult = {
  itemTypeIds: Set<string>;
  pluginIds: Set<string>;
  addedItemTypeIds: string[];
  addedPluginIds: string[];
};

type ExpandOptions = {
  graph?: Graph;
  seedItemTypeIds: Iterable<string>;
  seedPluginIds: Iterable<string>;
  installedPluginIds?: Set<string>;
};

function collectFieldDependencies(
  fields: SchemaTypes.Field[],
  nextItemTypeIds: Set<string>,
  nextPluginIds: Set<string>,
  installedPluginIds: Set<string> | undefined,
  queue: string[],
) {
  for (const field of fields) {
    for (const linkedId of findLinkedItemTypeIds(field)) {
      if (!nextItemTypeIds.has(linkedId)) {
        nextItemTypeIds.add(linkedId);
        queue.push(linkedId);
      }
    }
    for (const pluginId of findLinkedPluginIds(field, installedPluginIds)) {
      nextPluginIds.add(pluginId);
    }
  }
}

/**
 * Expand the current selection with all linked item types and plugins.
 */
export function expandSelectionWithDependencies({
  graph,
  seedItemTypeIds,
  seedPluginIds,
  installedPluginIds,
}: ExpandOptions): DependencyExpansionResult {
  const initialItemIds = Array.from(new Set(seedItemTypeIds));
  const initialPluginIds = Array.from(new Set(seedPluginIds));
  const nextItemTypeIds = new Set(initialItemIds);
  const nextPluginIds = new Set(initialPluginIds);

  if (!graph) {
    return {
      itemTypeIds: nextItemTypeIds,
      pluginIds: nextPluginIds,
      addedItemTypeIds: [],
      addedPluginIds: [],
    };
  }

  const queue = [...initialItemIds];
  while (queue.length > 0) {
    const currentId = queue.pop();
    if (!currentId) continue;
    const node = graph.nodes.find(
      (candidate) => candidate.id === `itemType--${currentId}`,
    );
    if (!node || node.type !== 'itemType') continue;

    collectFieldDependencies(
      node.data.fields,
      nextItemTypeIds,
      nextPluginIds,
      installedPluginIds,
      queue,
    );
  }

  const addedItemTypeIds = Array.from(nextItemTypeIds).filter(
    (id) => !initialItemIds.includes(id),
  );
  const addedPluginIds = Array.from(nextPluginIds).filter(
    (id) => !initialPluginIds.includes(id),
  );

  return {
    itemTypeIds: nextItemTypeIds,
    pluginIds: nextPluginIds,
    addedItemTypeIds,
    addedPluginIds,
  };
}
