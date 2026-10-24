import type { SchemaTypes } from '@datocms/cma-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isDefined } from '@/utils/isDefined';
import type { ProjectSchema } from '@/utils/ProjectSchema';

type UseExportSelectionOptions = {
  schema: ProjectSchema;
  enabled?: boolean;
};

type UseExportSelectionResult = {
  allItemTypes?: SchemaTypes.ItemType[];
  /** The item types could not be loaded */
  error?: Error;
  /** Loads the item types again, after an error */
  retry: () => void;
  selectedIds: string[];
  selectedItemTypes: SchemaTypes.ItemType[];
  setSelectedIds: (ids: string[]) => void;
};

/**
 * Fetches item types and keeps a derived selection list in sync with the schema client.
 */
export function useExportSelection({
  schema,
  enabled = true,
}: UseExportSelectionOptions): UseExportSelectionResult {
  const [allItemTypes, setAllItemTypes] = useState<SchemaTypes.ItemType[]>();
  const [error, setError] = useState<Error>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedItemTypes, setSelectedItemTypes] = useState<
    SchemaTypes.ItemType[]
  >([]);

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      try {
        setError(undefined);
        const types = await schema.getAllItemTypes();
        if (!isCancelled()) {
          setAllItemTypes(types);
        }
      } catch (loadError) {
        if (!isCancelled()) {
          console.error('Could not load the item types', loadError);
          setError(
            loadError instanceof Error
              ? loadError
              : new Error(String(loadError)),
          );
        }
      }
    },
    [schema],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    void load(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [enabled, load]);

  // ProjectSchema forgets a failed request: the next load asks the API again.
  const retry = useCallback(() => {
    void load(() => false);
  }, [load]);

  const itemTypesById = useMemo(() => {
    if (!allItemTypes) {
      return undefined;
    }
    return new Map(allItemTypes.map((it) => [it.id, it]));
  }, [allItemTypes]);

  useEffect(() => {
    if (!enabled) {
      setSelectedItemTypes([]);
      return;
    }
    if (!itemTypesById) {
      return;
    }

    setSelectedItemTypes(
      selectedIds.map((id) => itemTypesById.get(id)).filter(isDefined),
    );
  }, [enabled, itemTypesById, selectedIds]);

  return {
    allItemTypes,
    error,
    retry,
    selectedIds,
    selectedItemTypes,
    setSelectedIds,
  };
}
