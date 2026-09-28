import {
  type ApiTypes,
  blockModelIdsReferencedInField,
  type Client,
} from '@datocms/cma-client-browser';
import type { DiscoveryModel } from './query';
import type {
  ApiKeyCatalogEntry,
  ApiKeyCatalogLocation,
  SchemaField,
  SchemaIndex,
  SchemaModel,
} from './types';

type FieldsByItemTypeId =
  | ReadonlyMap<string, ReadonlyArray<ApiTypes.Field>>
  | Readonly<Record<string, ReadonlyArray<ApiTypes.Field>>>;

export type BuildSchemaIndexInput = {
  itemTypes: ReadonlyArray<ApiTypes.ItemType>;
  fieldsByItemTypeId: FieldsByItemTypeId;
  /** Restricts discoverable root models without dropping their block schemas. */
  rootModelIds?: Iterable<string>;
};

export type LoadSchemaIndexOptions = {
  rootModelIds?: Iterable<string>;
};

export function isExactMatchCompatibleFieldType(
  fieldType: ApiTypes.Field['field_type'],
): boolean {
  return (
    fieldType === 'string' ||
    fieldType === 'text' ||
    fieldType === 'slug' ||
    fieldType === 'structured_text' ||
    fieldType === 'seo'
  );
}

function fieldsForModel(
  source: FieldsByItemTypeId,
  modelId: string,
): ReadonlyArray<ApiTypes.Field> {
  if (
    typeof (source as ReadonlyMap<string, ReadonlyArray<ApiTypes.Field>>)
      .get === 'function'
  ) {
    return (
      (source as ReadonlyMap<string, ReadonlyArray<ApiTypes.Field>>).get(
        modelId,
      ) ?? []
    );
  }

  return (
    (source as Readonly<Record<string, ReadonlyArray<ApiTypes.Field>>>)[
      modelId
    ] ?? []
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function validatorItemTypeIds(
  validators: Record<string, unknown>,
  validatorName: string,
): string[] {
  const validator = asRecord(validators[validatorName]);
  return stringArray(validator?.item_types);
}

function fallbackReferencedBlockModelIds(field: ApiTypes.Field): string[] {
  const validators = field.validators as Record<string, unknown>;

  switch (field.field_type) {
    case 'rich_text':
      return validatorItemTypeIds(validators, 'rich_text_blocks');
    case 'single_block':
      return validatorItemTypeIds(validators, 'single_block_blocks');
    case 'structured_text':
      return [
        ...validatorItemTypeIds(validators, 'structured_text_blocks'),
        ...validatorItemTypeIds(validators, 'structured_text_inline_blocks'),
      ];
    default:
      return [];
  }
}

function referencedBlockModelIds(field: ApiTypes.Field): string[] {
  try {
    return [...new Set(blockModelIdsReferencedInField(field))];
  } catch {
    // Partial schema fixtures and old projects can omit optional validators.
    return [...new Set(fallbackReferencedBlockModelIds(field))];
  }
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/** Every model reachable from `modelId` through block references (excluding itself unless cyclic). */
function reachableModelIds(
  modelId: string,
  forward: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const visited = new Set<string>();
  const pending = [...(forward.get(modelId) ?? [])];

  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);

    for (const nested of forward.get(candidate) ?? []) {
      if (!visited.has(nested)) pending.push(nested);
    }
  }

  return visited;
}

function buildReachability(
  rootModelIds: ReadonlyArray<string>,
  forward: ReadonlyMap<string, ReadonlySet<string>>,
  blockModelIdSet: ReadonlySet<string>,
): Map<string, ReadonlySet<string>> {
  const mutable = new Map<string, Set<string>>();

  for (const rootModelId of rootModelIds) {
    for (const candidate of reachableModelIds(rootModelId, forward)) {
      if (!blockModelIdSet.has(candidate)) continue;
      const roots = mutable.get(candidate) ?? new Set<string>();
      roots.add(rootModelId);
      mutable.set(candidate, roots);
    }
  }

  return new Map(
    [...mutable.entries()].map(([blockModelId, roots]) => [
      blockModelId,
      new Set(sortedUnique(roots)),
    ]),
  );
}

function buildApiKeyCatalog(
  modelsById: ReadonlyMap<string, SchemaModel>,
  fieldsByModelId: ReadonlyMap<string, ReadonlyArray<SchemaField>>,
  allowedRootModelIds: ReadonlySet<string>,
  reachableRoots: ReadonlyMap<string, ReadonlySet<string>>,
): ApiKeyCatalogEntry[] {
  const locationsByApiKey = new Map<string, ApiKeyCatalogLocation[]>();

  for (const [modelId, fields] of fieldsByModelId) {
    const model = modelsById.get(modelId);
    if (!model) continue;

    const modelReachableRoots = model.isBlockModel
      ? [...(reachableRoots.get(model.id) ?? [])]
      : allowedRootModelIds.has(model.id)
        ? [model.id]
        : [];

    if (modelReachableRoots.length === 0) continue;

    for (const field of fields) {
      const locations = locationsByApiKey.get(field.apiKey) ?? [];
      locations.push({
        fieldId: field.id,
        fieldLabel: field.label,
        modelId: model.id,
        modelName: model.name,
        isBlockModel: model.isBlockModel,
        fieldType: field.fieldType,
        localized: field.localized,
        exactMatchCompatible: field.exactMatchCompatible,
        reachableRootModelIds: sortedUnique(modelReachableRoots),
      });
      locationsByApiKey.set(field.apiKey, locations);
    }
  }

  return [...locationsByApiKey.entries()]
    .map(([apiKey, unsortedLocations]): ApiKeyCatalogEntry => {
      const locations = [...unsortedLocations].sort(
        (left, right) =>
          left.modelName.localeCompare(right.modelName) ||
          left.fieldId.localeCompare(right.fieldId),
      );
      const rootModelIds = sortedUnique(
        locations
          .filter((location) => !location.isBlockModel)
          .map((location) => location.modelId),
      );
      const blockModelIds = sortedUnique(
        locations
          .filter((location) => location.isBlockModel)
          .map((location) => location.modelId),
      );
      const reachableRootModelIds = sortedUnique(
        locations.flatMap((location) => location.reachableRootModelIds),
      );
      const fieldTypes = [
        ...new Set(locations.map((location) => location.fieldType)),
      ].sort((left, right) => left.localeCompare(right));
      const localizedValues = new Set(
        locations.map((location) => location.localized),
      );
      const fieldLabels = sortedUnique(
        locations.map((location) => location.fieldLabel),
      );
      const incompatibleLocationCount = locations.filter(
        (location) => !location.exactMatchCompatible,
      ).length;

      return {
        apiKey,
        label: fieldLabels.join(' / ') || apiKey,
        locations,
        rootModelIds,
        blockModelIds,
        reachableRootModelIds,
        fieldTypes,
        localized:
          localizedValues.size === 1
            ? (localizedValues.values().next().value ?? false)
            : 'mixed',
        modelCount: reachableRootModelIds.length,
        blockModelCount: blockModelIds.length,
        exactMatchCompatible: locations.some(
          (location) => location.exactMatchCompatible,
        ),
        incompatibleLocationCount,
      };
    })
    .sort((left, right) => left.apiKey.localeCompare(right.apiKey));
}

export function buildSchemaIndex({
  itemTypes,
  fieldsByItemTypeId,
  rootModelIds: requestedRootModelIds,
}: BuildSchemaIndexInput): SchemaIndex {
  const models = itemTypes
    .map(
      (itemType): SchemaModel => ({
        id: itemType.id,
        name: itemType.name,
        apiKey: itemType.api_key,
        isBlockModel: itemType.modular_block,
        raw: itemType,
      }),
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
  const modelsById = new Map(models.map((model) => [model.id, model]));
  const availableRootModelIds = models
    .filter((model) => !model.isBlockModel)
    .map((model) => model.id);
  const requestedRootModelIdSet = requestedRootModelIds
    ? new Set(requestedRootModelIds)
    : null;
  const rootModelIds = availableRootModelIds.filter(
    (modelId) =>
      !requestedRootModelIdSet || requestedRootModelIdSet.has(modelId),
  );
  const allowedRootModelIdSet = new Set(rootModelIds);
  const blockModelIds = models
    .filter((model) => model.isBlockModel)
    .map((model) => model.id);
  const blockModelIdSet = new Set(blockModelIds);

  const fieldsById = new Map<string, SchemaField>();
  const schemaFieldsByModelId = new Map<string, ReadonlyArray<SchemaField>>();
  const blockModelIdsByParentModelId = new Map<string, ReadonlySet<string>>();

  for (const model of models) {
    const fields = fieldsForModel(fieldsByItemTypeId, model.id)
      .map(
        (field): SchemaField => ({
          id: field.id,
          label: field.label,
          apiKey: field.api_key,
          fieldType: field.field_type,
          localized: field.localized,
          position: field.position,
          modelId: model.id,
          referencedBlockModelIds: referencedBlockModelIds(field),
          exactMatchCompatible: isExactMatchCompatibleFieldType(
            field.field_type,
          ),
          raw: field,
        }),
      )
      .sort(
        (left, right) =>
          left.position - right.position ||
          left.label.localeCompare(right.label),
      );

    schemaFieldsByModelId.set(model.id, fields);
    blockModelIdsByParentModelId.set(
      model.id,
      new Set(fields.flatMap((field) => field.referencedBlockModelIds)),
    );
    for (const field of fields) fieldsById.set(field.id, field);
  }

  const reachableRootModelIdsByBlockModelId = buildReachability(
    rootModelIds,
    blockModelIdsByParentModelId,
    blockModelIdSet,
  );
  const apiKeyCatalog = buildApiKeyCatalog(
    modelsById,
    schemaFieldsByModelId,
    allowedRootModelIdSet,
    reachableRootModelIdsByBlockModelId,
  );

  return {
    modelsById,
    fieldsById,
    fieldsByModelId: schemaFieldsByModelId,
    rootModelIds,
    blockModelIds,
    blockModelIdsByParentModelId,
    reachableRootModelIdsByBlockModelId,
    apiKeyCatalog,
    apiKeyCatalogByKey: new Map(
      apiKeyCatalog.map((entry) => [entry.apiKey, entry]),
    ),
  };
}

/**
 * Whether a search must read the model's records with `nested` (30 per
 * request) to see the text inside their blocks: the model has a Modular
 * Content or Single Block field, or a Structured Text field that allows
 * blocks or inline blocks. Otherwise a plain read holds every value.
 */
export function modelNeedsNestedReads(
  schema: SchemaIndex,
  modelId: string,
): boolean {
  return (schema.fieldsByModelId.get(modelId) ?? []).some(
    (field) =>
      field.fieldType === 'rich_text' ||
      field.fieldType === 'single_block' ||
      (field.fieldType === 'structured_text' &&
        field.referencedBlockModelIds.length > 0),
  );
}

/** The root models of the schema, as a search reads them, in schema order. */
export function discoveryModelsOf(schema: SchemaIndex): DiscoveryModel[] {
  return schema.rootModelIds.flatMap((modelId) => {
    const model = schema.modelsById.get(modelId);
    return model
      ? [
          {
            id: model.id,
            name: model.name,
            apiKey: model.apiKey,
            nested: modelNeedsNestedReads(schema, model.id),
          },
        ]
      : [];
  });
}

export async function loadSchemaIndex(
  client: Client,
  options: LoadSchemaIndexOptions = {},
): Promise<SchemaIndex> {
  const itemTypes = await client.itemTypes.list();
  const fieldsByItemTypeId = new Map<string, ApiTypes.Field[]>();

  await Promise.all(
    itemTypes.map(async (itemType) => {
      fieldsByItemTypeId.set(
        itemType.id,
        await client.fields.list(itemType.id),
      );
    }),
  );

  return buildSchemaIndex({
    itemTypes,
    fieldsByItemTypeId,
    rootModelIds: options.rootModelIds,
  });
}
