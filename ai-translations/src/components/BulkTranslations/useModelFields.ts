import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultFieldSelection,
  filterTranslatableFields,
  type SdkField,
  sortFieldsByLayoutOrder,
  type TranslatableField,
} from '../../utils/translation/BulkTranslationHelpers';

/** Includes requests from a previous selection until their SDK promise settles. */
export const MODEL_FIELD_CONCURRENCY = 4;

type FilterOptions = Parameters<typeof filterTranslatableFields>[1];
type Work = { modelId: string; schemaKey: string; filters: FilterOptions };
type Snapshot = {
  schemaKey: string;
  fieldsByModel: Record<string, TranslatableField[]>;
  selectedFieldsByModel: Record<string, string[]>;
  loadingFieldsForModel: Set<string>;
  failedFieldModels: Set<string>;
};

type Runtime = {
  mounted: boolean;
  schemaKey: string;
  filters: FilterOptions;
  modelIds: Set<string>;
  fields: Map<string, TranslatableField[]>;
  selections: Map<string, string[]>;
  failed: Set<string>;
  pending: Map<string, Work>;
  queue: Work[];
  head: number;
  active: number;
  publishQueued: boolean;
};

function resetSchema(runtime: Runtime, schemaKey: string) {
  if (runtime.schemaKey === schemaKey) return;
  runtime.schemaKey = schemaKey;
  const [, fields, exclusions] = JSON.parse(schemaKey) as [
    string,
    string[],
    string[],
  ];
  runtime.filters = {
    translationFields: fields,
    apiKeysToBeExcludedFromThisPlugin: exclusions,
  };
  runtime.fields.clear();
  runtime.selections.clear();
  runtime.failed.clear();
  runtime.pending.clear();
  runtime.queue = [];
  runtime.head = 0;
}

function pruneModels(runtime: Runtime, ids: string[]) {
  runtime.modelIds = new Set(ids);
  for (const collection of [
    runtime.fields,
    runtime.selections,
    runtime.failed,
    runtime.pending,
  ]) {
    for (const id of collection.keys()) {
      if (!runtime.modelIds.has(id)) collection.delete(id);
    }
  }
  // Drop deselected queued work immediately, even if active SDK calls hang.
  runtime.queue = runtime.queue
    .slice(runtime.head)
    .filter((work) => runtime.pending.get(work.modelId) === work);
  runtime.head = 0;
}

function enqueue(runtime: Runtime, modelId: string) {
  if (
    runtime.fields.has(modelId) ||
    runtime.failed.has(modelId) ||
    runtime.pending.has(modelId)
  )
    return;
  const work: Work = {
    modelId,
    schemaKey: runtime.schemaKey,
    filters: runtime.filters,
  };
  runtime.pending.set(modelId, work);
  runtime.queue.push(work);
}

function emptySnapshot(schemaKey: string): Snapshot {
  return {
    schemaKey,
    fieldsByModel: {},
    selectedFieldsByModel: {},
    loadingFieldsForModel: new Set(),
    failedFieldModels: new Set(),
  };
}

/**
 * Schema loading shared by the page and record picker. Mutable refs reserve a
 * model before starting its request; React state only publishes UI snapshots.
 * SDK field loads cannot be aborted, so removed/superseded work is ignored and
 * still occupies its concurrency slot until it settles.
 */
export function useModelFields({
  modelIds,
  scopeKey,
  loadFields,
  translationFields,
  excludedApiKeys,
}: {
  modelIds: readonly string[];
  scopeKey: string;
  loadFields: (modelId: string) => Promise<unknown>;
  translationFields: string[] | undefined;
  excludedApiKeys: string[] | undefined;
}) {
  const selectionKey = JSON.stringify(modelIds);
  const schemaKey = JSON.stringify([
    scopeKey,
    translationFields ?? [],
    excludedApiKeys ?? [],
  ]);
  const [snapshot, setSnapshot] = useState(() => emptySnapshot(schemaKey));
  const loaderRef = useRef(loadFields);
  loaderRef.current = loadFields;
  const runtimeRef = useRef<Runtime>({
    mounted: false,
    schemaKey,
    filters: {
      translationFields: translationFields ?? [],
      apiKeysToBeExcludedFromThisPlugin: excludedApiKeys ?? [],
    },
    modelIds: new Set<string>(),
    fields: new Map<string, TranslatableField[]>(),
    selections: new Map<string, string[]>(),
    failed: new Set<string>(),
    pending: new Map<string, Work>(),
    queue: [],
    head: 0,
    active: 0,
    publishQueued: false,
  });
  const pumpRef = useRef<() => void>(() => {});

  const publishNow = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime.mounted) return;
    setSnapshot({
      schemaKey: runtime.schemaKey,
      fieldsByModel: Object.fromEntries(runtime.fields),
      selectedFieldsByModel: Object.fromEntries(runtime.selections),
      loadingFieldsForModel: new Set(runtime.pending.keys()),
      failedFieldModels: new Set(runtime.failed),
    });
  }, []);

  const publish = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime.publishQueued) return;
    runtime.publishQueued = true;
    queueMicrotask(() => {
      runtime.publishQueued = false;
      publishNow();
    });
  }, [publishNow]);

  const isCurrent = useCallback((work: Work) => {
    const runtime = runtimeRef.current;
    return (
      runtime.mounted &&
      runtime.schemaKey === work.schemaKey &&
      runtime.modelIds.has(work.modelId) &&
      runtime.pending.get(work.modelId) === work
    );
  }, []);

  const loadOne = useCallback(
    async (work: Work) => {
      const runtime = runtimeRef.current;
      try {
        const fields = (await loaderRef.current(work.modelId)) as SdkField[];
        if (!isCurrent(work)) return;
        const translatable = filterTranslatableFields(
          sortFieldsByLayoutOrder(fields),
          work.filters,
        );
        runtime.fields.set(work.modelId, translatable);
        if (!runtime.selections.has(work.modelId)) {
          runtime.selections.set(
            work.modelId,
            defaultFieldSelection(translatable),
          );
        }
      } catch (error) {
        if (isCurrent(work)) {
          console.error(
            `Error loading fields for model ${work.modelId}:`,
            error,
          );
          runtime.failed.add(work.modelId);
        }
      } finally {
        runtime.active -= 1;
        if (runtime.pending.get(work.modelId) === work)
          runtime.pending.delete(work.modelId);
        publish();
        pumpRef.current();
      }
    },
    [isCurrent, publish],
  );

  const pump = useCallback(() => {
    const runtime = runtimeRef.current;
    while (
      runtime.mounted &&
      runtime.active < MODEL_FIELD_CONCURRENCY &&
      runtime.head < runtime.queue.length
    ) {
      const work = runtime.queue[runtime.head++];
      if (!isCurrent(work)) continue;
      runtime.active += 1;
      void loadOne(work);
    }
    if (runtime.head === runtime.queue.length) {
      runtime.queue = [];
      runtime.head = 0;
    }
  }, [isCurrent, loadOne]);
  pumpRef.current = pump;

  useEffect(() => {
    const runtime = runtimeRef.current;
    runtime.mounted = true;
    return () => {
      runtime.mounted = false;
      // Keep reservations during React StrictMode's immediate effect replay.
      queueMicrotask(() => {
        if (runtime.mounted) return;
        runtime.pending.clear();
        runtime.queue = [];
        runtime.head = 0;
      });
    };
  }, []);

  // JSON keys compare the actual selection/filter values rather than host ctx
  // identities, which may change during every dashboard refresh.
  useEffect(() => {
    const runtime = runtimeRef.current;
    resetSchema(runtime, schemaKey);
    const ids = JSON.parse(selectionKey) as string[];
    pruneModels(runtime, ids);
    for (const id of runtime.modelIds) enqueue(runtime, id);
    publish();
    pump();
  }, [selectionKey, schemaKey, publish, pump]);

  const setModelFields = useCallback(
    (modelId: string, apiKeys: string[]) => {
      const runtime = runtimeRef.current;
      if (!runtime.modelIds.has(modelId)) return;
      runtime.selections.set(modelId, apiKeys);
      publishNow();
    },
    [publishNow],
  );

  const retryFields = useCallback(
    (modelId: string) => {
      const runtime = runtimeRef.current;
      if (!runtime.modelIds.has(modelId) || !runtime.failed.delete(modelId))
        return;
      enqueue(runtime, modelId);
      publish();
      pump();
    },
    [publish, pump],
  );

  return {
    ...(snapshot.schemaKey === schemaKey ? snapshot : emptySnapshot(schemaKey)),
    setModelFields,
    retryFields,
  };
}
