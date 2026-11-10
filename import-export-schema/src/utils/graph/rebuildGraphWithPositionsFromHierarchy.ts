import { type HierarchyNode, tree } from 'd3-hierarchy';
import type { AppNode, Graph } from './types';

// The slot of a node across the tree (its height and the gap to the next
// one) and along it (the 230px node and the room for the edges and their
// dots)
export const defaultRowPitch = 110;
const columnPitch = 350;

/**
 * Convert a D3 hierarchy into positioned React Flow nodes while reusing edge data.
 *
 * The tree grows from left to right: what a model uses stacks in a column
 * next to it. A node is much wider than tall, thus a long list of
 * dependencies fits the pane at a zoom where the names read, instead of
 * running off its sides in one row.
 */
export function rebuildGraphWithPositionsFromHierarchy(
  hierarchy: HierarchyNode<AppNode>,
  edges: Graph['edges'],
  /** A taller slot, for nodes with a pill on their bottom border too */
  rowPitch = defaultRowPitch,
): Graph {
  const layout = tree<AppNode>()
    .nodeSize([rowPitch, columnPitch])
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
          // D3 lays the tree out top-down: its depth (y) is the column
          position: {
            x: hierarchyNode.y ?? 0,
            y: hierarchyNode.x ?? 0,
          },
        } as AppNode;
      }),
    edges,
  };
}
