import { stratify } from 'd3-hierarchy';
import type { AppNode, Graph } from './types';

export function buildHierarchyNodes(
  graph: Graph,
  priorityGivenToEdgesComingFromItemTypeIds?: string[],
) {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const targets = new Set(graph.edges.map((e) => e.target));
  const rootIds = Array.from(nodeIds).filter((id) => !targets.has(id));

  const hasMultipleRoots = rootIds.length > 1;

  const nodesForStratify: AppNode[] = hasMultipleRoots
    ? ([
        // Synthetic root only used to satisfy single-root requirement
        {
          id: 'synthetic-root',
          type: 'plugin',
          position: { x: 0, y: 0 },
          data: {},
        } as unknown as AppNode,
        ...graph.nodes,
      ] as AppNode[])
    : graph.nodes;

  return stratify<AppNode>()
    .id((d) => d.id)
    .parentId((d) => {
      if (hasMultipleRoots && rootIds.includes(d.id)) {
        return 'synthetic-root';
      }

      const edgesPointingToNode = graph.edges.filter((e) => e.target === d.id);

      if (!priorityGivenToEdgesComingFromItemTypeIds) {
        return edgesPointingToNode[0]?.source;
      }

      if (edgesPointingToNode.length <= 0) {
        return edgesPointingToNode[0]?.source;
      }

      const proprityEdges = edgesPointingToNode.filter((e) =>
        priorityGivenToEdgesComingFromItemTypeIds.includes(e.source),
      );

      const regularEdges = edgesPointingToNode.filter(
        (e) => !priorityGivenToEdgesComingFromItemTypeIds.includes(e.source),
      );

      return [...proprityEdges, ...regularEdges][0]?.source;
    })(nodesForStratify);
}
