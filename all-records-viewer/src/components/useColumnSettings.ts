import { useCallback, useEffect, useState } from 'react';
import type { ColumnSetting } from '../types';
import {
  loadColumnSettings,
  normalizeColumnSettings,
  saveColumnSettings,
} from './columnSettings';

export function useColumnSettings(
  storageKey: string,
): readonly [
  readonly ColumnSetting[],
  (columns: readonly ColumnSetting[]) => void,
] {
  const [columns, setColumns] = useState<ColumnSetting[]>(() =>
    typeof window === 'undefined'
      ? normalizeColumnSettings(null)
      : loadColumnSettings(window.localStorage, storageKey),
  );

  useEffect(() => {
    setColumns(
      typeof window === 'undefined'
        ? normalizeColumnSettings(null)
        : loadColumnSettings(window.localStorage, storageKey),
    );
  }, [storageKey]);

  const update = useCallback(
    (next: readonly ColumnSetting[]) => {
      const normalized = normalizeColumnSettings(next);
      setColumns(normalized);
      if (typeof window !== 'undefined') {
        saveColumnSettings(window.localStorage, storageKey, normalized);
      }
    },
    [storageKey],
  );

  return [columns, update] as const;
}
