import type { SchemaTypes } from '@datocms/cma-client';
import { useCallback, useEffect, useState } from 'react';
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
  selectAllModels: () => void;
  selectAllBlocks: () => void;
};

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

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (selectedIds.length === 0) {
      setSelectedItemTypes([]);
      return;
    }

    let cancelled = false;
    async function resolve() {
      const list: SchemaTypes.ItemType[] = [];
      for (const id of selectedIds) {
        const itemType = await schema.getItemTypeById(id);
        if (cancelled) {
          return;
        }
        list.push(itemType);
      }
      if (!cancelled) {
        setSelectedItemTypes(list);
      }
    }

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [schema, enabled, selectedIds.join('-')]);

  const selectAllModels = useCallback(() => {
    if (!allItemTypes) {
      return;
    }

    setSelectedIds(
      allItemTypes
        .filter((it) => !it.attributes.modular_block)
        .map((it) => it.id),
    );
  }, [allItemTypes]);

  const selectAllBlocks = useCallback(() => {
    if (!allItemTypes) {
      return;
    }

    setSelectedIds(
      allItemTypes
        .filter((it) => it.attributes.modular_block)
        .map((it) => it.id),
    );
  }, [allItemTypes]);

  return {
    allItemTypes,
    selectedIds,
    selectedItemTypes,
    setSelectedIds,
    selectAllModels,
    selectAllBlocks,
  };
}
