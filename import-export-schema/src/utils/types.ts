import {
  type FieldEdge,
  FieldEdgeRenderer,
} from '@/components/FieldEdgeRenderer';
import {
  type ItemTypeNode,
  ItemTypeNodeRenderer,
} from '@/components/ItemTypeNodeRenderer';
import {
  type PluginNode,
  PluginNodeRenderer,
} from '@/components/PluginNodeRenderer';
import type { SchemaTypes } from '@datocms/cma-client';
import type { FieldAttributes } from '@datocms/cma-client/dist/types/generated/SchemaTypes';
import type { EdgeTypes, NodeTypes } from '@xyflow/react';
import { type HierarchyNode, stratify, tree } from 'd3-hierarchy';
import { get } from 'lodash-es';

export type AppNode = ItemTypeNode | PluginNode;

export const nodeTypes: NodeTypes = {
  itemType: ItemTypeNodeRenderer,
  plugin: PluginNodeRenderer,
};

export type AppEdge = FieldEdge;

export const edgeTypes: EdgeTypes = {
  field: FieldEdgeRenderer,
};

export type Graph = {
  nodes: Array<AppNode>;
  edges: Array<AppEdge>;
};

export const fieldTypeDescription: Record<
  FieldAttributes['field_type'],
  string
> = {
  boolean: 'Boolean',
  color: 'Color',
  date: 'Date',
  date_time: 'DateTime',
  file: 'Single Asset',
  float: 'Floating-point number',
  gallery: 'Asset Gallery',
  integer: 'Integer Number',
  json: 'JSON',
  lat_lon: 'Geolocation',
  link: 'Single Link',
  links: 'Multiple Links',
  seo: 'SEO and Social',
  single_block: 'Modular Content (Single block)',
  rich_text: 'Modular Content (Multiple blocks)',
  slug: 'Slug',
  string: 'Single-line String',
  structured_text: 'Structured Text',
  text: 'Multiple-paragraph Text',
  video: 'External Video',
};

export const fieldTypeEditorsIds: Record<
  FieldAttributes['field_type'],
  string[]
> = {
  string: ['single_line', 'string_radio_group', 'string_select'],
  slug: ['slug'],
  text: ['markdown', 'wysiwyg', 'textarea'],
  rich_text: ['rich_text'],
  single_block: ['framed_single_block', 'frameless_single_block'],
  links: ['links_select', 'links_embed'],
  link: ['link_select', 'link_embed'],
  seo: ['seo'],
  lat_lon: ['map'],
  json: ['json', 'string_multi_select', 'string_checkbox_group'],
  date: ['date_picker'],
  date_time: ['date_time_picker'],
  boolean: ['boolean', 'boolean_radio_group'],
  integer: ['integer'],
  float: ['float'],
  file: ['file'],
  video: ['video'],
  gallery: ['gallery'],
  color: ['color_picker'],
  structured_text: ['structured_text'],
};

export function isHardcodedEditor(editor: string) {
  return Object.values(fieldTypeEditorsIds).flat().includes(editor);
}

export function firstHardcodedEditorFor(
  fieldType: FieldAttributes['field_type'],
) {
  return fieldTypeEditorsIds[fieldType][0];
}

export const validatorsContainingLinks: Array<{
  field_type: FieldAttributes['field_type'];
  validator: string;
}> = [
  { field_type: 'link', validator: 'item_item_type.item_types' },
  { field_type: 'links', validator: 'items_item_type.item_types' },
  {
    field_type: 'structured_text',
    validator: 'structured_text_links.item_types',
  },
];

export const validatorsContainingBlocks: Array<{
  field_type: FieldAttributes['field_type'];
  validator: string;
}> = [
  { field_type: 'rich_text', validator: 'rich_text_blocks.item_types' },
  { field_type: 'single_block', validator: 'single_block_blocks.item_types' },
  {
    field_type: 'structured_text',
    validator: 'structured_text_blocks.item_types',
  },
];

export function findLinkedItemTypeIds(field: SchemaTypes.Field) {
  const fieldLinkedItemTypeIds = new Set<string>();

  const validators = [
    ...validatorsContainingLinks.filter(
      (i) => i.field_type === field.attributes.field_type,
    ),
    ...validatorsContainingBlocks.filter(
      (i) => i.field_type === field.attributes.field_type,
    ),
  ].map((i) => i.validator);

  for (const validator of validators) {
    for (const id of get(field.attributes.validators, validator) as string[]) {
      fieldLinkedItemTypeIds.add(id);
    }
  }

  return fieldLinkedItemTypeIds;
}

export function findLinkedPluginIds(field: SchemaTypes.Field) {
  const fieldLinkedPluginIds = new Set<string>();

  if (!isHardcodedEditor(field.attributes.appearance.editor)) {
    fieldLinkedPluginIds.add(field.attributes.appearance.editor);
  }

  for (const addon of field.attributes.appearance.addons) {
    fieldLinkedPluginIds.add(addon.id);
  }

  return fieldLinkedPluginIds;
}

export function buildHierarchyNodes(
  graph: Graph,
  priorityGivenToEdgesComingFromItemTypeIds?: string[],
) {
  return stratify<AppNode>()
    .id((d) => d.id)
    .parentId((d) => {
      const edgesPointingToNode = graph.edges.filter((e) => {
        return e.target === d.id;
      });

      if (!priorityGivenToEdgesComingFromItemTypeIds) {
        return edgesPointingToNode[0]?.source;
      }

      if (edgesPointingToNode.length <= 0) {
        return edgesPointingToNode[0]?.source;
      }

      const proprityEdges = edgesPointingToNode.filter((e) => {
        return priorityGivenToEdgesComingFromItemTypeIds.includes(e.source);
      });

      const regularEdges = edgesPointingToNode.filter((e) => {
        return !priorityGivenToEdgesComingFromItemTypeIds.includes(e.source);
      });

      return [...proprityEdges, ...regularEdges][0]?.source;
    })(graph.nodes);
}

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
