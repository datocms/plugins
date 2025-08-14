import type { Client, SchemaTypes } from '@datocms/cma-client';

export class ProjectSchema {
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
  // In-flight promises to prevent duplicate requests per item type
  private fieldsPromisesByItemType: Map<string, Promise<SchemaTypes.Field[]>> =
    new Map();
  private fieldsetsPromisesByItemType: Map<
    string,
    Promise<SchemaTypes.Fieldset[]>
  > = new Map();

  // Simple throttle to avoid hitting 429 when many models are selected
  // Keep concurrency conservative: DatoCMS rate-limits bursty calls
  // If needed, make this configurable later via constructor param
  private throttleMax = 2;
  private throttleActive = 0;
  private throttleQueue: Array<() => void> = [];

  constructor(client: Client) {
    this.client = client;
    try {
      // Allow overriding throttle via localStorage for large schemas
      const raw =
        typeof window !== 'undefined'
          ? window.localStorage?.getItem?.('schemaThrottleMax')
          : undefined;
      const parsed = raw ? parseInt(raw, 10) : NaN;
      if (!Number.isNaN(parsed) && parsed > 0 && parsed < 16) {
        this.throttleMax = parsed;
      }
    } catch {
      // ignore
    }
  }

  private async withThrottle<T>(fn: () => Promise<T>): Promise<T> {
    if (this.throttleActive >= this.throttleMax) {
      await new Promise<void>((resolve) => this.throttleQueue.push(resolve));
    }
    this.throttleActive += 1;
    try {
      return await fn();
    } finally {
      this.throttleActive -= 1;
      const next = this.throttleQueue.shift();
      if (next) next();
    }
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
      throw new Error(`Item type with name '${name}' not found`);
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
    if (!itemType.attributes.modular_block) {
      if (!this.fieldsetsByItemType.get(itemType.id)) {
        let promise = this.fieldsetsPromisesByItemType.get(itemType.id);
        if (!promise) {
          promise = this.withThrottle(async () => {
            const { data } = await this.client.fieldsets.rawList(itemType.id);
            return data;
          });
          this.fieldsetsPromisesByItemType.set(itemType.id, promise);
        }
        const fieldsets = await promise;
        this.fieldsetsByItemType.set(itemType.id, fieldsets);
        this.fieldsetsPromisesByItemType.delete(itemType.id);
      }
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

    let fields = this.fieldsByItemType.get(itemType.id);
    if (!fields || !this.alreadyFetchedRelatedFields.get(itemType.id)) {
      let promise = this.fieldsPromisesByItemType.get(itemType.id);
      if (!promise) {
        promise = this.withThrottle(async () => {
          const { data } = await this.client.fields.rawList(itemType.id);
          return data;
        });
        this.fieldsPromisesByItemType.set(itemType.id, promise);
      }
      fields = await promise;
      this.fieldsByItemType.set(itemType.id, fields);
      this.alreadyFetchedRelatedFields.set(itemType.id, true);
      this.fieldsPromisesByItemType.delete(itemType.id);
    }

    return [fields, this.fieldsetsByItemType.get(itemType.id) || []];
  }
}
