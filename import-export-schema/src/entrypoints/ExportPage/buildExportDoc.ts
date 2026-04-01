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
  onProgress?: (label: string) => void;
  shouldCancel?: () => boolean;
};

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
  onProgress: ((label: string) => void) | undefined,
  shouldCancel: (() => boolean) | undefined,
) {
  if (shouldCancel?.()) throw new Error('Export cancelled');
  const plugins = await Promise.all(
    pluginIdsToExport.map((id) => schema.getPluginById(id)),
  );
  for (const plugin of plugins) {
    onProgress?.(`Plugin: ${plugin.attributes.name}`);
  }
  return plugins;
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
  const doc: ExportDocV2 = {
    version: '2',
    rootItemTypeId: initialItemTypeId,
    entities: [],
  };

  const plugins = await fetchExportPlugins(
    schema,
    pluginIdsToExport,
    onProgress,
    shouldCancel,
  );
  for (const plugin of plugins) {
    doc.entities.push(plugin);
  }

  if (shouldCancel?.()) throw new Error('Export cancelled');

  const itemTypes = await Promise.all(
    itemTypeIdsToExport.map((id) => schema.getItemTypeById(id)),
  );

  if (shouldCancel?.()) throw new Error('Export cancelled');

  // Build all item type data in parallel (fields, fieldsets, appearance trimming).
  const allItemTypeData = await Promise.all(
    itemTypes.map((itemTypeToExport) =>
      buildExportableItemTypeData(
        schema,
        itemTypeToExport,
        itemTypeIdsToExport,
        pluginIdsToExport,
        shouldCancel,
      ),
    ),
  );

  for (const { itemType, fieldsets, exportableFields } of allItemTypeData) {
    onProgress?.(`Model/Block: ${itemType.attributes.name}`);
    onProgress?.(`Fields/Fieldsets for ${itemType.attributes.name}`);

    doc.entities.push(itemType);
    for (const fieldset of fieldsets) {
      doc.entities.push(fieldset);
    }
    for (const exportableField of exportableFields) {
      doc.entities.push(exportableField);
    }
  }

  return doc;
}
