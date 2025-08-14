import type { ItemTypeNode } from '@/components/ItemTypeNodeRenderer';
import type { PluginNode } from '@/components/PluginNodeRenderer';
import type { AppEdge, Graph } from './types';

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

export function getConnectedComponents(graph: Graph): string[][] {
  const adj = buildUndirectedAdjacency(graph);
  const seen = new Set<string>();
  const components: string[][] = [];

  for (const id of adj.keys()) {
    if (seen.has(id)) continue;
    const comp: string[] = [];
    const queue: string[] = [id];
    seen.add(id);
    while (queue.length) {
      const cur = queue.shift()!;
      comp.push(cur);
      for (const nb of adj.get(cur)!) {
        if (!seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(comp);
  }

  return components;
}

// Tarjan's algorithm for SCCs
export function getStronglyConnectedComponents(graph: Graph): string[][] {
  const adj = buildDirectedAdjacency(graph);
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongconnect(v: string) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v)!) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
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
  }

  for (const v of adj.keys()) {
    if (!indices.has(v)) strongconnect(v);
  }

  return sccs;
}

export function countCycles(graph: Graph): number {
  const sccs = getStronglyConnectedComponents(graph);
  return sccs.filter((comp) => comp.length > 1).length;
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
