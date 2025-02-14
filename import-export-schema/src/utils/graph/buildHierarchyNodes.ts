import { stratify } from 'd3-hierarchy';
import type { AppNode, Graph } from './types';

export function buildHierarchyNodes(
  graph: Graph,
  priorityGivenToEdgesComingFromItemTypeIds?: string[],
) {
  return stratify<AppNode>()
    .id((d) => d.id)
    .parentId((d) => {
      const edgesPointingToNode = graph.edges.filter((e) => {
        return e.target === d.id;
      });

      if (!priorityGivenToEdgesComingFromItemTypeIds) {
        return edgesPointingToNode[0]?.source;
      }

      if (edgesPointingToNode.length <= 0) {
        return edgesPointingToNode[0]?.source;
      }

      const proprityEdges = edgesPointingToNode.filter((e) => {
        return priorityGivenToEdgesComingFromItemTypeIds.includes(e.source);
      });

      const regularEdges = edgesPointingToNode.filter((e) => {
        return !priorityGivenToEdgesComingFromItemTypeIds.includes(e.source);
      });

      return [...proprityEdges, ...regularEdges][0]?.source;
    })(graph.nodes);
}
