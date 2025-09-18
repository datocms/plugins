import { stratify } from 'd3-hierarchy';
import type { AppNode, Graph } from './types';

/**
 * Build a D3 hierarchy from the graph, optionally preferring certain inbound edges.
 */
export function buildHierarchyNodes(
  graph: Graph,
  priorityGivenToEdgesComingFromItemTypeIds?: string[],
  fallbackEdges: Array<{ source: string; target: string }> = [],
) {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const targetsFromGraph = new Set(graph.edges.map((e) => e.target));

  const fallbackParentsByTarget = new Map<string, Set<string>>();
  for (const { source, target } of fallbackEdges) {
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      continue;
    }
    const existing = fallbackParentsByTarget.get(target);
    if (existing) {
      existing.add(source);
    } else {
      fallbackParentsByTarget.set(target, new Set([source]));
    }
  }

  const fallbackTargets = new Set(fallbackParentsByTarget.keys());
  const targets = new Set([...targetsFromGraph, ...fallbackTargets]);
  const rootIds = Array.from(nodeIds).filter((id) => !targets.has(id));

  const hasMultipleRoots = rootIds.length > 1;
  const nodesForHierarchy: AppNode[] = hasMultipleRoots
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

  const priorityNodeIds = new Set(
    (priorityGivenToEdgesComingFromItemTypeIds ?? []).flatMap((id) => [
      id,
      `itemType--${id}`,
      `plugin--${id}`,
    ]),
  );

  return stratify<AppNode>()
    .id((d) => d.id)
    .parentId((d) => {
      if (hasMultipleRoots && rootIds.includes(d.id)) {
        return 'synthetic-root';
      }

      const edgesPointingToNode = graph.edges.filter((e) => e.target === d.id);

      const fallbackSources = fallbackParentsByTarget.get(d.id);
      const fallbackCandidates = fallbackSources
        ? Array.from(fallbackSources).map((source) => ({ source }))
        : [];

      const candidates =
        edgesPointingToNode.length > 0 ? edgesPointingToNode : fallbackCandidates;

      if (candidates.length === 0) {
        return candidates[0]?.source;
      }

      if (priorityNodeIds.size === 0) {
        return candidates[0]?.source;
      }

      const priorityEdges = candidates.filter((e) =>
        priorityNodeIds.has(e.source),
      );

      const regularEdges = candidates.filter(
        (e) => !priorityNodeIds.has(e.source),
      );

      return [...priorityEdges, ...regularEdges][0]?.source;
    })(nodesForHierarchy);
}
