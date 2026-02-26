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

  for (const pluginId of pluginIdsToExport) {
    if (shouldCancel?.()) throw new Error('Export cancelled');
    const plugin = await schema.getPluginById(pluginId);

    doc.entities.push(plugin);
    onProgress?.(`Plugin: ${plugin.attributes.name}`);
  }

  for (const itemTypeIdToExport of itemTypeIdsToExport) {
    if (shouldCancel?.()) throw new Error('Export cancelled');
    const itemTypeToExport = await schema.getItemTypeById(itemTypeIdToExport);
    onProgress?.(`Model/Block: ${itemTypeToExport.attributes.name}`);

    const [fields, fieldsets] =
      await schema.getItemTypeFieldsAndFieldsets(itemTypeToExport);
    if (shouldCancel?.()) throw new Error('Export cancelled');
    onProgress?.(`Fields/Fieldsets for ${itemTypeToExport.attributes.name}`);

    doc.entities.push(itemTypeToExport);

    for (const fieldset of fieldsets) {
      if (shouldCancel?.()) throw new Error('Export cancelled');
      doc.entities.push(fieldset);
    }

    for (const field of fields) {
      if (shouldCancel?.()) throw new Error('Export cancelled');
      const exportableField = cloneDeep(field);

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

      // Remove appearance references to non-exported plugins/media.
      exportableField.attributes.appearance = await ensureExportableAppearance(
        field,
        pluginIdsToExport,
      );

      doc.entities.push(exportableField);
    }
  }

  return doc;
}
