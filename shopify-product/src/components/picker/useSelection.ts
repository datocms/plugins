import { useCallback, useMemo, useState } from 'react';
import {
  dedupeSelection,
  hydrateEntries,
  isNodeSelected,
  removeEntry,
  selectNode,
  toggleNode,
} from '../../lib/pickerSearch';
import type {
  FieldParametersV1,
  PickerSelectedEntry,
  ShopifyNode,
} from '../../types';

export type Selection = {
  entries: PickerSelectedEntry[];
  multiple: boolean;
  /** `Infinity` without a limit (and 1 for single fields). */
  max: number;
  atMax: boolean;
  isSelected: (node: ShopifyNode) => boolean;
  /** Adds or removes; adding at the max does nothing. */
  toggle: (node: ShopifyNode) => void;
  /** Adds, or fills the node of the entry that already stands for it. */
  select: (node: ShopifyNode) => void;
  remove: (key: string) => void;
  clear: () => void;
  /** Gives unresolved entries the matching loaded nodes. */
  hydrate: (nodes: readonly ShopifyNode[]) => void;
};

function maxFor(fieldParameters: FieldParametersV1): number {
  if (fieldParameters.cardinality === 'single') return 1;
  return typeof fieldParameters.max === 'number' && fieldParameters.max > 0
    ? fieldParameters.max
    : Number.POSITIVE_INFINITY;
}

/** The staged selection: starts from the field's value, keeps its order. */
export function useSelection(
  fieldParameters: FieldParametersV1,
  initial: readonly PickerSelectedEntry[],
): Selection {
  const [entries, setEntries] = useState<PickerSelectedEntry[]>(() =>
    dedupeSelection(initial),
  );
  const multiple = fieldParameters.cardinality === 'multiple';
  const max = maxFor(fieldParameters);

  const toggle = useCallback(
    (node: ShopifyNode) =>
      setEntries((current) => toggleNode(current, node, max)),
    [max],
  );
  const select = useCallback(
    (node: ShopifyNode) =>
      setEntries((current) => selectNode(current, node, max)),
    [max],
  );
  const remove = useCallback(
    (key: string) => setEntries((current) => removeEntry(current, key)),
    [],
  );
  const clear = useCallback(() => setEntries([]), []);
  const hydrate = useCallback(
    (nodes: readonly ShopifyNode[]) =>
      setEntries((current) => hydrateEntries(current, nodes)),
    [],
  );
  const isSelected = useCallback(
    (node: ShopifyNode) => isNodeSelected(entries, node),
    [entries],
  );

  return useMemo(
    () => ({
      entries,
      multiple,
      max,
      atMax: multiple && entries.length >= max,
      isSelected,
      toggle,
      select,
      remove,
      clear,
      hydrate,
    }),
    [
      entries,
      multiple,
      max,
      isSelected,
      toggle,
      select,
      remove,
      clear,
      hydrate,
    ],
  );
}
