import type { SchemaTypes } from '@datocms/cma-client';
import { describe, expect, it } from 'vitest';
import {
  countCycles,
  getConnectedComponents,
  getStronglyConnectedComponents,
} from '@/utils/graph/analysis';
import { buildHierarchyNodes } from '@/utils/graph/buildHierarchyNodes';
import { buildEdgesForItemType } from '@/utils/graph/edges';
import { buildItemTypeNode } from '@/utils/graph/nodes';
import { rebuildGraphWithPositionsFromHierarchy } from '@/utils/graph/rebuildGraphWithPositionsFromHierarchy';
import type { AppEdge, Graph } from '@/utils/graph/types';

function model(id: string): SchemaTypes.ItemType {
  return {
    id,
    type: 'item_type',
    attributes: { name: id, api_key: id, modular_block: false },
    relationships: { fields: { data: [] }, fieldsets: { data: [] } },
    meta: { has_singleton_item: false },
  } as unknown as SchemaTypes.ItemType;
}

function edge(source: string, target: string): AppEdge {
  return {
    id: `${source}->${target}`,
    source: `itemType--${source}`,
    target: `itemType--${target}`,
    type: 'field',
    data: { fields: [] },
  };
}

function graph(ids: string[], connections: [string, string][]): Graph {
  return {
    nodes: ids.map((id) => buildItemTypeNode(model(id), [], [])),
    edges: connections.map(([source, target]) => edge(source, target)),
  };
}

describe('cyclic graph layout and analysis', () => {
  it('lays out disconnected cycles and self references without dropping graph edges', () => {
    const input = graph(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'b'],
        ['b', 'a'],
        ['c', 'c'],
        ['d', 'e'],
        ['e', 'missing'],
      ],
    );
    const hierarchy = buildHierarchyNodes(input);
    const output = rebuildGraphWithPositionsFromHierarchy(
      hierarchy,
      input.edges,
    );
    expect(output.nodes).toHaveLength(5);
    expect(output.nodes.some(({ id }) => id === 'synthetic-root')).toBe(false);
    expect(output.edges).toBe(input.edges);
    expect(
      output.nodes.every(
        ({ position }) =>
          Number.isFinite(position.x) && Number.isFinite(position.y),
      ),
    ).toBe(true);
    expect(countCycles(input)).toBe(2);
  });

  it('preserves inbound parent priority and uses indexed fallback parents', () => {
    const input = graph(
      ['a', 'b', 'c', 'target', 'fallback'],
      [
        ['a', 'target'],
        ['b', 'target'],
        ['c', 'target'],
      ],
    );
    const hierarchy = buildHierarchyNodes(
      input,
      ['b'],
      [
        { source: 'itemType--a', target: 'itemType--fallback' },
        { source: 'itemType--b', target: 'itemType--fallback' },
      ],
    );
    expect(
      hierarchy.find((node) => node.id === 'itemType--target')?.parent?.id,
    ).toBe('itemType--b');
    expect(
      hierarchy.find((node) => node.id === 'itemType--fallback')?.parent?.id,
    ).toBe('itemType--b');
  });

  it('visits a nested 1,000-node cycle iteratively and keeps isolated components', () => {
    const ids = Array.from({ length: 1_000 }, (_, index) => String(index));
    const connections: [string, string][] = ids.map((id, index) => [
      id,
      String((index + 1) % ids.length),
    ]);
    const input = graph([...ids, 'isolated'], connections);
    const components = getStronglyConnectedComponents(input);
    expect(
      components.map((component) => component.length).sort((a, b) => a - b),
    ).toEqual([1, 1_000]);
    expect(
      getConnectedComponents(input).map((component) => component.length),
    ).toEqual([1_000, 1]);
    expect(countCycles(input)).toBe(1);
  });

  it('aggregates repeated links from 1,000 fields without losing field membership', () => {
    const itemType = model('owner');
    const fields = Array.from(
      { length: 1_000 },
      (_, index) =>
        ({
          id: String(index),
          type: 'field',
          attributes: {
            field_type: 'structured_text',
            validators: {
              structured_text_links: { item_types: ['target', 'target'] },
              structured_text_blocks: { item_types: ['block'] },
              structured_text_inline_blocks: { item_types: ['inline'] },
            },
            appearance: {
              editor: 'shared-plugin',
              addons: [{ id: 'shared-plugin', parameters: {} }],
              parameters: {},
            },
          },
        }) as SchemaTypes.Field,
    );
    const [edges, itemTypeIds, pluginIds] = buildEdgesForItemType(
      itemType,
      fields,
      new Set(),
      new Set(['shared-plugin']),
    );
    expect(edges).toHaveLength(4);
    expect(itemTypeIds).toEqual(new Set(['target', 'block', 'inline']));
    expect(pluginIds).toEqual(new Set(['shared-plugin']));
    for (const dependencyEdge of edges) {
      expect(dependencyEdge.data?.fields).toHaveLength(1_000);
      expect(dependencyEdge.data?.fields.map(({ id }) => id)).toEqual(
        fields.map(({ id }) => id),
      );
    }
  });
});
