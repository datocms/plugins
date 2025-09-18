import { type Client, generateId, type SchemaTypes } from '@datocms/cma-client';
import { find, get, isEqual, omit, pick, set, sortBy } from 'lodash-es';
import { mapAppearanceToProject } from '@/utils/datocms/appearance';
import {
  validatorsContainingBlocks,
  validatorsContainingLinks,
} from '@/utils/datocms/schema';
import { debugLog } from '@/utils/debug';
import type { ImportDoc } from './buildImportDoc';

/** Convenience helper to surface clearer errors when an ID mapping is missing. */
function getOrThrow<K, V>(map: Map<K, V>, key: K, context: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Missing mapping for ${String(key)} in ${context}`);
  }
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

/**
 * Reports task progress while guarding against cancellation between steps.
 */
class ProgressTracker {
  private finished = 0;

  constructor(
    private readonly total: number,
    private readonly update: ProgressUpdate,
    private readonly shouldCancel: ShouldCancel,
  ) {}

  checkCancel() {
    if (this.shouldCancel()) {
      throw new Error('Import cancelled');
    }
  }

  private report(label?: string) {
    this.update({ total: this.total, finished: this.finished, label });
  }

  async run<TArgs extends unknown[], TResult>(
    labelForCall: (...args: TArgs) => string,
    fn: (...args: TArgs) => Promise<TResult>,
    ...args: TArgs
  ): Promise<TResult> {
    let label: string | undefined;
    try {
      this.checkCancel();
      label = labelForCall(...args);
      this.report(label);
      const result = await fn(...args);
      this.checkCancel();
      return result;
    } finally {
      this.finished += 1;
      this.report(label);
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

/**
 * Pre-generate project-side IDs for every entity that will be created during import.
 */
function prepareMappings(importDoc: ImportDoc): ImportMappings {
  const itemTypeIds = new Map<string, string>();
  const fieldIds = new Map<string, string>();
  const fieldsetIds = new Map<string, string>();
  const pluginIds = new Map<string, string>();

  for (const toCreate of importDoc.itemTypes.entitiesToCreate) {
    itemTypeIds.set(toCreate.entity.id, generateId());

    for (const field of toCreate.fields) {
      fieldIds.set(field.id, generateId());
    }

    for (const fieldset of toCreate.fieldsets) {
      fieldsetIds.set(fieldset.id, generateId());
    }
  }

  for (const [exportId, projectId] of Object.entries(
    importDoc.itemTypes.idsToReuse,
  )) {
    itemTypeIds.set(exportId, projectId);
  }

  for (const plugin of importDoc.plugins.entitiesToCreate) {
    pluginIds.set(plugin.id, generateId());
  }

  for (const [exportId, projectId] of Object.entries(
    importDoc.plugins.idsToReuse,
  )) {
    pluginIds.set(exportId, projectId);
  }

  return { itemTypeIds, fieldIds, fieldsetIds, pluginIds };
}

/**
 * Concurrency-limited map that respects cancellation signals between iterations.
 */
async function pMap<T, R>(
  items: readonly T[],
  limit: number,
  iteratee: (item: T, index: number) => Promise<R>,
  checkCancel: () => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let error: unknown = null;

  async function worker() {
    while (true) {
      if (error) return;
      const current = nextIndex;
      if (current >= items.length) return;
      nextIndex += 1;
      try {
        checkCancel();
        const result = await iteratee(items[current], current);
        results[current] = result;
      } catch (err) {
        error = err;
        return;
      }
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    () => worker(),
  );
  await Promise.all(workers);
  if (error) throw error;
  return results;
}

/**
 * Install any plugins bundled with the export before creating linked entities.
 */
async function createPluginsPhase(context: ImportContext) {
  const {
    client,
    tracker,
    importDoc: {
      plugins: { entitiesToCreate: pluginsToCreate },
    },
    mappings: { pluginIds },
  } = context;

  await pMap(
    pluginsToCreate,
    4,
    (plugin) =>
      tracker.run(
        (p: SchemaTypes.Plugin) =>
          `Creating plugin: ${
            p.attributes.name || p.attributes.package_name || p.id
          }`,
        async (p: SchemaTypes.Plugin) => {
          const data: SchemaTypes.PluginCreateSchema['data'] = {
            type: 'plugin',
            id: pluginIds.get(p.id),
            attributes: p.attributes.package_name
              ? pick(p.attributes, ['package_name'])
              : p.meta.version === '2'
                ? omit(p.attributes, ['parameters'])
                : omit(p.attributes, [
                    'parameter_definitions',
                    'field_types',
                    'plugin_type',
                    'parameters',
                  ]),
          };

          try {
            debugLog('Creating plugin', data);
            const { data: created } = await client.plugins.rawCreate({ data });

            if (!isEqual(created.attributes.parameters, {})) {
              try {
                await client.plugins.update(created.id, {
                  parameters: created.attributes.parameters,
                });
              } catch {
                // ignore invalid legacy parameters
              }
            }
            debugLog('Created plugin', created);
          } catch (error) {
            console.error('Failed to create plugin', data, error);
          }
        },
        plugin,
      ),
    () => tracker.checkCancel(),
  );
}

/**
 * Create item types (models and blocks) and return the freshly created records.
 */
async function createItemTypesPhase(
  context: ImportContext,
): Promise<Array<SchemaTypes.ItemType | undefined>> {
  const {
    client,
    tracker,
    importDoc: {
      itemTypes: { entitiesToCreate: itemTypesToCreate },
    },
    mappings: { itemTypeIds },
  } = context;

  return pMap(
    itemTypesToCreate,
    3,
    (toCreate) =>
      tracker.run(
        (t: ImportDoc['itemTypes']['entitiesToCreate'][number]) =>
          `Creating ${t.entity.attributes.modular_block ? 'block' : 'model'}: ${
            t.rename?.name || t.entity.attributes.name
          }`,
        async (t: ImportDoc['itemTypes']['entitiesToCreate'][number]) => {
          const data: SchemaTypes.ItemTypeCreateSchema['data'] = {
            type: 'item_type',
            id: itemTypeIds.get(t.entity.id),
            attributes: omit(t.entity.attributes, [
              'has_singleton_item',
              'ordering_direction',
              'ordering_meta',
            ]),
          };

          if (t.rename) {
            data.attributes.name = t.rename.name;
            data.attributes.api_key = t.rename.apiKey;
          }

          try {
            debugLog('Creating item type', data);
            const { data: created } = await client.itemTypes.rawCreate({ data });
            debugLog('Created item type', created);
            return created;
          } catch (error) {
            console.error('Failed to create item type', data, error);
            return undefined;
          }
        },
        toCreate,
      ),
    () => tracker.checkCancel(),
  );
}

/**
 * Create fieldsets and fields for each item type, respecting dependencies and validators.
 */
async function createFieldsetsAndFieldsPhase(
  context: ImportContext,
) {
  const {
    client,
    tracker,
    locales,
    importDoc: {
      itemTypes: { entitiesToCreate: itemTypesToCreate },
    },
    mappings,
  } = context;

  await pMap(
    itemTypesToCreate,
    2,
    async ({ entity, fields, fieldsets }) => {
      const itemTypeId = entity.id;

      await pMap(
        fieldsets,
        4,
        (fieldset) =>
          tracker.run(
            (_fs: SchemaTypes.Fieldset) =>
              `Creating fieldset in ${entity.attributes.name}`,
            async (fs: SchemaTypes.Fieldset) => {
              const data: SchemaTypes.FieldsetCreateSchema['data'] = {
                ...omit(fs, ['relationships']),
                id: mappings.fieldsetIds.get(fs.id),
              };

              try {
                debugLog('Creating fieldset', data);
                const itemTypeProjectId = getOrThrow(
                  mappings.itemTypeIds,
                  itemTypeId,
                  'fieldset create',
                );
                const { data: created } = await client.fieldsets.rawCreate(
                  itemTypeProjectId,
                  { data },
                );
                debugLog('Created fieldset', created);
              } catch (error) {
                console.error('Failed to create fieldset', data, error);
              }
            },
            fieldset,
          ),
        () => tracker.checkCancel(),
      );

      const nonSlugFields = fields.filter(
        (field) => field.attributes.field_type !== 'slug',
      );

      await pMap(
        nonSlugFields,
        6,
        (field) =>
          tracker.run(
            (f: SchemaTypes.Field) =>
              `Creating field ${f.attributes.label || f.attributes.api_key} in ${entity.attributes.name}`,
            (f: SchemaTypes.Field) =>
              importField(f, {
                client,
                locales,
                mappings,
              }),
            field,
          ),
        () => tracker.checkCancel(),
      );

      const slugFields = fields.filter(
        (field) => field.attributes.field_type === 'slug',
      );

      await pMap(
        slugFields,
        4,
        (field) =>
          tracker.run(
            (f: SchemaTypes.Field) =>
              `Creating field ${f.attributes.label || f.attributes.api_key} in ${entity.attributes.name}`,
            (f: SchemaTypes.Field) =>
              importField(f, {
                client,
                locales,
                mappings,
              }),
            field,
          ),
        () => tracker.checkCancel(),
      );
    },
    () => tracker.checkCancel(),
  );
}

/**
 * Apply relationship and ordering metadata that requires created field IDs.
 */
async function finalizeItemTypesPhase(
  context: ImportContext,
  createdItemTypes: Array<SchemaTypes.ItemType | undefined>,
) {
  const {
    client,
    tracker,
    importDoc: {
      itemTypes: { entitiesToCreate: itemTypesToCreate },
    },
    mappings,
  } = context;

  const relationshipsToUpdate = [
    'ordering_field',
    'title_field',
    'image_preview_field',
    'excerpt_field',
    'presentation_title_field',
    'presentation_image_field',
  ] as const;
  const attributesToUpdate = ['ordering_direction', 'ordering_meta'];

  await pMap(
    itemTypesToCreate,
    3,
    (toCreate) =>
      tracker.run(
        (t: ImportDoc['itemTypes']['entitiesToCreate'][number]) =>
          `Finalizing ${t.entity.attributes.modular_block ? 'block' : 'model'}: ${
            t.rename?.name || t.entity.attributes.name
          }`,
        async (t: ImportDoc['itemTypes']['entitiesToCreate'][number]) => {
          const id = getOrThrow(
            mappings.itemTypeIds,
            t.entity.id,
            'finalize item type',
          );
          const createdItemType = find(createdItemTypes, { id });
          if (!createdItemType) {
            throw new Error(`Item type not found after creation: ${id}`);
          }

          const data: SchemaTypes.ItemTypeUpdateSchema['data'] = {
            type: 'item_type',
            id,
            attributes: pick(t.entity.attributes, attributesToUpdate),
            relationships: relationshipsToUpdate.reduce(
              (acc, relationshipName) => {
                const handle = get(
                  t.entity,
                  `relationships.${relationshipName}.data`,
                );

                return {
                  ...acc,
                  [relationshipName]: {
                    data: handle
                      ? {
                          type: 'field',
                          id: getOrThrow(
                            mappings.fieldIds,
                            handle.id,
                            'finalize relationships',
                          ),
                        }
                      : null,
                  },
                };
              },
              {} as NonNullable<
                SchemaTypes.ItemTypeUpdateSchema['data']['relationships']
              >,
            ),
          };

          try {
            debugLog('Finalize diff snapshot', {
              relationships: data.relationships,
              currentAttributes: pick(
                createdItemType.attributes,
                attributesToUpdate,
              ),
              currentRelationships: pick(
                createdItemType.relationships,
                relationshipsToUpdate,
              ),
            });
            if (
              !isEqual(
                data.relationships,
                pick(createdItemType.relationships, relationshipsToUpdate),
              ) ||
              !isEqual(
                data.attributes,
                pick(createdItemType.attributes, attributesToUpdate),
              )
            ) {
              debugLog('Finalizing item type', data);
              const { data: updatedItemType } = await client.itemTypes.rawUpdate(
                id,
                { data },
              );
              debugLog('Finalized item type', updatedItemType);
            }
          } catch (error) {
            console.error('Failed to finalize item type', data, error);
          }
        },
        toCreate,
      ),
    () => tracker.checkCancel(),
  );
}

/**
 * Restore the original ordering for fieldsets and fields to match the export.
 */
async function reorderEntitiesPhase(context: ImportContext) {
  const {
    client,
    tracker,
    importDoc: {
      itemTypes: { entitiesToCreate: itemTypesToCreate },
    },
    mappings,
  } = context;

  await pMap(
    itemTypesToCreate,
    3,
    (obj) =>
      tracker.run(
        (o: ImportDoc['itemTypes']['entitiesToCreate'][number]) => {
          const { entity } = o;
          return `Reordering fields/fieldsets for ${entity.attributes.name}`;
        },
        async (o: ImportDoc['itemTypes']['entitiesToCreate'][number]) => {
          const { entity: itemType, fields, fieldsets } = o;
          const allEntities = [...fieldsets, ...fields];

          if (allEntities.length <= 1) {
            return;
          }

          try {
            debugLog('Reordering fields/fieldsets for item type', {
              itemTypeId: getOrThrow(
                mappings.itemTypeIds,
                itemType.id,
                'reorder start log',
              ),
            });
            for (const entity of sortBy(allEntities, [
              'attributes',
              'position',
            ])) {
              tracker.checkCancel();
              if (entity.type === 'fieldset') {
                await client.fieldsets.update(
                  getOrThrow(
                    mappings.fieldsetIds,
                    entity.id,
                    'fieldset reorder',
                  ),
                  {
                    position: entity.attributes.position,
                  },
                );
              } else {
                await client.fields.update(
                  getOrThrow(mappings.fieldIds, entity.id, 'field reorder'),
                  {
                    position: entity.attributes.position,
                  },
                );
              }
            }
            debugLog('Reordered fields/fieldsets for item type', {
              itemTypeId: getOrThrow(
                mappings.itemTypeIds,
                itemType.id,
                'reorder log',
              ),
            });
          } catch (error) {
            console.error('Failed to reorder fields/fieldsets', error);
          }
        },
        obj,
      ),
    () => tracker.checkCancel(),
  );
}

export default async function importSchema(
  importDoc: ImportDoc,
  client: Client,
  updateProgress: ProgressUpdate,
  opts?: { shouldCancel?: ShouldCancel },
): Promise<ImportResult> {
  const shouldCancel = opts?.shouldCancel ?? (() => false);

  const pluginCreates = importDoc.plugins.entitiesToCreate.length;
  const itemTypeCreates = importDoc.itemTypes.entitiesToCreate.length;
  const fieldsetCreates = importDoc.itemTypes.entitiesToCreate.reduce(
    (acc, it) => acc + it.fieldsets.length,
    0,
  );
  const fieldCreates = importDoc.itemTypes.entitiesToCreate.reduce(
    (acc, it) => acc + it.fields.length,
    0,
  );
  const finalizeUpdates = itemTypeCreates;
  const reorderBatches = itemTypeCreates;

  const total =
    pluginCreates +
    itemTypeCreates +
    fieldsetCreates +
    fieldCreates +
    finalizeUpdates +
    reorderBatches;

  const tracker = new ProgressTracker(total, updateProgress, shouldCancel);

  tracker.checkCancel();
  const { locales } = await client.site.find();
  tracker.checkCancel();

  const mappings = prepareMappings(importDoc);
  const context: ImportContext = {
    client,
    tracker,
    locales,
    importDoc,
    mappings,
  };

  await createPluginsPhase(context);
  const createdItemTypes = await createItemTypesPhase(context);
  await createFieldsetsAndFieldsPhase(context);
  await finalizeItemTypesPhase(context, createdItemTypes);
  await reorderEntitiesPhase(context);

  return {
    itemTypeIdByExportId: Object.fromEntries(mappings.itemTypeIds),
    fieldIdByExportId: Object.fromEntries(mappings.fieldIds),
    fieldsetIdByExportId: Object.fromEntries(mappings.fieldsetIds),
    pluginIdByExportId: Object.fromEntries(mappings.pluginIds),
  };
}

type ImportFieldOptions = {
  client: Client;
  locales: string[];
  mappings: ImportMappings;
};

/**
 * Create a single field in the target project, translating validators and appearance.
 */
async function importField(
  field: SchemaTypes.Field,
  { client, locales, mappings }: ImportFieldOptions,
) {
  const data: SchemaTypes.FieldCreateSchema['data'] = {
    ...field,
    id: mappings.fieldIds.get(field.id),
    relationships: {
      fieldset: {
        data: field.relationships.fieldset.data
          ? {
              type: 'fieldset',
              id: getOrThrow(
                mappings.fieldsetIds,
                field.relationships.fieldset.data.id,
                'field appearance fieldset mapping',
              ),
            }
          : null,
      },
    },
  };

  const validators = [
    ...validatorsContainingLinks.filter(
      (item) => item.field_type === field.attributes.field_type,
    ),
    ...validatorsContainingBlocks.filter(
      (item) => item.field_type === field.attributes.field_type,
    ),
  ].map((item) => item.validator);

  for (const validator of validators) {
    const fieldLinkedItemTypeIds = get(
      field.attributes.validators,
      validator,
    ) as string[];

    const newIds: string[] = [];

    for (const fieldLinkedItemTypeId of fieldLinkedItemTypeIds ?? []) {
      const mapped = mappings.itemTypeIds.get(fieldLinkedItemTypeId);
      if (mapped) newIds.push(mapped);
    }

    const validatorsContainer = (data.attributes.validators ?? {}) as Record<
      string,
      unknown
    >;
    set(validatorsContainer, validator, newIds);
    data.attributes.validators =
      validatorsContainer as typeof data.attributes.validators;
  }

  const slugTitleFieldValidator = field.attributes.validators
    .slug_title_field as undefined | { title_field_id: string };

  if (slugTitleFieldValidator) {
    const mapped = getOrThrow(
      mappings.fieldIds,
      slugTitleFieldValidator.title_field_id,
      'slug title field',
    );
    (data.attributes.validators as Record<string, unknown>).slug_title_field = {
      title_field_id: mapped,
    };
  }

  (data.attributes as { appearance?: unknown }).appearance = undefined;
  (data.attributes as { appeareance?: unknown }).appeareance = undefined;
  const nextAppearance = await mapAppearanceToProject(
    field,
    mappings.pluginIds,
  );

  if (field.attributes.localized) {
    const oldDefaultValues = field.attributes.default_value as Record<
      string,
      unknown
    >;
    data.attributes.default_value = Object.fromEntries(
      locales.map((locale) => [locale, oldDefaultValues?.[locale] ?? null]),
    );
  }

  data.attributes.appearance = nextAppearance;

  try {
    debugLog('Creating field', data);
    const itemTypeProjectId = getOrThrow(
      mappings.itemTypeIds,
      field.relationships.item_type.data.id,
      'field create',
    );
    const { data: createdField } = await client.fields.rawCreate(
      itemTypeProjectId,
      {
        data,
      },
    );
    debugLog('Created field', createdField);
  } catch (error) {
    console.error('Failed to create field', data, error);
  }
}
