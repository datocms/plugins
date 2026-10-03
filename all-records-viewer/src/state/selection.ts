import type { RawItem } from '../types';

/** Selection only needs identities and metadata, never localized field payloads. */
export function compactSelectedItem(item: RawItem): RawItem {
  return {
    id: item.id,
    type: item.type,
    attributes: {},
    meta: { ...item.meta },
    relationships: {
      item_type: { data: { ...item.relationships.item_type.data } },
      ...(item.relationships.creator
        ? { creator: { data: { ...item.relationships.creator.data } } }
        : {}),
    },
  };
}

export function setPageSelection(
  current: ReadonlyMap<string, RawItem>,
  pageItems: readonly RawItem[],
  selected: boolean,
): ReadonlyMap<string, RawItem> {
  const next = new Map(current);

  for (const item of pageItems) {
    if (selected) {
      next.set(item.id, compactSelectedItem(item));
    } else {
      next.delete(item.id);
    }
  }

  return next;
}

export function invertPageSelection(
  current: ReadonlyMap<string, RawItem>,
  pageItems: readonly RawItem[],
): ReadonlyMap<string, RawItem> {
  const next = new Map(current);

  for (const item of pageItems) {
    if (next.has(item.id)) {
      next.delete(item.id);
    } else {
      next.set(item.id, compactSelectedItem(item));
    }
  }

  return next;
}

export function retainSelectionForModels(
  current: ReadonlyMap<string, RawItem>,
  modelIds: ReadonlySet<string>,
): ReadonlyMap<string, RawItem> {
  let needsPruning = false;
  for (const item of current.values()) {
    if (!modelIds.has(item.relationships.item_type.data.id)) {
      needsPruning = true;
      break;
    }
  }
  if (!needsPruning) return current;

  const retained = new Map<string, RawItem>();
  for (const [id, item] of current) {
    if (modelIds.has(item.relationships.item_type.data.id)) {
      retained.set(id, item);
    }
  }
  return retained;
}
