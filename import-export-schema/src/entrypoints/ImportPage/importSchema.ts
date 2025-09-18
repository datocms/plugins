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

/**
 * Applies an import document to the target project while reporting granular progress.
 */
export default async function importSchema(
  importDoc: ImportDoc,
  client: Client,
  updateProgress: (progress: ImportProgress) => void,
  opts?: { shouldCancel?: () => boolean },
): Promise<ImportResult> {
  // const [client, unsubscribe] = await withEventsSubscription(rawClient);

  // Precompute a fixed total so goal never grows
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
  const finalizeUpdates = itemTypeCreates; // one finalize step per created item type
  const reorderBatches = itemTypeCreates; // one reorder batch per created item type

  const total =
    pluginCreates +
    itemTypeCreates +
    fieldsetCreates +
    fieldCreates +
    finalizeUpdates +
    reorderBatches;

  let finished = 0;
  updateProgress({ total, finished });

  const shouldCancel = opts?.shouldCancel ?? (() => false);

  function checkCancel() {
    if (shouldCancel()) {
      throw new Error('Import cancelled');
    }
  }

  // debug helper is module-scoped to be available in helpers below

  // Wrap API calls so each step updates the overlay and respects cancellation.
  function trackWithLabel<TArgs extends unknown[], TResult>(
    labelForArgs: (...args: TArgs) => string,
    promiseGeneratorFn: (...args: TArgs) => Promise<TResult>,
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs) => {
      let label: string | undefined;
      try {
        checkCancel();
        label = labelForArgs(...args);
        updateProgress({ total, finished, label });
        const result = await promiseGeneratorFn(...args);
        checkCancel();
        return result;
      } finally {
        finished += 1;
        // Keep last known label for continuity
        updateProgress({ total, finished, label });
      }
    };
  }

  /**
   * Concurrency-limited mapper that preserves order and stops scheduling new work after
   * cancellation while letting in-flight jobs finish.
   */
  async function pMap<T, R>(
    items: readonly T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;
    let cancelledError: unknown | null = null;

    async function worker() {
      while (true) {
        if (cancelledError) return;
        const current = nextIndex;
        if (current >= items.length) return;
        // Reserve index slot
        nextIndex += 1;
        try {
          checkCancel();
          const res = await mapper(items[current], current);
          results[current] = res;
        } catch (e) {
          // Stop scheduling more work; remember error to throw later
          cancelledError = e;
          return;
        }
      }
    }

    const workers = Array.from(
      { length: Math.max(1, Math.min(limit, items.length)) },
      worker,
    );
    await Promise.all(workers);
    if (cancelledError) throw cancelledError;
    return results;
  }

  checkCancel();
  const { locales } = await client.site.find();
  checkCancel();

  const itemTypeIdMappings: Map<string, string> = new Map();
  const fieldIdMappings: Map<string, string> = new Map();
  const fieldsetIdMappings: Map<string, string> = new Map();
  const pluginIdMappings: Map<string, string> = new Map();

  // Pre-assign project IDs so relationships can reference them during creation.
  for (const toCreate of importDoc.itemTypes.entitiesToCreate) {
    itemTypeIdMappings.set(toCreate.entity.id, generateId());

    for (const field of toCreate.fields) {
      fieldIdMappings.set(field.id, generateId());
    }

    for (const fieldset of toCreate.fieldsets) {
      fieldsetIdMappings.set(fieldset.id, generateId());
    }
  }

  for (const [exportId, projectId] of Object.entries(
    importDoc.itemTypes.idsToReuse,
  )) {
    itemTypeIdMappings.set(exportId, projectId);
  }

  for (const toCreate of importDoc.plugins.entitiesToCreate) {
    pluginIdMappings.set(toCreate.id, generateId());
  }

  for (const [exportId, projectId] of Object.entries(
    importDoc.plugins.idsToReuse,
  )) {
    pluginIdMappings.set(exportId, projectId);
  }

  // Create new plugins (parallel with limited concurrency)
  checkCancel();
  await pMap(importDoc.plugins.entitiesToCreate, 4, async (plugin) =>
    trackWithLabel(
      (p: SchemaTypes.Plugin) =>
        `Creating plugin: ${
          p.attributes.name || p.attributes.package_name || p.id
        }`,
      async (p: SchemaTypes.Plugin) => {
        const data: SchemaTypes.PluginCreateSchema['data'] = {
          type: 'plugin',
          id: pluginIdMappings.get(p.id),
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
            } catch (_e) {
              // ignore invalid legacy parameters
            }
          }
          debugLog('Created plugin', created);
        } catch (e) {
          console.error('Failed to create plugin', data, e);
        }
      },
    )(plugin),
  );

  // Create new item types (parallel with limited concurrency)
  checkCancel();
  const createdItemTypes: Array<SchemaTypes.ItemType | undefined> = await pMap(
    importDoc.itemTypes.entitiesToCreate,
    3,
    async (toCreate) =>
      trackWithLabel(
        (t: ImportDoc['itemTypes']['entitiesToCreate'][number]) =>
          `Creating ${t.entity.attributes.modular_block ? 'block' : 'model'}: ${
            t.rename?.name || t.entity.attributes.name
          }`,
        async (t: ImportDoc['itemTypes']['entitiesToCreate'][number]) => {
          const data: SchemaTypes.ItemTypeCreateSchema['data'] = {
            type: 'item_type',
            id: itemTypeIdMappings.get(t.entity.id),
            attributes: omit(t.entity.attributes, [
              'has_singleton_item',
              'ordering_direction',
              'ordering_meta',
            ]),
          };

          try {
            if (t.rename) {
              data.attributes.name = t.rename.name;
              data.attributes.api_key = t.rename.apiKey;
            }
            debugLog('Creating item type', data);
            const { data: itemType } = await client.itemTypes.rawCreate({
              data,
            });
            debugLog('Created item type', itemType);
            return itemType;
          } catch (e) {
            console.error('Failed to create item type', data, e);
          }
        },
      )(toCreate),
  );

  // Create fieldsets and fields (parallelized per stage, limited per item type)
  checkCancel();
  await pMap(
    importDoc.itemTypes.entitiesToCreate,
    2,
    async ({
      entity: { id: itemTypeId, attributes: itemTypeAttrs },
      fields,
      fieldsets,
    }) => {
      // Fieldsets first (required by fields referencing them)
      await pMap(fieldsets, 4, async (fieldset) =>
        trackWithLabel(
          (_fs: SchemaTypes.Fieldset) =>
            `Creating fieldset in ${itemTypeAttrs.name}`,
          async (fs: SchemaTypes.Fieldset) => {
            const data: SchemaTypes.FieldsetCreateSchema['data'] = {
              ...omit(fs, ['relationships']),
              id: fieldsetIdMappings.get(fs.id),
            };

            try {
              debugLog('Creating fieldset', data);
              const itemTypeProjectId = getOrThrow(
                itemTypeIdMappings,
                itemTypeId,
                'fieldset create',
              );
              const { data: created } = await client.fieldsets.rawCreate(
                itemTypeProjectId,
                { data },
              );
              debugLog('Created fieldset', created);
            } catch (e) {
              console.error('Failed to create fieldset', data, e);
            }
          },
        )(fieldset),
      );

      const nonSlugFields = fields.filter(
        (field) => field.attributes.field_type !== 'slug',
      );

      await pMap(nonSlugFields, 6, async (field) =>
        trackWithLabel(
          (f: SchemaTypes.Field) =>
            `Creating field ${f.attributes.label || f.attributes.api_key} in ${itemTypeAttrs.name}`,
          (f: SchemaTypes.Field) =>
            importField(f, {
              client,
              locales,
              fieldIdMappings,
              pluginIdMappings,
              fieldsetIdMappings,
              itemTypeIdMappings,
            }),
        )(field),
      );

      const slugFields = fields.filter(
        (field) => field.attributes.field_type === 'slug',
      );

      await pMap(slugFields, 4, async (field) =>
        trackWithLabel(
          (f: SchemaTypes.Field) =>
            `Creating field ${f.attributes.label || f.attributes.api_key} in ${itemTypeAttrs.name}`,
          (f: SchemaTypes.Field) =>
            importField(f, {
              client,
              locales,
              fieldIdMappings,
              pluginIdMappings,
              fieldsetIdMappings,
              itemTypeIdMappings,
            }),
        )(field),
      );
    },
  );

  // Finalize new item types

  const relationshipsToUpdate = [
    'ordering_field',
    'title_field',
    'image_preview_field',
    'excerpt_field',
    'presentation_title_field',
    'presentation_image_field',
  ] as const;

  const attributesToUpdate = ['ordering_direction', 'ordering_meta'];

  checkCancel();
  await pMap(importDoc.itemTypes.entitiesToCreate, 3, async (toCreate) =>
    trackWithLabel(
      (t: ImportDoc['itemTypes']['entitiesToCreate'][number]) =>
        `Finalizing ${t.entity.attributes.modular_block ? 'block' : 'model'}: ${t.rename?.name || t.entity.attributes.name}`,
      async (t: ImportDoc['itemTypes']['entitiesToCreate'][number]) => {
        const id = getOrThrow(
          itemTypeIdMappings,
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
                          fieldIdMappings,
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
        } catch (e) {
          console.error('Failed to finalize item type', data, e);
        }
      },
    )(toCreate),
  );

  // Reorder fields and fieldsets
  checkCancel();
  await pMap(importDoc.itemTypes.entitiesToCreate, 3, async (obj) =>
    trackWithLabel(
      (o: ImportDoc['itemTypes']['entitiesToCreate'][number]) => {
        const { entity: itemType } = o;
        return `Reordering fields/fieldsets for ${itemType.attributes.name}`;
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
              itemTypeIdMappings,
              itemType.id,
              'reorder start log',
            ),
          });
          for (const entity of sortBy(allEntities, [
            'attributes',
            'position',
          ])) {
            checkCancel();
            if (entity.type === 'fieldset') {
              await client.fieldsets.update(
                getOrThrow(fieldsetIdMappings, entity.id, 'fieldset reorder'),
                {
                  position: entity.attributes.position,
                },
              );
            } else {
              await client.fields.update(
                getOrThrow(fieldIdMappings, entity.id, 'field reorder'),
                {
                  position: entity.attributes.position,
                },
              );
            }
          }
          debugLog('Reordered fields/fieldsets for item type', {
            itemTypeId: getOrThrow(
              itemTypeIdMappings,
              itemType.id,
              'reorder log',
            ),
          });
        } catch (e) {
          console.error('Failed to reorder fields/fieldsets', e);
        }
      },
    )(obj),
  );

  // unsubscribe();
  return {
    itemTypeIdByExportId: Object.fromEntries(itemTypeIdMappings),
    fieldIdByExportId: Object.fromEntries(fieldIdMappings),
    fieldsetIdByExportId: Object.fromEntries(fieldsetIdMappings),
    pluginIdByExportId: Object.fromEntries(pluginIdMappings),
  };
}

type ImportFieldOptions = {
  client: Client;
  locales: string[];
  fieldIdMappings: Map<string, string>;
  fieldsetIdMappings: Map<string, string>;
  itemTypeIdMappings: Map<string, string>;
  pluginIdMappings: Map<string, string>;
};

async function importField(
  field: SchemaTypes.Field,
  {
    client,
    locales,
    fieldIdMappings,
    fieldsetIdMappings,
    itemTypeIdMappings,
    pluginIdMappings,
  }: ImportFieldOptions,
) {
  const data: SchemaTypes.FieldCreateSchema['data'] = {
    ...field,
    id: fieldIdMappings.get(field.id),
    relationships: {
      fieldset: {
        data: field.relationships.fieldset.data
          ? {
              type: 'fieldset',
              id: getOrThrow(
                fieldsetIdMappings,
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

    const newIds: string[] = [];

    for (const fieldLinkedItemTypeId of fieldLinkedItemTypeIds) {
      const maybe = itemTypeIdMappings.get(fieldLinkedItemTypeId);
      if (maybe) newIds.push(maybe);
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
      fieldIdMappings,
      slugTitleFieldValidator.title_field_id,
      'slug title field',
    );
    (data.attributes.validators as Record<string, unknown>).slug_title_field = {
      title_field_id: mapped,
    };
  }

  // Clear appearance to reconstruct a valid target-project configuration below
  // (fixes typo 'appeareance' that prevented reset)
  // Avoid delete operator; set to undefined to omit when serialized
  (data.attributes as { appearance?: unknown }).appearance = undefined;
  // Also clear legacy misspelled property if present
  (data.attributes as { appeareance?: unknown }).appeareance = undefined;
  // Build a safe appearance configuration regardless of source shape
  const nextAppearance = await mapAppearanceToProject(field, pluginIdMappings);

  if (field.attributes.localized) {
    const oldDefaultValues = field.attributes.default_value as Record<
      string,
      unknown
    >;
    data.attributes.default_value = Object.fromEntries(
      locales.map((locale) => [locale, oldDefaultValues[locale] || null]),
    );
  }

  // mapAppearanceToProject already remaps editor/addons and ensures parameters

  data.attributes.appearance = nextAppearance;

  try {
    debugLog('Creating field', data);
    const itemTypeProjectId = getOrThrow(
      itemTypeIdMappings,
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
  } catch (e) {
    console.error('Failed to create field', data, e);
  }
}
