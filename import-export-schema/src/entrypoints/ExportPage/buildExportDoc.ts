// biome-ignore-all lint/performance/noAwaitInLoops: Bounded work and incremental serialization intentionally await between batches.
import type { SchemaTypes } from '@datocms/cma-client';
import cloneDeep from 'lodash-es/cloneDeep';
import get from 'lodash-es/get';
import set from 'lodash-es/set';
import { ensureExportableAppearance } from '@/utils/datocms/appearance';
import {
  validatorsContainingBlocks,
  validatorsContainingLinks,
} from '@/utils/datocms/schema';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { ExportDocV2 } from '@/utils/types';

type BuildExportDocOptions = {
  onProgress?: (update: ExportProgressUpdate) => void;
  shouldCancel?: () => boolean;
};

export type ExportProgressUpdate = {
  done: number;
  total: number;
  label: string;
};

type ProgressReporter = {
  report: (label: string) => void;
  stop: () => void;
};

export function calculateExportProgressTotal(
  itemTypeCount: number,
  pluginCount: number,
): number {
  return itemTypeCount + pluginCount;
}

/**
 * Process a bounded number of models at once while retaining their requested order.
 * This avoids filling the lower-level request queue with every model's first request
 * before any one model can finish and produce a meaningful progress update.
 */
async function processWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  mapper: (input: Input, index: number) => Promise<Output>,
  consumeBatch: (outputs: Output[]) => Promise<void>,
): Promise<void> {
  const workerCount = Math.min(
    inputs.length,
    Math.max(1, Math.floor(concurrency)),
  );
  if (workerCount === 0) return;

  for (let offset = 0; offset < inputs.length; offset += workerCount) {
    // Drain started work before propagating failure/cancellation. Otherwise it
    // can report progress or queue more reads after the UI starts a new task.
    const settled = await Promise.allSettled(
      inputs
        .slice(offset, offset + workerCount)
        .map((input, index) => mapper(input, offset + index)),
    );
    const outputs: Output[] = [];
    for (const result of settled) {
      if (result.status === 'rejected') throw result.reason;
      outputs.push(result.value);
    }
    await consumeBatch(outputs);
  }
}

/** Keep concurrent export work on one monotonic progress counter. */
function createProgressReporter(
  total: number,
  onProgress: BuildExportDocOptions['onProgress'],
): ProgressReporter {
  let done = 0;
  let active = true;

  return {
    report(label) {
      if (!active) return;
      done += 1;
      onProgress?.({ done, total, label });
    },
    stop() {
      active = false;
    },
  };
}

/**
 * Strip validator references pointing to item types outside the export selection.
 */
function trimValidators(
  exportableField: SchemaTypes.Field,
  field: SchemaTypes.Field,
  itemTypeIdsToExport: Set<string>,
) {
  const validators = [
    ...validatorsContainingLinks.filter(
      (i) => i.field_type === field.attributes.field_type,
    ),
    ...validatorsContainingBlocks.filter(
      (i) => i.field_type === field.attributes.field_type,
    ),
  ].map((i) => i.validator);

  for (const validator of validators) {
    const fieldLinkedItemTypeIds = get(
      field.attributes.validators,
      validator,
    ) as unknown;
    if (!Array.isArray(fieldLinkedItemTypeIds)) continue;

    // Drop links to models outside the export selection so the document stays valid.
    set(
      exportableField.attributes.validators,
      validator,
      [...new Set(fieldLinkedItemTypeIds)].filter(
        (id) => typeof id === 'string' && itemTypeIdsToExport.has(id),
      ),
    );
  }
}

type ExportableItemTypeData = {
  itemType: SchemaTypes.ItemType;
  fieldsets: SchemaTypes.Fieldset[];
  exportableFields: SchemaTypes.Field[];
};

/**
 * Build the exportable data for a single item type, trimming validators and appearances.
 */
async function buildExportableItemTypeData(
  schema: ProjectSchema,
  itemTypeToExport: SchemaTypes.ItemType,
  itemTypeIdsToExport: Set<string>,
  pluginIdsToExport: string[],
  shouldCancel: (() => boolean) | undefined,
): Promise<ExportableItemTypeData> {
  const [fields, fieldsets] = await schema.getItemTypeFieldsAndFieldsets(
    itemTypeToExport,
    { shouldCancel },
  );
  if (shouldCancel?.()) throw new Error('Export cancelled');

  const exportableFields: SchemaTypes.Field[] = [];
  let lastYieldAt = Date.now();
  for (const field of fields) {
    if (shouldCancel?.()) throw new Error('Export cancelled');
    const exportableField = cloneDeep(field);
    trimValidators(exportableField, field, itemTypeIdsToExport);
    // Keep field transformations bounded too, including large localized defaults.
    exportableField.attributes.appearance = await ensureExportableAppearance(
      field,
      pluginIdsToExport,
    );
    exportableFields.push(exportableField);
    if (Date.now() - lastYieldAt >= 16) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYieldAt = Date.now();
    }
  }

  return { itemType: itemTypeToExport, fieldsets, exportableFields };
}

/**
 * Resolve plugins without allocating a promise for every installed plugin.
 */
async function fetchExportPlugins(
  schema: ProjectSchema,
  pluginIdsToExport: string[],
  reportProgress: (label: string) => void,
  shouldCancel: (() => boolean) | undefined,
  appendEntities: (entities: ExportDocV2['entities']) => Promise<void>,
) {
  for (const id of pluginIdsToExport) {
    if (shouldCancel?.()) throw new Error('Export cancelled');
    const plugin = await schema.getPluginById(id);
    if (shouldCancel?.()) throw new Error('Export cancelled');
    await appendEntities([plugin]);
    reportProgress(`Plugin: ${plugin.attributes.name}`);
  }
}

/**
 * Assemble an export document tailored to the selected item types and plugins, trimming
 * validators and appearances so the payload is self-contained.
 */
async function buildExportEntities(
  schema: ProjectSchema,
  initialItemTypeId: string,
  itemTypeIdsToExport: string[],
  pluginIdsToExport: string[],
  options: BuildExportDocOptions,
  appendEntities: (entities: ExportDocV2['entities']) => Promise<void>,
): Promise<void> {
  const { onProgress, shouldCancel } = options;
  const itemTypeIds = [...new Set(itemTypeIdsToExport)];
  const itemTypeIdSet = new Set(itemTypeIds);
  const pluginIds = [...new Set(pluginIdsToExport)];
  if (!itemTypeIdSet.has(initialItemTypeId)) {
    throw new Error('The root model must be included in the export selection.');
  }
  const progress = createProgressReporter(
    calculateExportProgressTotal(itemTypeIds.length, pluginIds.length),
    onProgress,
  );
  let stopped = false;
  let firstFailure: { error: unknown } | undefined;
  const shouldStop = () => stopped || !!shouldCancel?.();

  try {
    await fetchExportPlugins(
      schema,
      pluginIds,
      progress.report,
      shouldStop,
      appendEntities,
    );

    if (shouldCancel?.()) throw new Error('Export cancelled');

    // A model counts as complete only after its fields, fieldsets, and appearances are ready.
    await processWithConcurrency(
      itemTypeIds,
      schema.maxConcurrentRequests,
      async (id) => {
        try {
          if (shouldStop()) throw new Error('Export cancelled');
          const itemTypeToExport = await schema.getItemTypeById(id);
          if (shouldStop()) throw new Error('Export cancelled');

          const exportableData = await buildExportableItemTypeData(
            schema,
            itemTypeToExport,
            itemTypeIdSet,
            pluginIds,
            shouldStop,
          );
          if (shouldStop()) throw new Error('Export cancelled');
          progress.report(`Model/Block: ${itemTypeToExport.attributes.name}`);
          return exportableData;
        } catch (error) {
          firstFailure ??= { error };
          stopped = true;
          progress.stop();
          throw error;
        }
      },
      async (batch) => {
        for (const { itemType, fieldsets, exportableFields } of batch) {
          if (shouldStop()) throw new Error('Export cancelled');
          await appendEntities([itemType, ...fieldsets, ...exportableFields]);
        }
      },
    );
  } catch (error) {
    // Other promises may still settle after one concurrent request fails.
    // Ignore late updates once error or cancellation handling has started.
    progress.stop();
    throw firstFailure ? firstFailure.error : error;
  }
}

/** Build the original in-memory document for callers that need to inspect it. */
export default async function buildExportDoc(
  schema: ProjectSchema,
  initialItemTypeId: string,
  itemTypeIdsToExport: string[],
  pluginIdsToExport: string[],
  options: BuildExportDocOptions = {},
): Promise<ExportDocV2> {
  const doc: ExportDocV2 = {
    version: '2',
    rootItemTypeId: initialItemTypeId,
    entities: [],
  };
  await buildExportEntities(
    schema,
    initialItemTypeId,
    itemTypeIdsToExport,
    pluginIdsToExport,
    options,
    async (entities) => {
      for (const entity of entities) doc.entities.push(entity);
    },
  );
  return doc;
}

/**
 * Serialize the download incrementally. Retain binary chunks rather than all
 * transformed models plus one enormous JSON string at the end of the export.
 */
export async function buildExportBlob(
  schema: ProjectSchema,
  initialItemTypeId: string,
  itemTypeIdsToExport: string[],
  pluginIdsToExport: string[],
  options: BuildExportDocOptions = {},
): Promise<Blob> {
  const parts: Blob[] = [];
  let chunk = `{\n  "version": "2",\n  "rootItemTypeId": ${JSON.stringify(initialItemTypeId)},\n  "entities": [`;
  let firstEntity = true;
  let lastYieldAt = Date.now();
  const flushChunk = () => {
    parts.push(new Blob([chunk], { type: 'application/json' }));
    chunk = '';
  };

  await buildExportEntities(
    schema,
    initialItemTypeId,
    itemTypeIdsToExport,
    pluginIdsToExport,
    options,
    async (entities) => {
      for (const entity of entities) {
        if (options.shouldCancel?.()) throw new Error('Export cancelled');
        chunk += `${firstEntity ? '\n' : ',\n'}${JSON.stringify(entity, null, 2).replace(/^/gm, '    ')}`;
        firstEntity = false;
        if (chunk.length >= 256 * 1024) flushChunk();
        if (Date.now() - lastYieldAt >= 16) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          lastYieldAt = Date.now();
        }
      }
    },
  );
  if (options.shouldCancel?.()) throw new Error('Export cancelled');
  chunk += '\n  ]\n}';
  flushChunk();
  return new Blob(parts, { type: 'application/json' });
}
