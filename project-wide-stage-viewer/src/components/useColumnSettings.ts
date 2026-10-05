import { useCallback, useEffect, useState } from 'react';
import type { ColumnSetting } from '../types';
import {
  loadColumnSettings,
  normalizeColumnSettings,
  saveColumnSettings,
} from './columnSettings';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** localStorage, or null where reading it throws (blocked site data, previews). */
function storage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function load(storageKey: string): ColumnSetting[] {
  const store = storage();
  return store
    ? loadColumnSettings(store, storageKey)
    : normalizeColumnSettings(null);
}

export function useColumnSettings(
  storageKey: string,
): readonly [
  readonly ColumnSetting[],
  (columns: readonly ColumnSetting[]) => void,
] {
  const [columns, setColumns] = useState<ColumnSetting[]>(() =>
    load(storageKey),
  );

  useEffect(() => {
    setColumns(load(storageKey));
  }, [storageKey]);

  const update = useCallback(
    (next: readonly ColumnSetting[]) => {
      const normalized = normalizeColumnSettings(next);
      setColumns(normalized);
      const store = storage();
      if (store) saveColumnSettings(store, storageKey, normalized);
    },
    [storageKey],
  );

  return [columns, update] as const;
}
