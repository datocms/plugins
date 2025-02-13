import { isDefined } from '@/utils/isDefined';
import type { ItemTypeManager } from '@/utils/itemTypeManager';
import {
  findLinkedItemTypeIds,
  firstHardcodedEditorFor,
  isHardcodedEditor,
  validatorsContainingBlocks,
  validatorsContainingLinks,
} from '@/utils/types';
import type { SchemaTypes } from '@datocms/cma-client';
import { cloneDeep, get, intersection, set } from 'lodash-es';

export type ExportDoc = {
  version: '1';
  entities: Array<
    | SchemaTypes.ItemType
    | SchemaTypes.Field
    | SchemaTypes.Fieldset
    | SchemaTypes.Plugin
  >;
};

export class ExportSchema {
  public rootItemType: SchemaTypes.ItemType;
  public itemTypesById: Map<string, SchemaTypes.ItemType>;
  public pluginsById: Map<string, SchemaTypes.Plugin>;
  public fieldsById: Map<string, SchemaTypes.Field>;
  public fieldsetsById: Map<string, SchemaTypes.Fieldset>;

  constructor(exportDoc: ExportDoc) {
    this.itemTypesById = new Map();
    for (const itemType of exportDoc.entities.filter(
      (e): e is SchemaTypes.ItemType => e.type === 'item_type',
    )) {
      this.itemTypesById.set(itemType.id, itemType);
    }

    this.pluginsById = new Map();
    for (const plugin of exportDoc.entities.filter(
      (e): e is SchemaTypes.Plugin => e.type === 'plugin',
    )) {
      this.pluginsById.set(plugin.id, plugin);
    }

    this.fieldsById = new Map();
    for (const field of exportDoc.entities.filter(
      (e): e is SchemaTypes.Field => e.type === 'field',
    )) {
      this.fieldsById.set(field.id, field);
    }

    this.fieldsetsById = new Map();
    for (const fieldset of exportDoc.entities.filter(
      (e): e is SchemaTypes.Fieldset => e.type === 'fieldset',
    )) {
      this.fieldsetsById.set(fieldset.id, fieldset);
    }

    const targetItemTypeIds = new Set<string>();

    for (const field of this.fields) {
      const itemTypeId = field.relationships.item_type.data.id;
      for (const linkedItemTypeId of findLinkedItemTypeIds(field)) {
        if (linkedItemTypeId !== itemTypeId) {
          targetItemTypeIds.add(linkedItemTypeId);
        }
      }
    }

    const rootItemTypes = this.itemTypes.filter(
      (itemType) => !targetItemTypeIds.has(itemType.id),
    );

    if (rootItemTypes.length !== 1) {
      throw new Error('Multiple root item types!');
    }

    this.rootItemType = rootItemTypes[0];
  }

  get fields() {
    return Array.from(this.fieldsById.values());
  }

  get fieldsets() {
    return Array.from(this.fieldsetsById.values());
  }

  get itemTypes() {
    return Array.from(this.itemTypesById.values());
  }

  get plugins() {
    return Array.from(this.pluginsById.values());
  }

  getItemTypeById(itemTypeId: string) {
    const itemType = this.itemTypesById.get(itemTypeId);

    if (!itemType) {
      throw new Error('Not existing');
    }

    return itemType;
  }

  getPluginById(pluginId: string) {
    const plugin = this.pluginsById.get(pluginId);

    if (!plugin) {
      throw new Error('Not existing');
    }

    return plugin;
  }

  getItemTypeFields(itemType: SchemaTypes.ItemType) {
    return (
      get(itemType, 'relationships.fields.data', []) as Array<{ id: string }>
    )
      .map((f) => f.id)
      .map((fid) => this.fieldsById.get(fid))
      .filter(isDefined);
  }

  getItemTypeFieldsets(itemType: SchemaTypes.ItemType) {
    return (
      get(itemType, 'relationships.fieldsets.data', []) as Array<{
        id: string;
      }>
    )
      .map((fs) => fs.id)
      .map((fsid) => this.fieldsetsById.get(fsid))
      .filter(isDefined);
  }
}

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

      if (
        !isHardcodedEditor(field.attributes.appearance.editor) &&
        !pluginIdsToExport.includes(field.attributes.appearance.editor)
      ) {
        exportableField.attributes.appearance.editor = firstHardcodedEditorFor(
          field.attributes.field_type,
        );
        exportableField.attributes.appearance.field_extension = undefined;
        exportableField.attributes.appearance.parameters = {};
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
