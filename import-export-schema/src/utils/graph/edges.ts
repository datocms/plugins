import type { SchemaTypes } from '@datocms/cma-client';
import { MarkerType } from '@xyflow/react';
import find from 'lodash-es/find';
import {
  findLinkedItemTypeIds,
  findLinkedPluginIds,
} from '@/utils/datocms/schema';
import type { AppEdge } from '@/utils/graph/types';

/** Build edges for a single item type, aggregating field references with arrows. */
export function buildEdgesForItemType(
  itemType: SchemaTypes.ItemType,
  fields: SchemaTypes.Field[],
  rootItemTypeIds: Set<string>,
  installedPluginIds: Set<string>,
) {
  const edges: AppEdge[] = [];
  const linkedItemTypeIds = new Set<string>();
  const linkedPluginIds = new Set<string>();

  for (const field of fields) {
    for (const linkedItemTypeId of findLinkedItemTypeIds(field)) {
      if (rootItemTypeIds.has(linkedItemTypeId)) continue;

      const id = `toItemType--${itemType.id}->${linkedItemTypeId}`;
      linkedItemTypeIds.add(linkedItemTypeId);
      const existing = find(edges, { id });
      if (existing) {
        const data = existing.data ?? { fields: [] };
        data.fields.push(field);
        existing.data = data;
      } else {
        edges.push({
          id,
          source: `itemType--${itemType.id}`,
          target: `itemType--${linkedItemTypeId}`,
          type: 'field',
          data: { fields: [field] },
          markerEnd: { type: MarkerType.ArrowClosed },
        });
      }
    }

    for (const linkedPluginId of findLinkedPluginIds(
      field,
      installedPluginIds,
    )) {
      const id = `toPlugin--${itemType.id}->${linkedPluginId}`;
      const existing = find(edges, { id });
      linkedPluginIds.add(linkedPluginId);
      if (existing) {
        const data = existing.data ?? { fields: [] };
        data.fields.push(field);
        existing.data = data;
      } else {
        edges.push({
          id,
          source: `itemType--${itemType.id}`,
          target: `plugin--${linkedPluginId}`,
          type: 'field',
          data: { fields: [field] },
          markerEnd: { type: MarkerType.ArrowClosed },
        });
      }
    }
  }

  return [edges, linkedItemTypeIds, linkedPluginIds] as const;
}
