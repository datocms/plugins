import { type HierarchyNode, tree } from 'd3-hierarchy';
import type { AppNode, Graph } from './types';

/**
 * Convert a D3 hierarchy into positioned React Flow nodes while reusing edge data.
 */
export function rebuildGraphWithPositionsFromHierarchy(
  hierarchy: HierarchyNode<AppNode>,
  edges: Graph['edges'],
): Graph {
  const layout = tree<AppNode>()
    .nodeSize([250, 250])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.2));

  const root = layout(hierarchy);

  return {
    nodes: root
      .descendants()
      .filter((n) => n.data.id !== 'synthetic-root')
      .map((hierarchyNode) => {
        return {
          ...hierarchyNode.data,
          data: { ...hierarchyNode.data.data },
          position: {
            x: hierarchyNode.x!,
            y: hierarchyNode.y!,
          },
        } as AppNode;
      }),
    edges,
  };
}
