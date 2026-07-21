import type { RawItem } from '../types';

export function setPageSelection(
  current: ReadonlyMap<string, RawItem>,
  pageItems: readonly RawItem[],
  selected: boolean,
): ReadonlyMap<string, RawItem> {
  const next = new Map(current);

  for (const item of pageItems) {
    if (selected) {
      next.set(item.id, item);
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
      next.set(item.id, item);
    }
  }

  return next;
}

export function retainSelectionForModels(
  current: ReadonlyMap<string, RawItem>,
  modelIds: ReadonlySet<string>,
): ReadonlyMap<string, RawItem> {
  const retained = [...current].filter(([, item]) =>
    modelIds.has(item.relationships.item_type.data.id),
  );

  return retained.length === current.size ? current : new Map(retained);
}
