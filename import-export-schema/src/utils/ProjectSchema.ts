import type { Client, SchemaTypes } from '@datocms/cma-client';

/**
 * Thin caching layer around the CMA client that smooths out rate limits and provides lookups.
 */
export class ProjectSchema {
  public client: Client;
  private cacheGeneration = 0;
  private itemTypesPromise: Promise<SchemaTypes.ItemType[]> | null = null;
  private pluginsPromise: Promise<SchemaTypes.Plugin[]> | null = null;
  private pluginsById: Map<string, SchemaTypes.Plugin> = new Map();
  private itemTypesByApiKey: Map<string, SchemaTypes.ItemType> = new Map();
  private itemTypesById: Map<string, SchemaTypes.ItemType> = new Map();
  private itemTypesByName: Map<string, SchemaTypes.ItemType> = new Map();
  private fieldsByItemType: Map<string, SchemaTypes.Field[]> = new Map();
  private fieldsetsByItemType: Map<string, SchemaTypes.Fieldset[]> = new Map();
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

  /** Let higher-level task queues match the configured CMA request concurrency. */
  get maxConcurrentRequests(): number {
    return this.throttleMax;
  }

  /** Discard a schema snapshot after imports, including partially completed ones. */
  invalidate(): void {
    this.cacheGeneration += 1;
    this.itemTypesPromise = null;
    this.pluginsPromise = null;
    this.pluginsById.clear();
    this.itemTypesByApiKey.clear();
    this.itemTypesById.clear();
    this.itemTypesByName.clear();
    this.fieldsByItemType.clear();
    this.fieldsetsByItemType.clear();
    this.fieldsPromisesByItemType.clear();
    this.fieldsetsPromisesByItemType.clear();
  }

  private async withThrottle<T>(fn: () => Promise<T>): Promise<T> {
    if (
      this.throttleActive >= this.throttleMax ||
      this.throttleQueue.length > 0
    ) {
      await new Promise<void>((resolve) => this.throttleQueue.push(resolve));
    } else {
      this.throttleActive += 1;
    }
    try {
      return await fn();
    } finally {
      const next = this.throttleQueue.shift();
      // Transfer the reserved slot directly. Decrementing before waking a waiter
      // lets newly-arriving work steal it and exceed the concurrency limit.
      if (next) next();
      else this.throttleActive -= 1;
    }
  }

  private async loadItemTypes(): Promise<SchemaTypes.ItemType[]> {
    if (!this.itemTypesPromise) {
      const generation = this.cacheGeneration;
      this.itemTypesPromise = (async () => {
        const { data: itemTypes } = await this.withThrottle(() =>
          this.client.itemTypes.rawList(),
        );
        if (generation !== this.cacheGeneration) return this.loadItemTypes();

        // Populate the lookup maps
        for (const itemType of itemTypes) {
          this.itemTypesByApiKey.set(itemType.attributes.api_key, itemType);
          this.itemTypesById.set(itemType.id, itemType);
          this.itemTypesByName.set(itemType.attributes.name, itemType);
        }

        return itemTypes;
      })().catch((error: unknown) => {
        if (generation === this.cacheGeneration) this.itemTypesPromise = null;
        throw error;
      });
    }

    return this.itemTypesPromise;
  }

  private async loadPlugins(): Promise<SchemaTypes.Plugin[]> {
    if (!this.pluginsPromise) {
      const generation = this.cacheGeneration;
      this.pluginsPromise = (async () => {
        const { data: plugins } = await this.withThrottle(() =>
          this.client.plugins.rawList(),
        );
        if (generation !== this.cacheGeneration) return this.loadPlugins();

        // Populate the lookup maps
        for (const itemType of plugins) {
          this.pluginsById.set(itemType.id, itemType);
        }

        return plugins;
      })().catch((error: unknown) => {
        if (generation === this.cacheGeneration) this.pluginsPromise = null;
        throw error;
      });
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
    options: { shouldCancel?: () => boolean } = {},
  ): Promise<[SchemaTypes.Field[], SchemaTypes.Fieldset[]]> {
    const generation = this.cacheGeneration;
    const checkCancelled = () => {
      if (options.shouldCancel?.()) throw new Error('Export cancelled');
    };
    checkCancelled();
    // The fieldset endpoint includes block models too. Older code skipped them
    // entirely, losing fieldsets (and their field relationships) in the export.
    if (!this.fieldsetsByItemType.has(itemType.id)) {
      let promise = this.fieldsetsPromisesByItemType.get(itemType.id);
      if (!promise) {
        promise = this.withThrottle(async () => {
          const { data } = await this.client.fieldsets.rawList(itemType.id);
          if (generation === this.cacheGeneration) {
            this.fieldsetsByItemType.set(itemType.id, data);
          }
          return data;
        }).finally(() => {
          if (generation === this.cacheGeneration) {
            this.fieldsetsPromisesByItemType.delete(itemType.id);
          }
        });
        this.fieldsetsPromisesByItemType.set(itemType.id, promise);
      }
      await promise;
    }
    checkCancelled();
    if (generation !== this.cacheGeneration) {
      return this.getItemTypeFieldsAndFieldsets(itemType, options);
    }

    // Check if we already have the fields cached
    const cachedFields = this.fieldsByItemType.get(itemType.id);
    if (cachedFields) {
      return [cachedFields, this.fieldsetsByItemType.get(itemType.id) || []];
    }

    let fields = this.fieldsByItemType.get(itemType.id);
    if (!fields) {
      let promise = this.fieldsPromisesByItemType.get(itemType.id);
      if (!promise) {
        promise = this.withThrottle(async () => {
          const { data } = await this.client.fields.rawList(itemType.id);
          if (generation === this.cacheGeneration) {
            this.fieldsByItemType.set(itemType.id, data);
          }
          return data;
        }).finally(() => {
          if (generation === this.cacheGeneration) {
            this.fieldsPromisesByItemType.delete(itemType.id);
          }
        });
        this.fieldsPromisesByItemType.set(itemType.id, promise);
      }
      fields = await promise;
    }
    checkCancelled();
    if (generation !== this.cacheGeneration) {
      return this.getItemTypeFieldsAndFieldsets(itemType, options);
    }
    return [fields, this.fieldsetsByItemType.get(itemType.id) || []];
  }
}
