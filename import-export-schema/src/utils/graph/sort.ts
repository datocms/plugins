import sortBy from 'lodash-es/sortBy';
import type { AppNode, Graph } from '@/utils/graph/types';

/** Stable ordering so layout + list views don't flicker across renders. */
export function deterministicGraphSort(graph: Graph) {
  return {
    nodes: sortBy(graph.nodes, [
      'type',
      (n: AppNode) =>
        'itemType' in n.data ? n.data.itemType.attributes.api_key : undefined,
      (n: AppNode) =>
        'itemType' in n.data
          ? n.data.itemType.attributes.name
          : n.data.plugin.attributes.name,
    ]),
    edges: graph.edges,
  };
}
