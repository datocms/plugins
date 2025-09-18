import type { SchemaTypes } from '@datocms/cma-client';
import { useEffect, useMemo, useState } from 'react';
import { isDefined } from '@/utils/isDefined';
import type { ProjectSchema } from '@/utils/ProjectSchema';

type UseExportSelectionOptions = {
  schema: ProjectSchema;
  enabled?: boolean;
};

type UseExportSelectionResult = {
  allItemTypes?: SchemaTypes.ItemType[];
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedItemTypes, setSelectedItemTypes] = useState<
    SchemaTypes.ItemType[]
  >([]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    async function load() {
      const types = await schema.getAllItemTypes();
      if (!cancelled) {
        setAllItemTypes(types);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [schema, enabled]);

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
  }, [enabled, itemTypesById, selectedIds.join('-')]);

  return {
    allItemTypes,
    selectedIds,
    selectedItemTypes,
    setSelectedIds,
  };
}
