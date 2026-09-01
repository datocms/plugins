import type { SchemaTypes } from '@datocms/cma-client';
import cloneDeep from 'lodash-es/cloneDeep';
import get from 'lodash-es/get';
import intersection from 'lodash-es/intersection';
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
async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  mapper: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (inputs.length === 0) return [];

  const results = new Array<Output>(inputs.length);
  const workerCount = Math.min(
    inputs.length,
    Math.max(1, Math.floor(concurrency)),
  );
  let nextIndex = 0;
  let stopped = false;

  const runWorker = async (): Promise<void> => {
    if (stopped) return;

    const index = nextIndex;
    if (index >= inputs.length) return;
    nextIndex += 1;

    try {
      results[index] = await mapper(inputs[index], index);
    } catch (error) {
      stopped = true;
      throw error;
    }

    return runWorker();
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
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
  itemTypeIdsToExport: string[],
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
    ) as string[];

    // Drop links to models outside the export selection so the document stays valid.
    set(
      exportableField.attributes.validators,
      validator,
      intersection(fieldLinkedItemTypeIds, itemTypeIdsToExport),
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
  itemTypeIdsToExport: string[],
  pluginIdsToExport: string[],
  shouldCancel: (() => boolean) | undefined,
): Promise<ExportableItemTypeData> {
  const [fields, fieldsets] =
    await schema.getItemTypeFieldsAndFieldsets(itemTypeToExport);
  if (shouldCancel?.()) throw new Error('Export cancelled');

  const exportableFields = await Promise.all(
    fields.map(async (field) => {
      if (shouldCancel?.()) throw new Error('Export cancelled');
      const exportableField = cloneDeep(field);
      trimValidators(exportableField, field, itemTypeIdsToExport);
      // Remove appearance references to non-exported plugins/media.
      exportableField.attributes.appearance = await ensureExportableAppearance(
        field,
        pluginIdsToExport,
      );
      return exportableField;
    }),
  );

  return { itemType: itemTypeToExport, fieldsets, exportableFields };
}

/**
 * Fetch all plugins for the export in parallel.
 */
async function fetchExportPlugins(
  schema: ProjectSchema,
  pluginIdsToExport: string[],
  reportProgress: (label: string) => void,
  shouldCancel: (() => boolean) | undefined,
) {
  return Promise.all(
    pluginIdsToExport.map(async (id) => {
      if (shouldCancel?.()) throw new Error('Export cancelled');
      const plugin = await schema.getPluginById(id);
      if (shouldCancel?.()) throw new Error('Export cancelled');
      reportProgress(`Plugin: ${plugin.attributes.name}`);
      return plugin;
    }),
  );
}

/**
 * Assemble an export document tailored to the selected item types and plugins, trimming
 * validators and appearances so the payload is self-contained.
 */
export default async function buildExportDoc(
  schema: ProjectSchema,
  initialItemTypeId: string,
  itemTypeIdsToExport: string[],
  pluginIdsToExport: string[],
  options: BuildExportDocOptions = {},
): Promise<ExportDocV2> {
  const { onProgress, shouldCancel } = options;
  const progress = createProgressReporter(
    calculateExportProgressTotal(
      itemTypeIdsToExport.length,
      pluginIdsToExport.length,
    ),
    onProgress,
  );
  const doc: ExportDocV2 = {
    version: '2',
    rootItemTypeId: initialItemTypeId,
    entities: [],
  };

  try {
    const plugins = await fetchExportPlugins(
      schema,
      pluginIdsToExport,
      progress.report,
      shouldCancel,
    );
    for (const plugin of plugins) {
      doc.entities.push(plugin);
    }

    if (shouldCancel?.()) throw new Error('Export cancelled');

    // A model counts as complete only after its fields, fieldsets, and appearances are ready.
    const allItemTypeData = await mapWithConcurrency(
      itemTypeIdsToExport,
      schema.maxConcurrentRequests,
      async (id) => {
        if (shouldCancel?.()) throw new Error('Export cancelled');
        const itemTypeToExport = await schema.getItemTypeById(id);
        if (shouldCancel?.()) throw new Error('Export cancelled');

        const exportableData = await buildExportableItemTypeData(
          schema,
          itemTypeToExport,
          itemTypeIdsToExport,
          pluginIdsToExport,
          shouldCancel,
        );
        if (shouldCancel?.()) throw new Error('Export cancelled');
        progress.report(`Model/Block: ${itemTypeToExport.attributes.name}`);
        return exportableData;
      },
    );

    for (const { itemType, fieldsets, exportableFields } of allItemTypeData) {
      doc.entities.push(itemType);
      for (const fieldset of fieldsets) {
        doc.entities.push(fieldset);
      }
      for (const exportableField of exportableFields) {
        doc.entities.push(exportableField);
      }
    }

    return doc;
  } catch (error) {
    // Other promises may still settle after one concurrent request fails.
    // Ignore late updates once error or cancellation handling has started.
    progress.stop();
    throw error;
  }
}
