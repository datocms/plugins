import {
  type AppEdge,
  type AppNode,
  type Graph,
  buildHierarchyNodes,
  rebuildGraphWithPositionsFromHierarchy,
} from '@/utils/types';
import { useMemo } from 'react';

export function useExpandCollapse(
  graph: Graph,
  selectedItemTypeIds: string[],
): Graph {
  return useMemo<{ nodes: AppNode[]; edges: AppEdge[] }>(() => {
    if (graph.nodes.length === 0) {
      return graph;
    }

    const hierarchy = buildHierarchyNodes(graph, selectedItemTypeIds);

    for (const hierarchyNode of hierarchy.descendants()) {
      const innerNode = hierarchy.data;

      if (innerNode.type === 'itemType') {
        hierarchyNode.children = selectedItemTypeIds.includes(
          innerNode.data.itemType.id,
        )
          ? hierarchyNode.children
          : undefined;
      }
    }

    return rebuildGraphWithPositionsFromHierarchy(hierarchy, graph.edges);
  }, [graph, selectedItemTypeIds]);
}
