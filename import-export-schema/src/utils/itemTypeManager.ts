import type { Client, SchemaTypes } from '@datocms/cma-client';
import { groupBy } from 'lodash-es';

export class ItemTypeManager {
  public client: Client;
  private itemTypesPromise: Promise<SchemaTypes.ItemType[]> | null = null;
  private pluginsPromise: Promise<SchemaTypes.Plugin[]> | null = null;
  private pluginsById: Map<string, SchemaTypes.Plugin> = new Map();
  private itemTypesByApiKey: Map<string, SchemaTypes.ItemType> = new Map();
  private itemTypesById: Map<string, SchemaTypes.ItemType> = new Map();
  private itemTypesByName: Map<string, SchemaTypes.ItemType> = new Map();
  private fieldsByItemType: Map<string, SchemaTypes.Field[]> = new Map();
  private fieldsetsByItemType: Map<string, SchemaTypes.Fieldset[]> = new Map();
  private alreadyFetchedRelatedFields: Map<string, true> = new Map();

  constructor(client: Client) {
    this.client = client;
  }

  private async loadItemTypes(): Promise<SchemaTypes.ItemType[]> {
    if (!this.itemTypesPromise) {
      this.itemTypesPromise = (async () => {
        const { data: itemTypes } = await this.client.itemTypes.rawList();

        // Populate the lookup maps
        for (const itemType of itemTypes) {
          this.itemTypesByApiKey.set(itemType.attributes.api_key, itemType);
          this.itemTypesById.set(itemType.id, itemType);
          this.itemTypesByName.set(itemType.attributes.name, itemType);
        }

        return itemTypes;
      })();
    }

    return this.itemTypesPromise;
  }

  private async loadPlugins(): Promise<SchemaTypes.Plugin[]> {
    if (!this.pluginsPromise) {
      this.pluginsPromise = (async () => {
        const { data: plugins } = await this.client.plugins.rawList();

        // Populate the lookup maps
        for (const itemType of plugins) {
          this.pluginsById.set(itemType.id, itemType);
        }

        return plugins;
      })();
    }

    return this.pluginsPromise;
  }

  async getAllPlugins(): Promise<SchemaTypes.Plugin[]> {
    const plugins = await this.loadPlugins();
    return plugins;
  }

  async getAllItemTypes(): Promise<SchemaTypes.ItemType[]> {
    const itemTypes = await this.loadItemTypes();
    return itemTypes;
  }

  async getAllModels(): Promise<SchemaTypes.ItemType[]> {
    const itemTypes = await this.loadItemTypes();
    return itemTypes.filter((it) => !it.attributes.modular_block);
  }

  async getAllBlockModels(): Promise<SchemaTypes.ItemType[]> {
    const itemTypes = await this.loadItemTypes();
    return itemTypes.filter((it) => it.attributes.modular_block);
  }

  async getItemTypeByApiKey(apiKey: string): Promise<SchemaTypes.ItemType> {
    await this.loadItemTypes();

    const itemType = this.itemTypesByApiKey.get(apiKey);
    if (!itemType) {
      throw new Error(`Item type with API key '${apiKey}' not found`);
    }

    return itemType;
  }

  async getItemTypeByName(name: string): Promise<SchemaTypes.ItemType> {
    await this.loadItemTypes();

    const itemType = this.itemTypesByName.get(name);
    if (!itemType) {
      throw new Error(`Item type with API key '${name}' not found`);
    }

    return itemType;
  }

  async getItemTypeById(id: string): Promise<SchemaTypes.ItemType> {
    await this.loadItemTypes();

    const itemType = this.itemTypesById.get(id);
    if (!itemType) {
      throw new Error(`Item type with ID '${id}' not found`);
    }

    return itemType;
  }

  async getPluginById(id: string): Promise<SchemaTypes.Plugin> {
    await this.loadPlugins();

    const plugin = this.pluginsById.get(id);
    if (!plugin) {
      throw new Error(`Plugin with ID '${id}' not found`);
    }

    return plugin;
  }

  async getItemTypeFieldsAndFieldsets(
    itemType: SchemaTypes.ItemType,
  ): Promise<[SchemaTypes.Field[], SchemaTypes.Fieldset[]]> {
    if (
      !itemType.attributes.modular_block &&
      !this.fieldsetsByItemType.get(itemType.id)
    ) {
      const { data: fieldsets } = await this.client.fieldsets.rawList(
        itemType.id,
      );
      this.fieldsetsByItemType.set(itemType.id, fieldsets);
    }

    // Check if we already have the fields cached
    const cachedFields = this.fieldsByItemType.get(itemType.id);
    if (
      cachedFields &&
      (itemType.attributes.modular_block ||
        this.alreadyFetchedRelatedFields.get(itemType.id))
    ) {
      return [cachedFields, this.fieldsetsByItemType.get(itemType.id) || []];
    }

    // Fetch and cache the fields
    const { data: fields } = await this.client.fields.rawRelated(itemType.id);

    this.alreadyFetchedRelatedFields.set(itemType.id, true);

    const fieldsByItemTypeId = groupBy(
      fields,
      'relationships.item_type.data.id',
    );

    this.fieldsByItemType.set(
      itemType.id,
      fieldsByItemTypeId[itemType.id] || [],
    );

    for (const [itemTypeId, fields] of Object.entries(fieldsByItemTypeId)) {
      this.fieldsByItemType.set(itemTypeId, fields);
    }

    return this.getItemTypeFieldsAndFieldsets(itemType);
  }
}
