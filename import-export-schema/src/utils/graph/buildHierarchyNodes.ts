import { stratify } from 'd3-hierarchy';
import type { AppNode, Graph } from './types';

function breakParentCycles(nodeIds: Set<string>, parents: Map<string, string>) {
  const settled = new Set<string>();
  for (const id of nodeIds) {
    const path = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined && !settled.has(current)) {
      if (path.has(current)) {
        parents.delete(current);
        break;
      }
      path.add(current);
      current = parents.get(current);
    }
    for (const member of path) settled.add(member);
  }
}

/** Build a layout forest while retaining cycles and all references in the graph. */
export function buildHierarchyNodes(
  graph: Graph,
  priorityGivenToEdgesComingFromItemTypeIds?: string[],
  fallbackEdges: Array<{ source: string; target: string }> = [],
) {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const priorityNodeIds = new Set(
    (priorityGivenToEdgesComingFromItemTypeIds ?? []).flatMap((id) => [
      id,
      `itemType--${id}`,
      `plugin--${id}`,
    ]),
  );

  const parents = new Map<string, string>();
  const graphTargets = new Set<string>();
  const chooseParent = (source: string, target: string) => {
    if (!nodeIds.has(source) || !nodeIds.has(target)) return;
    const existing = parents.get(target);
    if (
      existing === undefined ||
      (!priorityNodeIds.has(existing) && priorityNodeIds.has(source))
    ) {
      parents.set(target, source);
    }
  };

  // Index inbound candidates once instead of filtering all edges for each node.
  for (const { source, target } of graph.edges) {
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    graphTargets.add(target);
    chooseParent(source, target);
  }
  for (const { source, target } of fallbackEdges) {
    if (!graphTargets.has(target)) chooseParent(source, target);
  }

  // A node has at most one layout parent. Following these pointers detects each
  // cycle in linear time; removing one parent turns it into a valid rooted tree.
  // The original graph edges are untouched, including self-references.
  breakParentCycles(nodeIds, parents);

  const rootIds = new Set(Array.from(nodeIds).filter((id) => !parents.has(id)));
  const hasMultipleRoots = rootIds.size > 1;
  const nodesForHierarchy: AppNode[] = hasMultipleRoots
    ? [
        // Synthetic root only used to satisfy D3's single-root requirement.
        {
          id: 'synthetic-root',
          type: 'plugin',
          position: { x: 0, y: 0 },
          data: {},
        } as unknown as AppNode,
        ...graph.nodes,
      ]
    : graph.nodes;

  return stratify<AppNode>()
    .id((d) => d.id)
    .parentId((d) => {
      if (hasMultipleRoots && rootIds.has(d.id)) {
        return 'synthetic-root';
      }
      return parents.get(d.id);
    })(nodesForHierarchy);
}
