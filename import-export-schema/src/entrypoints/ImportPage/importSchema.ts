import {
  ApiError,
  Client,
  generateId,
  type SchemaTypes,
  TimeoutError,
} from '@datocms/cma-client';
import cloneDeep from 'lodash-es/cloneDeep';
import get from 'lodash-es/get';
import isEqual from 'lodash-es/isEqual';
import omit from 'lodash-es/omit';
import pick from 'lodash-es/pick';
import set from 'lodash-es/set';
import { mapAppearanceToProject } from '@/utils/datocms/appearance';
import {
  validatorsContainingBlocks,
  validatorsContainingLinks,
} from '@/utils/datocms/schema';
import { debugLog } from '@/utils/debug';
import type { ImportDoc } from './buildImportDoc';

const CONCURRENCY = 4;
// Leave room below the CMA's 60 requests / 3 seconds for other dashboard activity.
const REQUEST_INTERVAL_MS = 75;
const MAX_RETRIES = 8;
const itemTypeRelationships = [
  'ordering_field',
  'title_field',
  'image_preview_field',
  'excerpt_field',
  'presentation_title_field',
  'presentation_image_field',
] as const;
const itemTypeFinalAttributes = ['ordering_direction', 'ordering_meta'];

function getOrThrow<K, V>(map: Map<K, V>, key: K, context: string): V {
  const value = map.get(key);
  if (value === undefined)
    throw new Error(`Missing mapping for ${String(key)} in ${context}`);
  return value;
}

export type ImportProgress = {
  total: number;
  finished: number;
  label?: string;
};
export type ImportResult = {
  itemTypeIdByExportId: Record<string, string>;
  fieldIdByExportId: Record<string, string>;
  fieldsetIdByExportId: Record<string, string>;
  pluginIdByExportId: Record<string, string>;
};
type ProgressUpdate = (progress: ImportProgress) => void;
type ShouldCancel = () => boolean;
type ItemTypeToCreate = ImportDoc['itemTypes']['entitiesToCreate'][number];

class ProgressTracker {
  private finished = 0;
  private failed = false;
  private failure: unknown;

  constructor(
    private readonly total: number,
    private readonly update: ProgressUpdate,
    private readonly shouldCancel: ShouldCancel,
  ) {
    this.report();
  }

  checkCancel() {
    if (this.failed) throw this.failure;
    if (this.shouldCancel()) throw new Error('Import cancelled');
  }

  stop(error: unknown) {
    if (!this.failed) {
      this.failed = true;
      this.failure = error;
    }
  }

  report(label?: string) {
    this.update({ total: this.total, finished: this.finished, label });
  }

  async run<T>(label: string, task: () => Promise<T>): Promise<T> {
    try {
      this.checkCancel();
      this.report(label);
      const result = await task();
      // Only successful work advances progress, including requests already in flight
      // when cancellation or a sibling failure occurs.
      this.finished += 1;
      this.report(label);
      this.checkCancel();
      return result;
    } catch (error) {
      this.stop(error);
      throw error;
    }
  }

  async wait(milliseconds: number) {
    const until = Date.now() + milliseconds;
    while (Date.now() < until) {
      this.checkCancel();
      // biome-ignore lint/performance/noAwaitInLoops: Small waits allow cancellation during backoff.
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(100, until - Date.now())),
      );
    }
    this.checkCancel();
  }
}

function retryDelay(error: unknown, attempt: number): number {
  if (error instanceof ApiError && error.response.status === 429) {
    const headers = error.response.headers;
    const reset = Number(
      headers['x-ratelimit-reset'] ?? headers['X-RateLimit-Reset'],
    );
    if (Number.isFinite(reset) && reset > 0) return reset * 1000;
  }
  return Math.min(30_000, 1000 * 2 ** attempt);
}

function canRetry(error: unknown, method: string): boolean {
  if (error instanceof ApiError) {
    // A failed job-result GET is not a rejection of the original create POST.
    if (method === 'POST' && error.request.method !== 'POST') return false;
    if (error.response.status === 429) return true;
    if (error.errors.some((entry) => entry.attributes.transient)) return true;
    return method !== 'POST' && error.response.status >= 500;
  }
  // A create timeout/network failure has an ambiguous outcome. Replaying its POST
  // could duplicate work or turn an already-created entity into an ID collision.
  return (
    method !== 'POST' &&
    (error instanceof TimeoutError || error instanceof TypeError)
  );
}

function creationLookup(options: Parameters<Client['request']>[0]) {
  const paths: Record<string, string> = {
    item_type: '/item-types',
    field: '/fields',
    fieldset: '/fieldsets',
    plugin: '/plugins',
  };
  const type = get(options.body, 'data.type') as string | undefined;
  const id = get(options.body, 'data.id') as string | undefined;
  if (!type || !id || !paths[type]) return undefined;
  return `${paths[type]}/${encodeURIComponent(id)}`;
}

function creationMatches(response: unknown, body: unknown) {
  // Compare the actual JSON sent over the wire (optional undefined properties
  // such as appearance.field_extension are absent in API read responses).
  const data =
    body && typeof body === 'object' && 'data' in body ? body.data : undefined;
  if (!data || typeof data !== 'object') return false;
  const expected = JSON.parse(JSON.stringify(data)) as {
    id: string;
    type: string;
    attributes: Record<string, unknown>;
    relationships?: Record<string, unknown>;
  };
  if (
    get(response, 'data.id') !== expected.id ||
    get(response, 'data.type') !== expected.type
  )
    return false;
  if (
    !isEqual(
      pick(get(response, 'data.attributes'), Object.keys(expected.attributes)),
      expected.attributes,
    )
  )
    return false;
  return (
    !expected.relationships ||
    isEqual(
      pick(
        get(response, 'data.relationships'),
        Object.keys(expected.relationships),
      ),
      expected.relationships,
    )
  );
}

/** Isolate retry policy from the shared client, including async job polling. */
class ImportClient extends Client {
  private nextRequestAt = 0;

  constructor(
    client: Client,
    private readonly tracker: ProgressTracker,
  ) {
    super({ ...client.config, autoRetry: false });
  }

  private async reconcileCreate<T>(
    options: Parameters<Client['request']>[0],
    error: unknown,
  ): Promise<T | undefined> {
    if (
      options.method !== 'POST' ||
      !(error instanceof TimeoutError || error instanceof TypeError)
    )
      return undefined;
    const url = creationLookup(options);
    if (!url) return undefined;
    this.tracker.report('Checking whether an API create completed');
    try {
      const response = await this.request<T>({ method: 'GET', url });
      return creationMatches(response, options.body) ? response : undefined;
    } catch {
      this.tracker.checkCancel();
      // A 404 cannot prove that the original request will not commit later.
      return undefined;
    }
  }

  override async request<T>(
    options: Parameters<Client['request']>[0],
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      this.tracker.checkCancel();
      const startAt = Math.max(Date.now(), this.nextRequestAt);
      this.nextRequestAt = startAt + REQUEST_INTERVAL_MS;
      // biome-ignore lint/performance/noAwaitInLoops: Each attempt must obey the shared pacing and cancellation signal.
      await this.tracker.wait(startAt - Date.now());
      let acceptedJob = false;
      const fetchFn: typeof fetch = async (input, init) => {
        const response = await (this.config.fetchFn ?? globalThis.fetch)(
          input,
          init,
        );
        acceptedJob = response.status === 202;
        return response;
      };
      const requestOptions = { ...options, fetchFn };
      try {
        return await super.request<T>(requestOptions);
      } catch (error) {
        // The SDK polls an accepted job and reports its final error using the
        // original request method. Retrying here would submit the mutation again.
        if (acceptedJob) throw error;
        const recovered = await this.reconcileCreate<T>(options, error);
        if (recovered !== undefined) return recovered;
        if (attempt >= MAX_RETRIES || !canRetry(error, options.method))
          throw error;
        this.tracker.report('Waiting to retry an API request');
        await this.tracker.wait(retryDelay(error, attempt));
      }
    }
  }
}

type ImportMappings = {
  itemTypeIds: Map<string, string>;
  fieldIds: Map<string, string>;
  fieldsetIds: Map<string, string>;
  pluginIds: Map<string, string>;
};
type ImportContext = {
  client: Client;
  tracker: ProgressTracker;
  locales: string[];
  importDoc: ImportDoc;
  mappings: ImportMappings;
};

function addMapping(map: Map<string, string>, id: string, replacement: string) {
  if (map.has(id)) throw new Error(`Duplicate entity ID in import: ${id}`);
  map.set(id, replacement);
}

function replacementId(id: string, idsToReplace: Record<string, true>) {
  return idsToReplace[id] ? generateId() : id;
}

function prepareMappings(importDoc: ImportDoc): ImportMappings {
  const mappings: ImportMappings = {
    itemTypeIds: new Map(),
    fieldIds: new Map(),
    fieldsetIds: new Map(),
    pluginIds: new Map(),
  };
  for (const { entity, fields, fieldsets } of importDoc.itemTypes
    .entitiesToCreate) {
    addMapping(
      mappings.itemTypeIds,
      entity.id,
      replacementId(entity.id, importDoc.idsToReplace.itemTypes),
    );
    for (const field of fields)
      addMapping(
        mappings.fieldIds,
        field.id,
        replacementId(field.id, importDoc.idsToReplace.fields),
      );
    for (const fieldset of fieldsets)
      addMapping(
        mappings.fieldsetIds,
        fieldset.id,
        replacementId(fieldset.id, importDoc.idsToReplace.fieldsets),
      );
  }
  for (const [id, replacement] of Object.entries(
    importDoc.itemTypes.idsToReuse,
  ))
    addMapping(mappings.itemTypeIds, id, replacement);
  for (const plugin of importDoc.plugins.entitiesToCreate)
    addMapping(
      mappings.pluginIds,
      plugin.id,
      replacementId(plugin.id, importDoc.idsToReplace.plugins),
    );
  for (const [id, replacement] of Object.entries(importDoc.plugins.idsToReuse))
    addMapping(mappings.pluginIds, id, replacement);
  return mappings;
}

function validatorPaths(field: SchemaTypes.Field) {
  return [...validatorsContainingLinks, ...validatorsContainingBlocks]
    .filter((entry) => entry.field_type === field.attributes.field_type)
    .map((entry) => entry.validator);
}

function linkedIds(
  field: SchemaTypes.Field,
  path: string,
): string[] | undefined {
  const ids: unknown = get(field.attributes.validators, path);
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))
    throw new Error(`Invalid validator ${path} in field ${field.id}`);
  return ids;
}

function validateField(
  field: SchemaTypes.Field,
  itemType: ItemTypeToCreate,
  mappings: ImportMappings,
  fieldsById: Map<string, SchemaTypes.Field>,
  fieldsetsById: Set<string>,
) {
  if (field.relationships.item_type.data.id !== itemType.entity.id)
    throw new Error(`Field ${field.id} belongs to a different model`);
  const fieldset = field.relationships.fieldset.data;
  if (fieldset && !fieldsetsById.has(fieldset.id))
    throw new Error(
      `Field ${field.id} references a missing fieldset: ${fieldset.id}`,
    );
  for (const path of validatorPaths(field)) {
    for (const id of linkedIds(field, path) ?? [])
      getOrThrow(
        mappings.itemTypeIds,
        id,
        `validator ${path} in field ${field.id}`,
      );
  }
  const slugTitleId = get(
    field.attributes.validators,
    'slug_title_field.title_field_id',
  ) as string | undefined;
  if (
    slugTitleId !== undefined &&
    fieldsById.get(slugTitleId)?.attributes.field_type !== 'string'
  )
    throw new Error(
      `Slug field ${field.id} references a missing or invalid title field: ${slugTitleId}`,
    );
}

/** Fail before writes rather than silently dropping missing dependencies. */
function validateImport(importDoc: ImportDoc, mappings: ImportMappings) {
  for (const itemType of importDoc.itemTypes.entitiesToCreate) {
    const fieldsById = new Map(
      itemType.fields.map((field) => [field.id, field]),
    );
    const fieldsetsById = new Set(
      itemType.fieldsets.map((fieldset) => fieldset.id),
    );
    for (const fieldset of itemType.fieldsets) {
      if (fieldset.relationships.item_type.data.id !== itemType.entity.id) {
        throw new Error(`Fieldset ${fieldset.id} belongs to a different model`);
      }
    }
    for (const field of itemType.fields)
      validateField(field, itemType, mappings, fieldsById, fieldsetsById);
    for (const name of itemTypeRelationships) {
      const handle = itemType.entity.relationships[name]?.data;
      if (handle && !fieldsById.has(handle.id))
        throw new Error(
          `Model ${itemType.entity.id} references a missing ${name}: ${handle.id}`,
        );
    }
  }
}

/** Only four workers and their current entities are retained; no recursive chain or nested pools. */
async function pMap<T>(
  items: Iterable<T>,
  tracker: ProgressTracker,
  task: (item: T) => Promise<void>,
) {
  const iterator = items[Symbol.iterator]();
  async function worker() {
    try {
      while (true) {
        tracker.checkCancel();
        const next = iterator.next();
        if (next.done) return;
        // biome-ignore lint/performance/noAwaitInLoops: A worker must finish its entity before requesting another.
        await task(next.value);
      }
    } catch (error) {
      tracker.stop(error);
    }
  }
  // Drain every in-flight request before surfacing cancellation/failure.
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  tracker.checkCancel();
}

function buildPluginCreateData(
  plugin: SchemaTypes.Plugin,
  id: string,
): SchemaTypes.PluginCreateSchema['data'] {
  const attributes: SchemaTypes.PluginCreateSchema['data']['attributes'] =
    plugin.attributes.package_name
      ? { package_name: plugin.attributes.package_name }
      : pick(plugin.attributes, ['name', 'description', 'url', 'permissions']);
  if (!plugin.attributes.package_name && plugin.meta.version !== '2') {
    attributes.plugin_type = plugin.attributes.plugin_type ?? undefined;
    attributes.field_types = plugin.attributes.field_types ?? undefined;
    attributes.parameter_definitions =
      plugin.attributes.parameter_definitions ?? undefined;
  }
  return { type: 'plugin', id, attributes };
}

function verifyCreatedId(actual: string, expected: string) {
  if (actual !== expected)
    throw new Error(
      `API returned unexpected entity ID ${actual}; expected ${expected}`,
    );
}

async function createPluginsPhase({
  client,
  tracker,
  importDoc,
  mappings,
}: ImportContext) {
  await pMap(importDoc.plugins.entitiesToCreate, tracker, async (plugin) => {
    const name =
      plugin.attributes.name || plugin.attributes.package_name || plugin.id;
    const id = getOrThrow(mappings.pluginIds, plugin.id, 'plugin create');
    const created = await tracker.run(`Creating plugin: ${name}`, async () => {
      const { data } = await client.plugins.rawCreate({
        data: buildPluginCreateData(plugin, id),
      });
      verifyCreatedId(data.id, id);
      return data;
    });
    if (!isEqual(plugin.attributes.parameters, {})) {
      await tracker.run(`Configuring plugin: ${name}`, async () => {
        if (
          !isEqual(created.attributes.parameters, plugin.attributes.parameters)
        )
          await client.plugins.update(id, {
            parameters: plugin.attributes.parameters,
          });
      });
    }
  });
}

async function createItemTypesPhase({
  client,
  tracker,
  importDoc,
  mappings,
}: ImportContext) {
  const createdById = new Map<string, SchemaTypes.ItemType>();
  await pMap(
    importDoc.itemTypes.entitiesToCreate,
    tracker,
    async ({ entity, rename }) => {
      await tracker.run(
        `Creating ${entity.attributes.modular_block ? 'block' : 'model'}: ${rename?.name || entity.attributes.name}`,
        async () => {
          const id = getOrThrow(
            mappings.itemTypeIds,
            entity.id,
            'model create',
          );
          const attributes = omit(entity.attributes, [
            'has_singleton_item',
            'ordering_direction',
            'ordering_meta',
          ]);
          if (rename) {
            attributes.name = rename.name;
            attributes.api_key = rename.apiKey;
          }
          const { data } = await client.itemTypes.rawCreate({
            data: { type: 'item_type', id, attributes },
          });
          verifyCreatedId(data.id, id);
          createdById.set(id, data);
        },
      );
    },
  );
  return createdById;
}

function* fieldsetsToCreate(importDoc: ImportDoc) {
  for (const itemType of importDoc.itemTypes.entitiesToCreate) {
    for (const fieldset of itemType.fieldsets) yield { itemType, fieldset };
  }
}

function* fieldsToCreate(importDoc: ImportDoc, slugs: boolean) {
  for (const itemType of importDoc.itemTypes.entitiesToCreate) {
    for (const field of itemType.fields) {
      if ((field.attributes.field_type === 'slug') === slugs)
        yield { itemType, field };
    }
  }
}

async function createFieldsetsAndFieldsPhase(context: ImportContext) {
  const { client, tracker, importDoc, mappings } = context;
  await pMap(
    fieldsetsToCreate(importDoc),
    tracker,
    async ({ itemType, fieldset }) => {
      await tracker.run(
        `Creating fieldset in ${itemType.entity.attributes.name}`,
        async () => {
          const id = getOrThrow(
            mappings.fieldsetIds,
            fieldset.id,
            'fieldset create',
          );
          const data: SchemaTypes.FieldsetCreateSchema['data'] = {
            ...omit(fieldset, ['relationships']),
            id,
          };
          const { data: created } = await client.fieldsets.rawCreate(
            getOrThrow(
              mappings.itemTypeIds,
              itemType.entity.id,
              'fieldset model',
            ),
            { data },
          );
          verifyCreatedId(created.id, id);
        },
      );
    },
  );
  // All models already exist, so link/block validators can include cycles.
  // All non-slug fields finish before slug title-field references are applied.
  const createField = async ({
    itemType,
    field,
  }: {
    itemType: ItemTypeToCreate;
    field: SchemaTypes.Field;
  }) => {
    await tracker.run(
      `Creating field ${field.attributes.label || field.attributes.api_key} in ${itemType.entity.attributes.name}`,
      () => importField(field, context),
    );
  };
  await pMap(fieldsToCreate(importDoc, false), tracker, createField);
  await pMap(fieldsToCreate(importDoc, true), tracker, createField);
}

async function finalizeItemTypesPhase(
  context: ImportContext,
  createdById: Map<string, SchemaTypes.ItemType>,
) {
  const { client, tracker, importDoc, mappings } = context;
  await pMap(
    importDoc.itemTypes.entitiesToCreate,
    tracker,
    async ({ entity, rename }) => {
      await tracker.run(
        `Finalizing ${entity.attributes.modular_block ? 'block' : 'model'}: ${rename?.name || entity.attributes.name}`,
        async () => {
          const id = getOrThrow(
            mappings.itemTypeIds,
            entity.id,
            'finalize model',
          );
          const created = getOrThrow(createdById, id, 'created model');
          const data: SchemaTypes.ItemTypeUpdateSchema['data'] = {
            type: 'item_type',
            id,
            attributes: pick(entity.attributes, itemTypeFinalAttributes),
            relationships: Object.fromEntries(
              itemTypeRelationships.map((name) => {
                const handle = entity.relationships[name]?.data;
                return [
                  name,
                  {
                    data: handle
                      ? {
                          type: 'field',
                          id: getOrThrow(
                            mappings.fieldIds,
                            handle.id,
                            'model presentation field',
                          ),
                        }
                      : null,
                  },
                ];
              }),
            ) as NonNullable<
              SchemaTypes.ItemTypeUpdateSchema['data']['relationships']
            >,
          };
          if (
            !isEqual(
              data.attributes,
              pick(created.attributes, itemTypeFinalAttributes),
            ) ||
            !isEqual(
              data.relationships,
              pick(created.relationships, itemTypeRelationships),
            )
          )
            await client.itemTypes.rawUpdate(id, { data });
        },
      );
    },
  );
}

type ReorderableEntity = SchemaTypes.Fieldset | SchemaTypes.Field;

async function reorderEntitiesPhase({
  client,
  tracker,
  importDoc,
  mappings,
}: ImportContext) {
  await pMap(
    importDoc.itemTypes.entitiesToCreate,
    tracker,
    async ({ entity: itemType, fields, fieldsets }) => {
      const entities: ReorderableEntity[] = [...fieldsets, ...fields];
      if (entities.length <= 1) return;
      entities.sort(
        (left, right) => left.attributes.position - right.attributes.position,
      );
      for (const entity of entities) {
        // biome-ignore lint/performance/noAwaitInLoops: Position updates affect siblings and must be sequential within each model.
        await tracker.run(
          `Reordering field/fieldset in ${itemType.attributes.name}`,
          async () => {
            const position = entity.attributes.position;
            if (entity.type === 'fieldset')
              await client.fieldsets.update(
                getOrThrow(mappings.fieldsetIds, entity.id, 'fieldset reorder'),
                { position },
              );
            else
              await client.fields.update(
                getOrThrow(mappings.fieldIds, entity.id, 'field reorder'),
                { position },
              );
          },
        );
      }
    },
  );
}

function countOperations(importDoc: ImportDoc) {
  let total = 1 + importDoc.plugins.entitiesToCreate.length;
  for (const plugin of importDoc.plugins.entitiesToCreate)
    if (!isEqual(plugin.attributes.parameters, {})) total += 1;
  for (const itemType of importDoc.itemTypes.entitiesToCreate) {
    const childCount = itemType.fields.length + itemType.fieldsets.length;
    total += 2 + childCount + (childCount > 1 ? childCount : 0);
  }
  return total;
}

export default async function importSchema(
  importDoc: ImportDoc,
  client: Client,
  updateProgress: ProgressUpdate,
  opts?: { shouldCancel?: ShouldCancel },
): Promise<ImportResult> {
  const tracker = new ProgressTracker(
    countOperations(importDoc),
    updateProgress,
    opts?.shouldCancel ?? (() => false),
  );
  tracker.checkCancel();
  const mappings = prepareMappings(importDoc);
  validateImport(importDoc, mappings);
  const importClient = new ImportClient(client, tracker);
  const { locales } = await tracker.run('Loading project locales', () =>
    importClient.site.find(),
  );
  const context: ImportContext = {
    client: importClient,
    tracker,
    locales,
    importDoc,
    mappings,
  };
  await createPluginsPhase(context);
  const createdById = await createItemTypesPhase(context);
  await createFieldsetsAndFieldsPhase(context);
  await finalizeItemTypesPhase(context, createdById);
  await reorderEntitiesPhase(context);
  return {
    itemTypeIdByExportId: Object.fromEntries(mappings.itemTypeIds),
    fieldIdByExportId: Object.fromEntries(mappings.fieldIds),
    fieldsetIdByExportId: Object.fromEntries(mappings.fieldsetIds),
    pluginIdByExportId: Object.fromEntries(mappings.pluginIds),
  };
}

async function importField(
  field: SchemaTypes.Field,
  { client, locales, mappings }: ImportContext,
) {
  const appearance = await mapAppearanceToProject(field, mappings.pluginIds);
  const id = getOrThrow(mappings.fieldIds, field.id, 'field create');
  const data: SchemaTypes.FieldCreateSchema['data'] = {
    type: 'field',
    id,
    attributes: { ...field.attributes, appearance },
    relationships: {
      fieldset: {
        data: field.relationships.fieldset.data
          ? {
              type: 'fieldset',
              id: getOrThrow(
                mappings.fieldsetIds,
                field.relationships.fieldset.data.id,
                'field fieldset',
              ),
            }
          : null,
      },
    },
  };
  // Do not mutate validators belonging to the export document when remapping IDs.
  data.attributes.validators = cloneDeep(field.attributes.validators);
  for (const path of validatorPaths(field)) {
    const ids = linkedIds(field, path);
    if (ids !== undefined)
      set(
        data.attributes.validators ?? {},
        path,
        ids.map((linkedId) =>
          getOrThrow(mappings.itemTypeIds, linkedId, `field validator ${path}`),
        ),
      );
  }
  const slugTitleId = get(
    field.attributes.validators,
    'slug_title_field.title_field_id',
  ) as string | undefined;
  if (slugTitleId !== undefined)
    set(
      data.attributes.validators ?? {},
      'slug_title_field.title_field_id',
      getOrThrow(mappings.fieldIds, slugTitleId, 'slug title field'),
    );
  delete (data.attributes as { appeareance?: unknown }).appeareance;
  if (field.attributes.localized) {
    const oldDefaults = field.attributes.default_value as Record<
      string,
      unknown
    >;
    data.attributes.default_value = Object.fromEntries(
      locales.map((locale) => [locale, oldDefaults?.[locale] ?? null]),
    ) as typeof data.attributes.default_value;
  }
  debugLog('Creating field', data);
  const { data: created } = await client.fields.rawCreate(
    getOrThrow(
      mappings.itemTypeIds,
      field.relationships.item_type.data.id,
      'field model',
    ),
    { data },
  );
  verifyCreatedId(created.id, id);
}
