import { type HierarchyNode, tree } from 'd3-hierarchy';
import type { AppNode, Graph } from './types';

export function rebuildGraphWithPositionsFromHierarchy(
  hierarchy: HierarchyNode<AppNode>,
  edges: Graph['edges'],
): Graph {
  const layout = tree<AppNode>()
    .nodeSize([250, 250])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.2));

  const root = layout(hierarchy);

  return {
    nodes: root.descendants().map((hierarchyNode) => {
      return {
        ...hierarchyNode.data,
        // This bit is super important! We *mutated* the object in the `forEach`
        // above so the reference is the same. React needs to see a new reference
        // to trigger a re-render of the node.
        data: { ...hierarchyNode.data.data },
        // targetPosition : 'left',
        // sourcePosition : 'right',
        position: {
          x: hierarchyNode.x!,
          y: hierarchyNode.y!,
        },
      } as AppNode;
    }),
    edges,
  };
}
