import type { Node } from '@xyflow/react';
import type { Graph } from './src/utils/graph/types';
import { expandSelectionWithDependencies } from './src/utils/graph/dependencies';

/* Minimal stubs for SchemaTypes */
const itemA = { id: 'A', type: 'item_type', attributes: { name: 'A', api_key: 'a', modular_block: false }, relationships: { fieldset: { data: null } } } as any;
const itemB = { id: 'B', type: 'item_type', attributes: { name: 'B', api_key: 'b', modular_block: false }, relationships: { fieldset: { data: null } } } as any;
const fieldLink = {
  id: 'field1',
  type: 'field',
  attributes: {
    label: 'Field 1',
    api_key: 'field_1',
    field_type: 'link',
    validators: {
      item_item_type: { item_types: ['B'] },
    },
  },
  relationships: {
    fieldset: { data: null },
  },
} as any;

const graph: Graph = {
  nodes: [
    {
      id: 'itemType--A',
      type: 'itemType',
      position: { x: 0, y: 0 },
      data: {
        itemType: itemA,
        fields: [fieldLink],
        fieldsets: [],
      },
    } as Node,
    {
      id: 'itemType--B',
      type: 'itemType',
      position: { x: 0, y: 0 },
      data: {
        itemType: itemB,
        fields: [],
        fieldsets: [],
      },
    } as Node,
  ],
  edges: [],
};

const expansion = expandSelectionWithDependencies({
  graph,
  seedItemTypeIds: ['A'],
  seedPluginIds: [],
});

console.log({
  itemTypeIds: Array.from(expansion.itemTypeIds),
  addedItemTypeIds: expansion.addedItemTypeIds,
});
