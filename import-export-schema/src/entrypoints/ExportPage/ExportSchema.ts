import { findLinkedItemTypeIds } from '@/utils/datocms/schema';
import { isDefined } from '@/utils/isDefined';
import type { ExportDoc } from '@/utils/types';
import type { SchemaTypes } from '@datocms/cma-client';
import { get } from 'lodash-es';

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

    if (exportDoc.version === '1') {
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
        throw new Error(
          'This export file was generated by an older version of this plugin, and it is invalid because the initial model/block model cannot be determined. Please update to the most recent version of the plugin and export your schema once more.',
        );
      }

      this.rootItemType = rootItemTypes[0];
    } else {
      this.rootItemType = this.getItemTypeById(exportDoc.rootItemTypeId);
    }
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
