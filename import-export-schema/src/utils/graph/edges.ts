import type { SchemaTypes } from '@datocms/cma-client';
import { MarkerType } from '@xyflow/react';
import find from 'lodash-es/find';
import {
  findLinkedItemTypeIds,
  findLinkedPluginIds,
} from '@/utils/datocms/schema';
import type { AppEdge } from '@/utils/graph/types';

function appendFieldToEdge(
  edges: AppEdge[],
  edgeId: string,
  sourceNodeId: string,
  targetNodeId: string,
  field: SchemaTypes.Field,
) {
  const existing = find(edges, { id: edgeId });
  if (existing) {
    const data = existing.data ?? { fields: [] };
    data.fields.push(field);
    existing.data = data;
  } else {
    edges.push({
      id: edgeId,
      source: sourceNodeId,
      target: targetNodeId,
      type: 'field',
      data: { fields: [field] },
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  }
}

function processItemTypeLinks(
  itemType: SchemaTypes.ItemType,
  field: SchemaTypes.Field,
  rootItemTypeIds: Set<string>,
  edges: AppEdge[],
  linkedItemTypeIds: Set<string>,
) {
  for (const linkedItemTypeId of findLinkedItemTypeIds(field)) {
    if (rootItemTypeIds.has(linkedItemTypeId)) continue;
    linkedItemTypeIds.add(linkedItemTypeId);
    const edgeId = `toItemType--${itemType.id}->${linkedItemTypeId}`;
    appendFieldToEdge(
      edges,
      edgeId,
      `itemType--${itemType.id}`,
      `itemType--${linkedItemTypeId}`,
      field,
    );
  }
}

function processPluginLinks(
  itemType: SchemaTypes.ItemType,
  field: SchemaTypes.Field,
  installedPluginIds: Set<string>,
  edges: AppEdge[],
  linkedPluginIds: Set<string>,
) {
  for (const linkedPluginId of findLinkedPluginIds(field, installedPluginIds)) {
    linkedPluginIds.add(linkedPluginId);
    const edgeId = `toPlugin--${itemType.id}->${linkedPluginId}`;
    appendFieldToEdge(
      edges,
      edgeId,
      `itemType--${itemType.id}`,
      `plugin--${linkedPluginId}`,
      field,
    );
  }
}

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
    processItemTypeLinks(
      itemType,
      field,
      rootItemTypeIds,
      edges,
      linkedItemTypeIds,
    );
    processPluginLinks(
      itemType,
      field,
      installedPluginIds,
      edges,
      linkedPluginIds,
    );
  }

  return [edges, linkedItemTypeIds, linkedPluginIds] as const;
}
