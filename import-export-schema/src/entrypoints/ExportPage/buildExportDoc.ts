import {
  defaultAppearanceForFieldType,
  isHardcodedEditor,
} from '@/utils/datocms/fieldTypeInfo';
import {
  validatorsContainingBlocks,
  validatorsContainingLinks,
} from '@/utils/datocms/schema';
import type { ItemTypeManager } from '@/utils/itemTypeManager';
import type { ExportDoc } from '@/utils/types';
import { cloneDeep, get, intersection, set } from 'lodash-es';

export default async function buildExportDoc(
  schema: ItemTypeManager,
  itemTypeIdsToExport: string[],
  pluginIdsToExport: string[],
): Promise<ExportDoc> {
  const doc: ExportDoc = {
    version: '1',
    entities: [],
  };

  for (const pluginId of pluginIdsToExport) {
    const plugin = await schema.getPluginById(pluginId);

    doc.entities.push(plugin);
  }

  for (const itemTypeIdToExport of itemTypeIdsToExport) {
    const itemTypeToExport = await schema.getItemTypeById(itemTypeIdToExport);

    const [fields, fieldsets] =
      await schema.getItemTypeFieldsAndFieldsets(itemTypeToExport);

    doc.entities.push(itemTypeToExport);

    for (const fieldset of fieldsets) {
      doc.entities.push(fieldset);
    }

    for (const field of fields) {
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

        set(
          exportableField.attributes.validators,
          validator,
          intersection(fieldLinkedItemTypeIds, itemTypeIdsToExport),
        );
      }

      field.attributes.appeareance = undefined;

      if (
        !(await isHardcodedEditor(field.attributes.appearance.editor)) &&
        !pluginIdsToExport.includes(field.attributes.appearance.editor)
      ) {
        exportableField.attributes.appearance =
          await defaultAppearanceForFieldType(field.attributes.field_type);
      }

      exportableField.attributes.appearance.addons =
        field.attributes.appearance.addons.filter((addon) =>
          pluginIdsToExport.includes(addon.id),
        );

      doc.entities.push(exportableField);
    }
  }

  return doc;
}
