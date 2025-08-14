import {
  findLinkedItemTypeIds,
  findLinkedPluginIds,
} from '@/utils/datocms/schema';
import type { Graph } from '@/utils/graph/types';

export function collectDependencies(
  graph: Graph,
  selectedItemTypeIds: string[],
  installedPluginIds?: Set<string>,
) {
  const beforeItemTypeIds = new Set<string>(selectedItemTypeIds);
  const nextItemTypeIds = new Set<string>(selectedItemTypeIds);
  const nextPluginIds = new Set<string>();

  const queue = [...selectedItemTypeIds];
  while (queue.length > 0) {
    const popped = queue.pop();
    if (!popped) break;
    const id = popped;
    const node = graph.nodes.find((n) => n.id === `itemType--${id}`);
    const fields = node?.type === 'itemType' ? node.data.fields : [];
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

  const addedItemTypeIds = Array.from(nextItemTypeIds).filter(
    (id) => !beforeItemTypeIds.has(id),
  );
  return {
    itemTypeIds: nextItemTypeIds,
    pluginIds: nextPluginIds,
    addedItemTypeIds,
  };
}
