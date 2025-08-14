import type { SchemaTypes } from '@datocms/cma-client';
import type { ItemTypeNode } from '@/components/ItemTypeNodeRenderer';
import type { PluginNode } from '@/components/PluginNodeRenderer';

export function buildPluginNode(plugin: SchemaTypes.Plugin): PluginNode {
  return {
    id: `plugin--${plugin.id}`,
    position: { x: 0, y: 0 },
    type: 'plugin',
    data: { plugin },
  };
}

export function buildItemTypeNode(
  itemType: SchemaTypes.ItemType,
  fields: SchemaTypes.Field[],
  fieldsets: SchemaTypes.Fieldset[],
): ItemTypeNode {
  return {
    id: `itemType--${itemType.id}`,
    position: { x: 0, y: 0 },
    type: 'itemType',
    data: { itemType, fields, fieldsets },
  };
}
