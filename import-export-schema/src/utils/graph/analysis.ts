import type { ItemTypeNode } from '@/components/ItemTypeNodeRenderer';
import type { PluginNode } from '@/components/PluginNodeRenderer';
import type { AppEdge, Graph } from './types';

/** Graph analytics helpers for metrics, traversals, and conflict tooling. */

type Adjacency = Map<string, Set<string>>;

function ensure<T>(map: Map<string, Set<T>>, key: string) {
  let set = map.get(key);
  if (!set) {
    set = new Set<T>();
    map.set(key, set);
  }
  return set;
}

export function buildDirectedAdjacency(graph: Graph): Adjacency {
  const adj: Adjacency = new Map();
  for (const node of graph.nodes) {
    ensure(adj, node.id);
  }
  for (const edge of graph.edges) {
    ensure(adj, edge.source).add(edge.target);
    // make sure target exists even if isolated
    ensure(adj, edge.target);
  }
  return adj;
}

export function buildUndirectedAdjacency(graph: Graph): Adjacency {
  const adj: Adjacency = new Map();
  for (const node of graph.nodes) {
    ensure(adj, node.id);
  }
  for (const edge of graph.edges) {
    ensure(adj, edge.source).add(edge.target);
    ensure(adj, edge.target).add(edge.source);
  }
  return adj;
}

/**
 * BFS from a single starting node, collecting all reachable node IDs into `comp`.
 */
function bfsFromNode(
  startId: string,
  adj: Adjacency,
  seen: Set<string>,
  comp: string[],
) {
  const queue: string[] = [startId];
  seen.add(startId);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cur = queue[cursor];
    comp.push(cur);
    const neighbors = adj.get(cur);
    if (!neighbors) continue;
    for (const nb of neighbors) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
}

export function getConnectedComponents(graph: Graph): string[][] {
  const adj = buildUndirectedAdjacency(graph);
  const seen = new Set<string>();
  const components: string[][] = [];

  for (const id of adj.keys()) {
    if (seen.has(id)) continue;
    const comp: string[] = [];
    bfsFromNode(id, adj, seen, comp);
    components.push(comp);
  }

  return components;
}

// Iterative Tarjan: deeply nested block/reference chains must not exhaust the
// JavaScript call stack while computing schema metrics.
export function getStronglyConnectedComponents(graph: Graph): string[][] {
  const adj = buildDirectedAdjacency(graph);
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function getLowlink(id: string) {
    return lowlink.get(id) ?? 0;
  }

  function getIndex(id: string) {
    return indices.get(id) ?? 0;
  }

  function popScc(v: string) {
    const comp: string[] = [];
    let w: string | undefined;
    do {
      w = stack.pop();
      if (w === undefined) break;
      onStack.delete(w);
      comp.push(w);
    } while (w !== v);
    sccs.push(comp);
  }

  function enter(v: string) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    return { id: v, neighbors: (adj.get(v) ?? new Set<string>()).values() };
  }

  function visitNeighbor(
    frame: ReturnType<typeof enter>,
    w: string,
    frames: ReturnType<typeof enter>[],
  ) {
    if (!indices.has(w)) {
      frames.push(enter(w));
    } else if (onStack.has(w)) {
      lowlink.set(frame.id, Math.min(getLowlink(frame.id), getIndex(w)));
    }
  }

  function visit(v: string) {
    const frames = [enter(v)];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const neighbor = frame.neighbors.next();
      if (!neighbor.done) {
        visitNeighbor(frame, neighbor.value, frames);
        continue;
      }

      frames.pop();
      if (getLowlink(frame.id) === getIndex(frame.id)) popScc(frame.id);
      const parent = frames[frames.length - 1];
      if (parent) {
        lowlink.set(
          parent.id,
          Math.min(getLowlink(parent.id), getLowlink(frame.id)),
        );
      }
    }
  }

  for (const v of adj.keys()) {
    if (!indices.has(v)) visit(v);
  }

  return sccs;
}

export function countCycles(graph: Graph): number {
  const sccs = getStronglyConnectedComponents(graph);
  const selfReferences = new Set(
    graph.edges
      .filter((edge) => edge.source === edge.target)
      .map((edge) => edge.source),
  );
  return sccs.filter((comp) => comp.length > 1 || selfReferences.has(comp[0]))
    .length;
}

export function splitNodesByType(graph: Graph): {
  itemTypeNodes: ItemTypeNode[];
  pluginNodes: PluginNode[];
} {
  const itemTypeNodes = graph.nodes.filter(
    (n) => n.type === 'itemType',
  ) as ItemTypeNode[];
  const pluginNodes = graph.nodes.filter(
    (n) => n.type === 'plugin',
  ) as PluginNode[];
  return { itemTypeNodes, pluginNodes };
}

export function findInboundEdges(
  graph: Graph,
  targetId: string,
  sourceWhitelist?: Set<string>,
): AppEdge[] {
  return graph.edges.filter((e) => {
    if (e.target !== targetId) return false;
    if (!sourceWhitelist) return true;
    return sourceWhitelist.has(e.source);
  });
}

export function findOutboundEdges(graph: Graph, sourceId: string): AppEdge[] {
  return graph.edges.filter((e) => e.source === sourceId);
}
