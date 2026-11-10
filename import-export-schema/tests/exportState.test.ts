import type { SchemaTypes } from '@datocms/cma-client';
import { MarkerType } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  type ExportSelection,
  edgesWithExportState,
  exportSummaryText,
  itemTypeExportState,
  nodeExportState,
  pluginExportState,
  summarizeExport,
} from '@/entrypoints/ExportPage/exportState';
import { buildHierarchyNodes } from '@/utils/graph/buildHierarchyNodes';
import { buildItemTypeNode, buildPluginNode } from '@/utils/graph/nodes';
import { rebuildGraphWithPositionsFromHierarchy } from '@/utils/graph/rebuildGraphWithPositionsFromHierarchy';
import type { AppEdge, AppNode } from '@/utils/graph/types';

function itemType(id: string, block = false): SchemaTypes.ItemType {
  return {
    id,
    type: 'item_type',
    attributes: { name: id, api_key: id, modular_block: block },
    relationships: { fields: { data: [] }, fieldsets: { data: [] } },
    meta: { has_singleton_item: false },
  } as unknown as SchemaTypes.ItemType;
}

function plugin(id: string): SchemaTypes.Plugin {
  return {
    id,
    type: 'plugin',
    attributes: { name: id, package_name: id, package_version: '1.0.0' },
  } as unknown as SchemaTypes.Plugin;
}

function edge(source: string, target: string): AppEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    type: 'field',
    data: { fields: [] },
    markerEnd: { type: MarkerType.ArrowClosed },
  };
}

function selection(
  partial: Partial<Record<keyof ExportSelection, string[]>>,
): ExportSelection {
  return {
    initialItemTypeIds: new Set(partial.initialItemTypeIds),
    itemTypeIds: new Set(partial.itemTypeIds),
    pluginIds: new Set(partial.pluginIds),
    dependencyItemTypeIds: new Set(partial.dependencyItemTypeIds),
    dependencyPluginIds: new Set(partial.dependencyPluginIds),
  };
}

// The export starts from the "post" model. The user picked "author", "Add
// what it uses" added the "hero" block and the "seo" plugin, and the "tag"
// model and the "map" plugin are left out.
const nodes: AppNode[] = [
  buildItemTypeNode(itemType('post'), [], []),
  buildItemTypeNode(itemType('author'), [], []),
  buildItemTypeNode(itemType('hero', true), [], []),
  buildItemTypeNode(itemType('tag'), [], []),
  buildPluginNode(plugin('seo')),
  buildPluginNode(plugin('map')),
];

const current = selection({
  initialItemTypeIds: ['post'],
  itemTypeIds: ['post', 'author', 'hero'],
  pluginIds: ['seo'],
  dependencyItemTypeIds: ['hero'],
  dependencyPluginIds: ['seo'],
});

describe('export states', () => {
  it('tells the starting point, a pick, a dependency and what is left out', () => {
    expect(itemTypeExportState(current, 'post')).toBe('start');
    expect(itemTypeExportState(current, 'author')).toBe('picked');
    expect(itemTypeExportState(current, 'hero')).toBe('dependency');
    expect(itemTypeExportState(current, 'tag')).toBe('excluded');
    expect(pluginExportState(current, 'seo')).toBe('dependency');
    expect(pluginExportState(current, 'map')).toBe('excluded');
    expect(nodes.map((node) => nodeExportState(current, node))).toEqual([
      'start',
      'picked',
      'dependency',
      'excluded',
      'dependency',
      'excluded',
    ]);
  });

  it('keeps the starting point in the file even outside the selection', () => {
    const start = selection({ initialItemTypeIds: ['post'] });
    expect(itemTypeExportState(start, 'post')).toBe('start');
  });

  it('reads a dependency that was removed again as not exported', () => {
    const removed = selection({
      itemTypeIds: [],
      dependencyItemTypeIds: ['hero'],
    });
    expect(itemTypeExportState(removed, 'hero')).toBe('excluded');
  });
});

describe('export links', () => {
  const edges = [
    edge('itemType--post', 'itemType--author'),
    edge('itemType--post', 'plugin--seo'),
    edge('itemType--post', 'itemType--tag'),
    edge('itemType--tag', 'plugin--map'),
    edge('itemType--tag', 'itemType--post'),
  ];
  const states = edgesWithExportState(nodes, edges, current);

  it('keeps a link between two exported nodes, in the brand ink', () => {
    expect(states[0].data?.exportState).toBe('included');
    expect(states[1].data?.exportState).toBe('included');
    expect(states[0].markerEnd).toEqual({
      type: MarkerType.ArrowClosed,
      color: 'var(--color--ink-primary)',
    });
  });

  it('drops a link to a node left out, and leaves out the links of one', () => {
    expect(states[2].data?.exportState).toBe('linkDropped');
    expect(states[3].data?.exportState).toBe('excluded');
    expect(states[4].data?.exportState).toBe('excluded');
    expect(states[2].markerEnd).toEqual({ type: MarkerType.ArrowClosed });
  });

  it('keeps the edges and their fields as they are', () => {
    expect(
      states.map(({ id, source, target }) => [id, source, target]),
    ).toEqual(edges.map(({ id, source, target }) => [id, source, target]));
    expect(edges[0].data).toEqual({ fields: [] });
  });
});

describe('export summary', () => {
  const count = (value: number, one: string, other: string) =>
    `${value} ${value === 1 ? one : other}`;

  it('counts what goes in the file by kind, and what is left out', () => {
    const summary = summarizeExport(nodes, current);
    expect(summary).toEqual({
      models: 2,
      blocks: 1,
      plugins: 1,
      notExported: 2,
    });
    expect(exportSummaryText(summary, count)).toBe(
      '2 models, 1 block, 1 plugin will be exported · 2 not exported',
    );
  });

  it('leaves out the kinds with nothing in the file, and an empty remainder', () => {
    const summary = summarizeExport(
      nodes.slice(0, 1),
      selection({ initialItemTypeIds: ['post'] }),
    );
    expect(exportSummaryText(summary, count)).toBe('1 model will be exported');
  });
});

describe('export layout', () => {
  it('spaces the rows by the pitch it gets', () => {
    const graph = {
      nodes: nodes.slice(0, 3),
      edges: [
        edge('itemType--post', 'itemType--author'),
        edge('itemType--post', 'itemType--hero'),
      ],
    };
    const layout = (pitch?: number) =>
      rebuildGraphWithPositionsFromHierarchy(
        buildHierarchyNodes(graph),
        graph.edges,
        pitch,
      ).nodes;
    const gap = (laidOut: AppNode[]) => {
      const [author, hero] = ['itemType--author', 'itemType--hero'].map(
        (id) => laidOut.find((node) => node.id === id)?.position.y ?? 0,
      );
      return Math.abs(author - hero);
    };

    expect(gap(layout())).toBe(110);
    expect(gap(layout(130))).toBe(130);
  });
});
