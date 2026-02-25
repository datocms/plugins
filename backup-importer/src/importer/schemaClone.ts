import type { Client } from '@datocms/cma-client-browser';
import { createDebugLogger, type DebugLogger } from './debugLogger';
import type {
  FieldApiKeyMapByItemType,
  FieldMappingReport,
  FieldsetMappingReport,
  ImportExecutionPhase,
  ItemTypeMappingReport,
  JsonObject,
  RecordExportEnvelope,
  SchemaMappingReport,
} from './types';
import {
  asArray,
  asBoolean,
  asString,
  cloneJson,
  compactObject,
  deepRemapKnownIds,
  extractEntityId,
  isObject,
  makeCompositeKey,
} from './resourceUtils';

type SchemaImportProgress = {
  phase: ImportExecutionPhase;
  finished: number;
  total: number;
  message: string;
};

function createEmptyItemTypeReport(): ItemTypeMappingReport {
  return {
    itemTypeIdMap: new Map<string, string>(),
    missing: [],
    warnings: [],
  };
}

function createEmptyFieldsetReport(): FieldsetMappingReport {
  return {
    fieldsetIdMap: new Map<string, string>(),
    missing: [],
    warnings: [],
  };
}

function createEmptyFieldReport(): FieldMappingReport {
  return {
    fieldApiKeyMapByItemType: new Map(),
    fieldIdMap: new Map(),
    missing: [],
    warnings: [],
  };
}

function sourceProjectConfiguration(envelope: RecordExportEnvelope) {
  return (
    envelope.projectConfiguration ?? {
      site: null,
      scheduledPublications: [],
      scheduledUnpublishings: [],
      fieldsets: [],
      menuItems: [],
      schemaMenuItems: [],
      modelFilters: [],
      plugins: [],
      workflows: [],
      roles: [],
      webhooks: [],
      buildTriggers: [],
      warnings: [],
    }
  );
}

function mapRelationship(args: {
  sourceValue: unknown;
  idMap: Map<string, string>;
  relationshipType: string;
}): JsonObject | null | undefined {
  if (args.sourceValue === null) {
    return null;
  }

  const sourceId = extractEntityId(args.sourceValue);
  if (!sourceId) {
    return undefined;
  }

  const targetId = args.idMap.get(sourceId);
  if (!targetId) {
    return undefined;
  }

  return {
    type: args.relationshipType,
    id: targetId,
  };
}

function isDefaultValueLocalesMismatchError(error: unknown): boolean {
  const marker = 'FIELD_DEFAULT_VALUE_LOCALES_MISMATCH_ENVIRONMENT_LOCALES';

  if (error instanceof Error && error.message.includes(marker)) {
    return true;
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeErrors = (error as { errors?: unknown[] }).errors;
  if (!Array.isArray(maybeErrors)) {
    return false;
  }

  return maybeErrors.some((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const attributes = (entry as { attributes?: unknown }).attributes;
    if (!attributes || typeof attributes !== 'object') {
      return false;
    }

    const details = (attributes as { details?: unknown }).details;
    if (!details || typeof details !== 'object') {
      return false;
    }

    return (
      (details as { code?: unknown }).code === marker ||
      (details as { field?: unknown }).field === 'default_value'
    );
  });
}

type ApiErrorDetail = {
  field: string | null;
  code: string | null;
};

function extractApiErrorDetails(error: unknown): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];

  if (error && typeof error === 'object') {
    const maybeErrors = (error as { errors?: unknown[] }).errors;
    if (Array.isArray(maybeErrors)) {
      maybeErrors.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }

        const attributes = (entry as { attributes?: unknown }).attributes;
        if (!attributes || typeof attributes !== 'object') {
          return;
        }

        const attributesCode =
          typeof (attributes as { code?: unknown }).code === 'string'
            ? ((attributes as { code?: string }).code ?? null)
            : null;

        const entryDetails = (attributes as { details?: unknown }).details;
        if (!entryDetails || typeof entryDetails !== 'object') {
          details.push({
            field: null,
            code: attributesCode,
          });
          return;
        }

        details.push({
          field:
            typeof (entryDetails as { field?: unknown }).field === 'string'
              ? ((entryDetails as { field?: string }).field ?? null)
              : null,
          code:
            typeof (entryDetails as { code?: unknown }).code === 'string'
              ? ((entryDetails as { code?: string }).code ?? attributesCode ?? null)
              : attributesCode,
        });
      });
    }
  }

  if (details.length > 0) {
    return details;
  }

  if (!(error instanceof Error)) {
    return details;
  }

  const fieldMatches = Array.from(
    error.message.matchAll(/"field"\s*:\s*"([^"]+)"/g),
  ).map((match) => match[1]);
  const codeMatches = Array.from(
    error.message.matchAll(/"code"\s*:\s*"([^"]+)"/g),
  ).map((match) => match[1]);

  for (let index = 0; index < Math.max(fieldMatches.length, codeMatches.length); index += 1) {
    details.push({
      field: fieldMatches[index] ?? null,
      code: codeMatches[index] ?? null,
    });
  }

  return details;
}

function extractApiErrorMessages(error: unknown): string[] {
  const messages: string[] = [];

  if (error && typeof error === 'object') {
    const maybeErrors = (error as { errors?: unknown[] }).errors;
    if (Array.isArray(maybeErrors)) {
      maybeErrors.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }

        const attributes = (entry as { attributes?: unknown }).attributes;
        if (!attributes || typeof attributes !== 'object') {
          return;
        }

        const details = (attributes as { details?: unknown }).details;
        if (!details || typeof details !== 'object') {
          return;
        }

        const detailMessages = (details as { messages?: unknown }).messages;
        if (!Array.isArray(detailMessages)) {
          return;
        }

        detailMessages.forEach((message) => {
          if (typeof message === 'string' && message.length > 0) {
            messages.push(message);
          }
        });
      });
    }
  }

  if (messages.length > 0) {
    return messages;
  }

  if (error instanceof Error && error.message.length > 0) {
    return [error.message];
  }

  return [];
}

function isAppearanceAddonsInvalidError(error: unknown): boolean {
  const detailMatch = extractApiErrorDetails(error).some((detail) => {
    if (!detail.field) {
      return false;
    }

    if (
      !detail.field.startsWith('appearance.addons') &&
      !detail.field.startsWith('appeareance.addons')
    ) {
      return false;
    }

    return (
      detail.code === null ||
      detail.code === 'VALIDATION_INVALID' ||
      detail.code === 'INVALID_FORMAT'
    );
  });

  if (detailMatch) {
    return true;
  }

  return extractApiErrorMessages(error).some((message) => {
    const normalized = message.toLowerCase();
    return (
      (normalized.includes('appearance') || normalized.includes('appeareance')) &&
      normalized.includes('addons')
    );
  });
}

function isAppearanceInvalidError(error: unknown): boolean {
  const detailMatch = extractApiErrorDetails(error).some((detail) => {
    if (!detail.field) {
      return false;
    }

    if (
      !detail.field.startsWith('appearance') &&
      !detail.field.startsWith('appeareance')
    ) {
      return false;
    }

    return (
      detail.code === null ||
      detail.code === 'VALIDATION_INVALID' ||
      detail.code === 'INVALID_FORMAT'
    );
  });

  if (detailMatch) {
    return true;
  }

  return extractApiErrorMessages(error).some((message) => {
    const normalized = message.toLowerCase();
    return normalized.includes('appearance') || normalized.includes('appeareance');
  });
}

async function resolveTargetLocales(client: Client): Promise<Set<string> | null> {
  try {
    const site = await (client.site as { find?: () => Promise<unknown> }).find?.();
    if (!site || typeof site !== 'object') {
      return null;
    }

    const locales = (site as { locales?: unknown }).locales;
    if (!Array.isArray(locales)) {
      return null;
    }

    const normalized = locales.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    return normalized.length > 0 ? new Set(normalized) : null;
  } catch (_error) {
    return null;
  }
}

function sanitizeLocalizedDefaultValue(args: {
  sourceField: JsonObject;
  payload: JsonObject;
  targetLocales: Set<string> | null;
}): { droppedLocales: string[] } {
  const localized = Boolean(args.payload.localized ?? args.sourceField.localized);
  if (!localized || !args.targetLocales || args.targetLocales.size === 0) {
    return { droppedLocales: [] };
  }

  const defaultValue = args.payload.default_value;
  if (!isObject(defaultValue)) {
    return { droppedLocales: [] };
  }

  const filtered: JsonObject = {};
  const droppedLocales: string[] = [];

  Object.entries(defaultValue).forEach(([locale, value]) => {
    if (!args.targetLocales?.has(locale)) {
      droppedLocales.push(locale);
      return;
    }

    filtered[locale] = value;
  });

  if (droppedLocales.length === 0) {
    return { droppedLocales: [] };
  }

  if (Object.keys(filtered).length === 0) {
    delete args.payload.default_value;
  } else {
    args.payload.default_value = filtered;
  }

  return { droppedLocales };
}

function stripAppearanceAddonsFromPayload(payload: JsonObject): boolean {
  let changed = false;

  ['appearance', 'appeareance'].forEach((key) => {
    if (!(key in payload)) {
      return;
    }

    const appearance = payload[key];
    if (!isObject(appearance)) {
      return;
    }

    if ('addons' in appearance) {
      const addons = appearance.addons;
      if (!Array.isArray(addons) || addons.length > 0) {
        appearance.addons = [];
        changed = true;
      }
    }

    if (Object.keys(appearance).length === 0) {
      delete payload[key];
      changed = true;
    }
  });

  return changed;
}

function stripAppearancePayload(payload: JsonObject): boolean {
  let changed = false;

  if ('appearance' in payload) {
    delete payload.appearance;
    changed = true;
  }

  if ('appeareance' in payload) {
    delete payload.appeareance;
    changed = true;
  }

  return changed;
}

function buildItemTypeSkeletonPayload(source: JsonObject): JsonObject {
  return compactObject({
    name: asString(source.name) ?? asString(source.api_key) ?? 'Imported model',
    api_key: asString(source.api_key) ?? undefined,
    singleton: source.singleton,
    all_locales_required: source.all_locales_required,
    sortable: source.sortable,
    modular_block: source.modular_block,
    draft_mode_active: source.draft_mode_active,
    draft_saving_active: source.draft_saving_active,
    tree: source.tree,
    ordering_direction: source.ordering_direction,
    ordering_meta: source.ordering_meta,
    collection_appearance: source.collection_appearance,
    collection_appeareance: source.collection_appeareance,
    hint: source.hint,
    inverse_relationships_enabled: source.inverse_relationships_enabled,
  });
}

function buildItemTypeMinimalFallbackPayload(source: JsonObject): JsonObject {
  return compactObject({
    name: asString(source.name) ?? asString(source.api_key) ?? 'Imported model',
    api_key: asString(source.api_key) ?? undefined,
    modular_block: asBoolean(source.modular_block),
  });
}

function buildFieldsetPayload(source: JsonObject): JsonObject {
  return compactObject({
    title: asString(source.title) ?? 'Fieldset',
    hint: source.hint,
    position: source.position,
    collapsible: source.collapsible,
    start_collapsed: source.start_collapsed,
  });
}

const PASS_A_VALIDATOR_FIELD_TYPES = new Set([
  'link',
  'links',
  'modular_content',
  'single_block',
  'rich_text',
  'structured_text',
]);

const PASS_A_VALIDATOR_KEYS = [
  'item_item_type',
  'items_item_type',
  'single_block_blocks',
  'rich_text_blocks',
  'rich_text_links',
  'structured_text_blocks',
  'structured_text_links',
];

export function buildFieldPassAValidators(args: {
  source: JsonObject;
  itemTypeIdMap: Map<string, string>;
}): JsonObject | undefined {
  const fieldType = asString(args.source.field_type);
  if (!fieldType || !PASS_A_VALIDATOR_FIELD_TYPES.has(fieldType)) {
    return undefined;
  }

  const sourceValidators = isObject(args.source.validators)
    ? args.source.validators
    : null;
  if (!sourceValidators) {
    return undefined;
  }

  const remappedValidators = deepRemapKnownIds(sourceValidators, [
    args.itemTypeIdMap,
  ]);
  if (!isObject(remappedValidators)) {
    return undefined;
  }

  const payloadValidators: JsonObject = {};
  PASS_A_VALIDATOR_KEYS.forEach((validatorKey) => {
    if (validatorKey in remappedValidators) {
      payloadValidators[validatorKey] = remappedValidators[validatorKey];
    }
  });

  // Compatibility normalization for validator naming differences.
  if (fieldType === 'link') {
    if (!('item_item_type' in payloadValidators) && 'items_item_type' in payloadValidators) {
      payloadValidators.item_item_type = payloadValidators.items_item_type;
    }
  }

  if (fieldType === 'links' || fieldType === 'modular_content') {
    if (!('items_item_type' in payloadValidators) && 'item_item_type' in payloadValidators) {
      payloadValidators.items_item_type = payloadValidators.item_item_type;
    }
  }

  if (fieldType === 'single_block') {
    if (!('single_block_blocks' in payloadValidators)) {
      if ('item_item_type' in payloadValidators) {
        payloadValidators.single_block_blocks = payloadValidators.item_item_type;
      } else if ('items_item_type' in payloadValidators) {
        payloadValidators.single_block_blocks = payloadValidators.items_item_type;
      }
    }
  }

  if (fieldType === 'structured_text') {
    if (
      !('structured_text_blocks' in payloadValidators) &&
      'rich_text_blocks' in payloadValidators
    ) {
      payloadValidators.structured_text_blocks = payloadValidators.rich_text_blocks;
    }
  }

  if (fieldType === 'rich_text') {
    if (
      !('rich_text_blocks' in payloadValidators) &&
      'structured_text_blocks' in payloadValidators
    ) {
      payloadValidators.rich_text_blocks = payloadValidators.structured_text_blocks;
    }
  }

  return Object.keys(payloadValidators).length > 0 ? payloadValidators : undefined;
}

function buildFieldMinimalPayload(args: {
  source: JsonObject;
  itemTypeIdMap: Map<string, string>;
}): JsonObject {
  const passAValidators = buildFieldPassAValidators({
    source: args.source,
    itemTypeIdMap: args.itemTypeIdMap,
  });

  return compactObject({
    label: asString(args.source.label) ?? asString(args.source.api_key) ?? 'Field',
    field_type: asString(args.source.field_type) ?? 'string',
    api_key: asString(args.source.api_key) ?? undefined,
    localized: args.source.localized,
    position: args.source.position,
    hint: args.source.hint,
    validators: passAValidators,
  });
}

function buildFieldFullPayload(args: {
  source: JsonObject;
  itemTypeIdMap: Map<string, string>;
  fieldIdMap: Map<string, string>;
  fieldsetIdMap: Map<string, string>;
}): JsonObject {
  const remappedValidators = deepRemapKnownIds(args.source.validators, [
    args.itemTypeIdMap,
    args.fieldIdMap,
    args.fieldsetIdMap,
  ]);
  const remappedAppearance = deepRemapKnownIds(
    args.source.appearance ?? args.source.appeareance,
    [args.itemTypeIdMap, args.fieldIdMap, args.fieldsetIdMap],
  );
  const remappedDefaultValue = deepRemapKnownIds(args.source.default_value, [
    args.itemTypeIdMap,
    args.fieldIdMap,
    args.fieldsetIdMap,
  ]);

  const payload: JsonObject = compactObject({
    default_value: remappedDefaultValue,
    label: args.source.label,
    api_key: args.source.api_key,
    localized: args.source.localized,
    validators: remappedValidators,
    appearance: remappedAppearance,
    appeareance: remappedAppearance,
    position: args.source.position,
    field_type: args.source.field_type,
    hint: args.source.hint,
    deep_filtering_enabled: args.source.deep_filtering_enabled,
  });

  const mappedFieldset = mapRelationship({
    sourceValue: args.source.fieldset,
    idMap: args.fieldsetIdMap,
    relationshipType: 'fieldset',
  });

  if (mappedFieldset !== undefined) {
    payload.fieldset = mappedFieldset;
  }

  return payload;
}

function buildItemTypeFinalizePayload(args: {
  source: JsonObject;
  fieldIdMap: Map<string, string>;
  workflowIdMap?: Map<string, string>;
}): JsonObject {
  const payload = buildItemTypeSkeletonPayload(args.source);

  const orderingField = mapRelationship({
    sourceValue: args.source.ordering_field,
    idMap: args.fieldIdMap,
    relationshipType: 'field',
  });
  const presentationTitleField = mapRelationship({
    sourceValue: args.source.presentation_title_field,
    idMap: args.fieldIdMap,
    relationshipType: 'field',
  });
  const presentationImageField = mapRelationship({
    sourceValue: args.source.presentation_image_field,
    idMap: args.fieldIdMap,
    relationshipType: 'field',
  });
  const titleField = mapRelationship({
    sourceValue: args.source.title_field,
    idMap: args.fieldIdMap,
    relationshipType: 'field',
  });
  const imagePreviewField = mapRelationship({
    sourceValue: args.source.image_preview_field,
    idMap: args.fieldIdMap,
    relationshipType: 'field',
  });
  const excerptField = mapRelationship({
    sourceValue: args.source.excerpt_field,
    idMap: args.fieldIdMap,
    relationshipType: 'field',
  });

  if (orderingField !== undefined) {
    payload.ordering_field = orderingField;
  }
  if (presentationTitleField !== undefined) {
    payload.presentation_title_field = presentationTitleField;
  }
  if (presentationImageField !== undefined) {
    payload.presentation_image_field = presentationImageField;
  }
  if (titleField !== undefined) {
    payload.title_field = titleField;
  }
  if (imagePreviewField !== undefined) {
    payload.image_preview_field = imagePreviewField;
  }
  if (excerptField !== undefined) {
    payload.excerpt_field = excerptField;
  }

  if (args.workflowIdMap) {
    const workflow = mapRelationship({
      sourceValue: args.source.workflow,
      idMap: args.workflowIdMap,
      relationshipType: 'workflow',
    });
    if (workflow !== undefined) {
      payload.workflow = workflow;
    }
  }

  return payload;
}

async function listFieldsetsByTargetItemType(args: {
  client: Client;
  targetItemTypeIds: Iterable<string>;
}) {
  const fieldsetsByItemType = new Map<string, JsonObject[]>();

  await Promise.all(
    Array.from(new Set(Array.from(args.targetItemTypeIds))).map(
      async (targetItemTypeId) => {
        const fieldsets = await args.client.fieldsets.list(targetItemTypeId);
        fieldsetsByItemType.set(
          targetItemTypeId,
          fieldsets.filter(isObject) as JsonObject[],
        );
      },
    ),
  );

  return fieldsetsByItemType;
}

async function listFieldsByTargetItemType(args: {
  client: Client;
  targetItemTypeIds: Iterable<string>;
}) {
  const fieldsByItemType = new Map<string, JsonObject[]>();

  await Promise.all(
    Array.from(new Set(Array.from(args.targetItemTypeIds))).map(
      async (targetItemTypeId) => {
        const fields = await args.client.fields.list(targetItemTypeId);
        fieldsByItemType.set(targetItemTypeId, fields.filter(isObject) as JsonObject[]);
      },
    ),
  );

  return fieldsByItemType;
}

function getSourceItemTypes(envelope: RecordExportEnvelope): JsonObject[] {
  return asArray(envelope.schema.itemTypes).filter(isObject) as JsonObject[];
}

function getSourceFields(envelope: RecordExportEnvelope): JsonObject[] {
  return asArray(envelope.schema.fields).filter(isObject) as JsonObject[];
}

function getSourceFieldsets(envelope: RecordExportEnvelope): JsonObject[] {
  return asArray(sourceProjectConfiguration(envelope).fieldsets).filter(
    isObject,
  ) as JsonObject[];
}

function mapFieldApiKeysByItemType(args: {
  sourceFields: JsonObject[];
  itemTypeIdMap: Map<string, string>;
  fieldIdMap: Map<string, string>;
  targetFieldsByItemType: Map<string, JsonObject[]>;
}): FieldApiKeyMapByItemType {
  const result: FieldApiKeyMapByItemType = new Map();

  args.sourceFields.forEach((sourceField) => {
    const sourceItemTypeId = extractEntityId(sourceField.item_type);
    const sourceFieldId = asString(sourceField.id);
    const sourceFieldApiKey = asString(sourceField.api_key);
    if (!sourceItemTypeId || !sourceFieldId || !sourceFieldApiKey) {
      return;
    }

    const targetItemTypeId = args.itemTypeIdMap.get(sourceItemTypeId);
    const targetFieldId = args.fieldIdMap.get(sourceFieldId);
    if (!targetItemTypeId || !targetFieldId) {
      return;
    }

    const targetFields = args.targetFieldsByItemType.get(targetItemTypeId) ?? [];
    const targetField = targetFields.find((entry) => asString(entry.id) === targetFieldId);
    const targetFieldApiKey = asString(targetField?.api_key) ?? sourceFieldApiKey;

    const perModelMap = result.get(sourceItemTypeId) ?? new Map<string, string>();
    perModelMap.set(sourceFieldApiKey, targetFieldApiKey);
    result.set(sourceItemTypeId, perModelMap);
  });

  return result;
}

function markAddOnlySkip(args: {
  warnings: string[];
  counters: Record<string, number>;
  resource: 'itemTypes' | 'fieldsets' | 'fields';
  key: string;
}) {
  args.warnings.push(`[add-only][${args.resource}] Skipped existing ${args.key}`);
  args.counters[args.resource] = (args.counters[args.resource] ?? 0) + 1;
}

export async function importSchemaCore(args: {
  client: Client;
  envelope: RecordExportEnvelope;
  addOnlyDifferences?: boolean;
  initialItemTypeIdMap?: Map<string, string>;
  initialFieldIdMap?: Map<string, string>;
  initialFieldsetIdMap?: Map<string, string>;
  workflowIdMap?: Map<string, string>;
  logger?: DebugLogger;
  onProgress?: (progress: SchemaImportProgress) => void;
}): Promise<SchemaMappingReport> {
  const logger = (args.logger ?? createDebugLogger({ enabled: false })).child(
    'schema-import',
  );
  const addOnlyDifferences = Boolean(args.addOnlyDifferences);
  const itemTypes = createEmptyItemTypeReport();
  const fieldsets = createEmptyFieldsetReport();
  const fields = createEmptyFieldReport();
  const addOnlySkippedByResource: Record<string, number> = {};
  const existingItemTypeSourceIds = new Set<string>();
  const existingFieldsetSourceIds = new Set<string>();
  const existingFieldSourceIds = new Set<string>();
  const createdItemTypeSourceIds = new Set<string>();
  const createdFieldSourceIds = new Set<string>();

  if (args.initialItemTypeIdMap) {
    args.initialItemTypeIdMap.forEach((target, source) => {
      itemTypes.itemTypeIdMap.set(source, target);
    });
  }
  if (args.initialFieldsetIdMap) {
    args.initialFieldsetIdMap.forEach((target, source) => {
      fieldsets.fieldsetIdMap.set(source, target);
    });
  }
  if (args.initialFieldIdMap) {
    args.initialFieldIdMap.forEach((target, source) => {
      fields.fieldIdMap.set(source, target);
    });
  }

  const sourceItemTypes = getSourceItemTypes(args.envelope);
  const sourceFields = getSourceFields(args.envelope);
  const sourceFieldsets = getSourceFieldsets(args.envelope);
  const targetLocales = await resolveTargetLocales(args.client);

  logger.debug('Starting schema import', {
    sourceItemTypes: sourceItemTypes.length,
    sourceFieldsets: sourceFieldsets.length,
    sourceFields: sourceFields.length,
    addOnlyDifferences,
    seededItemTypeMappings: args.initialItemTypeIdMap?.size ?? 0,
    seededFieldsetMappings: args.initialFieldsetIdMap?.size ?? 0,
    seededFieldMappings: args.initialFieldIdMap?.size ?? 0,
    targetLocales: targetLocales ? Array.from(targetLocales) : null,
  });

  args.onProgress?.({
    phase: 'schema-skeleton',
    finished: 0,
    total: sourceItemTypes.length || 1,
    message: 'Importing model skeletons',
  });

  const targetItemTypes = (await args.client.itemTypes.list()).filter(
    isObject,
  ) as JsonObject[];
  const targetById = new Map(
    targetItemTypes
      .map((itemType) => [asString(itemType.id), asString(itemType.id)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
  );
  const targetByApiKey = new Map(
    targetItemTypes
      .map((itemType) => [asString(itemType.api_key), asString(itemType.id)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
  );

  for (let index = 0; index < sourceItemTypes.length; index += 1) {
    const sourceItemType = sourceItemTypes[index];
    const sourceItemTypeId = asString(sourceItemType.id);
    const sourceApiKey = asString(sourceItemType.api_key);

    args.onProgress?.({
      phase: 'schema-skeleton',
      finished: index,
      total: sourceItemTypes.length || 1,
      message: `Importing model skeleton ${index + 1}/${sourceItemTypes.length || 1}`,
    });

    if (!sourceItemTypeId) {
      itemTypes.missing.push({
        sourceItemTypeId: `unknown-${index}`,
        sourceApiKey,
        reason: 'Source model is missing id.',
      });
      continue;
    }

    const mappedFromExistingId = targetById.get(sourceItemTypeId);
    if (mappedFromExistingId) {
      itemTypes.itemTypeIdMap.set(sourceItemTypeId, mappedFromExistingId);
      existingItemTypeSourceIds.add(sourceItemTypeId);
      if (addOnlyDifferences) {
        markAddOnlySkip({
          warnings: itemTypes.warnings,
          counters: addOnlySkippedByResource,
          resource: 'itemTypes',
          key: `model '${sourceApiKey ?? sourceItemTypeId}'`,
        });
      }
      continue;
    }

    if (sourceApiKey) {
      const mappedFromApiKey = targetByApiKey.get(sourceApiKey);
      if (mappedFromApiKey) {
        itemTypes.itemTypeIdMap.set(sourceItemTypeId, mappedFromApiKey);
        existingItemTypeSourceIds.add(sourceItemTypeId);
        if (addOnlyDifferences) {
          markAddOnlySkip({
            warnings: itemTypes.warnings,
            counters: addOnlySkippedByResource,
            resource: 'itemTypes',
            key: `model '${sourceApiKey}'`,
          });
        }
        continue;
      }
    }

    try {
      const created = await args.client.itemTypes.create(
        buildItemTypeSkeletonPayload(sourceItemType) as any,
      );
      const createdId = asString(created.id);
      if (!createdId) {
        throw new Error('Create model response did not include id.');
      }

      itemTypes.itemTypeIdMap.set(sourceItemTypeId, createdId);
      createdItemTypeSourceIds.add(sourceItemTypeId);
      if (sourceApiKey) {
        targetByApiKey.set(sourceApiKey, createdId);
      }
      targetById.set(createdId, createdId);
      logger.debug('Created model skeleton', {
        sourceItemTypeId,
        sourceApiKey,
        targetItemTypeId: createdId,
      });
    } catch (error) {
      try {
        const created = await args.client.itemTypes.create(
          buildItemTypeMinimalFallbackPayload(sourceItemType) as any,
        );
        const createdId = asString(created.id);
        if (!createdId) {
          throw new Error('Create model response did not include id.');
        }

        itemTypes.itemTypeIdMap.set(sourceItemTypeId, createdId);
        createdItemTypeSourceIds.add(sourceItemTypeId);
        if (sourceApiKey) {
          targetByApiKey.set(sourceApiKey, createdId);
        }
        targetById.set(createdId, createdId);
        itemTypes.warnings.push(
          `Model '${sourceApiKey ?? sourceItemTypeId}' required fallback skeleton payload.`,
        );
        logger.warn('Created model skeleton using fallback payload', {
          sourceItemTypeId,
          sourceApiKey,
          targetItemTypeId: createdId,
        });
      } catch (fallbackError) {
        itemTypes.missing.push({
          sourceItemTypeId,
          sourceApiKey,
          reason:
            fallbackError instanceof Error
              ? fallbackError.message
              : error instanceof Error
                ? error.message
                : 'Could not create model skeleton.',
        });
        logger.error('Failed to create model skeleton', {
          sourceItemTypeId,
          sourceApiKey,
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : error instanceof Error
                ? error.message
                : 'Unknown error',
        });
      }
    }
  }

  logger.debug('Finished model skeleton phase', {
    mappedItemTypes: itemTypes.itemTypeIdMap.size,
    missing: itemTypes.missing.length,
    warnings: itemTypes.warnings.length,
  });

  args.onProgress?.({
    phase: 'fieldset-import',
    finished: 0,
    total: sourceFieldsets.length || 1,
    message: 'Importing fieldsets',
  });

  const targetFieldsetsByItemType = await listFieldsetsByTargetItemType({
    client: args.client,
    targetItemTypeIds: itemTypes.itemTypeIdMap.values(),
  });

  for (let index = 0; index < sourceFieldsets.length; index += 1) {
    const sourceFieldset = sourceFieldsets[index];
    const sourceFieldsetId = asString(sourceFieldset.id);
    const sourceItemTypeId = extractEntityId(sourceFieldset.item_type);

    args.onProgress?.({
      phase: 'fieldset-import',
      finished: index,
      total: sourceFieldsets.length || 1,
      message: `Importing fieldset ${index + 1}/${sourceFieldsets.length || 1}`,
    });

    if (!sourceFieldsetId) {
      fieldsets.warnings.push(
        `Skipping fieldset at index ${index} because source id is missing.`,
      );
      continue;
    }

    if (!sourceItemTypeId) {
      fieldsets.missing.push({
        sourceFieldsetId,
        sourceItemTypeId: null,
        reason: 'Fieldset is missing item_type relationship.',
      });
      continue;
    }

    const targetItemTypeId = itemTypes.itemTypeIdMap.get(sourceItemTypeId);
    if (!targetItemTypeId) {
      fieldsets.missing.push({
        sourceFieldsetId,
        sourceItemTypeId,
        reason: 'Fieldset model could not be mapped in target schema.',
      });
      continue;
    }

    const existingFieldsets = targetFieldsetsByItemType.get(targetItemTypeId) ?? [];
    const sourceTitle = asString(sourceFieldset.title) ?? '';
    const sourcePosition = typeof sourceFieldset.position === 'number'
      ? sourceFieldset.position
      : null;

    const existing = existingFieldsets.find((candidate) => {
      const sameTitle = (asString(candidate.title) ?? '') === sourceTitle;
      const candidatePosition = typeof candidate.position === 'number'
        ? candidate.position
        : null;
      const samePosition = sourcePosition === null || sourcePosition === candidatePosition;
      return sameTitle && samePosition;
    });

    if (existing) {
      const existingId = asString(existing.id);
      if (existingId) {
        fieldsets.fieldsetIdMap.set(sourceFieldsetId, existingId);
        existingFieldsetSourceIds.add(sourceFieldsetId);
        if (addOnlyDifferences) {
          markAddOnlySkip({
            warnings: fieldsets.warnings,
            counters: addOnlySkippedByResource,
            resource: 'fieldsets',
            key: `fieldset '${sourceTitle || sourceFieldsetId}'`,
          });
        }
      }
      continue;
    }

    try {
      const created = await args.client.fieldsets.create(
        targetItemTypeId,
        buildFieldsetPayload(sourceFieldset) as any,
      );
      const createdId = asString(created.id);
      if (!createdId) {
        throw new Error('Create fieldset response did not include id.');
      }
      fieldsets.fieldsetIdMap.set(sourceFieldsetId, createdId);
      existingFieldsets.push(created as unknown as JsonObject);
      targetFieldsetsByItemType.set(targetItemTypeId, existingFieldsets);
      logger.debug('Created fieldset', {
        sourceFieldsetId,
        sourceItemTypeId,
        targetFieldsetId: createdId,
        targetItemTypeId,
      });
    } catch (error) {
      fieldsets.missing.push({
        sourceFieldsetId,
        sourceItemTypeId,
        reason:
          error instanceof Error ? error.message : 'Could not create destination fieldset.',
      });
      logger.error('Failed to create fieldset', {
        sourceFieldsetId,
        sourceItemTypeId,
        targetItemTypeId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.debug('Finished fieldset phase', {
    mappedFieldsets: fieldsets.fieldsetIdMap.size,
    missing: fieldsets.missing.length,
    warnings: fieldsets.warnings.length,
  });

  args.onProgress?.({
    phase: 'field-import-pass-a',
    finished: 0,
    total: sourceFields.length || 1,
    message: 'Importing fields (pass A)',
  });

  const targetFieldsByItemType = await listFieldsByTargetItemType({
    client: args.client,
    targetItemTypeIds: itemTypes.itemTypeIdMap.values(),
  });

  for (let index = 0; index < sourceFields.length; index += 1) {
    const sourceField = sourceFields[index];
    const sourceFieldId = asString(sourceField.id);
    const sourceApiKey = asString(sourceField.api_key);
    const sourceItemTypeId = extractEntityId(sourceField.item_type);

    args.onProgress?.({
      phase: 'field-import-pass-a',
      finished: index,
      total: sourceFields.length || 1,
      message: `Importing field ${index + 1}/${sourceFields.length || 1}`,
    });

    if (!sourceFieldId || !sourceApiKey || !sourceItemTypeId) {
      fields.missing.push({
        sourceItemTypeId: sourceItemTypeId ?? 'unknown',
        sourceItemTypeApiKey:
          sourceItemTypeId
            ? args.envelope.schema.itemTypeIdToApiKey[sourceItemTypeId] ?? null
            : null,
        sourceFieldApiKey: sourceApiKey ?? `unknown_${index}`,
        reason: 'Field is missing required id/api_key/item_type data.',
      });
      continue;
    }

    const targetItemTypeId = itemTypes.itemTypeIdMap.get(sourceItemTypeId);
    if (!targetItemTypeId) {
      fields.missing.push({
        sourceItemTypeId,
        sourceItemTypeApiKey: args.envelope.schema.itemTypeIdToApiKey[sourceItemTypeId] ?? null,
        sourceFieldApiKey: sourceApiKey,
        reason: 'Field model could not be mapped in target schema.',
      });
      continue;
    }

    const targetFields = targetFieldsByItemType.get(targetItemTypeId) ?? [];
    const existing = targetFields.find(
      (candidate) => asString(candidate.api_key) === sourceApiKey,
    );

    if (existing) {
      const existingId = asString(existing.id);
      if (existingId) {
        fields.fieldIdMap.set(sourceFieldId, existingId);
        existingFieldSourceIds.add(sourceFieldId);
        if (addOnlyDifferences) {
          markAddOnlySkip({
            warnings: fields.warnings,
            counters: addOnlySkippedByResource,
            resource: 'fields',
            key: `field '${sourceApiKey}'`,
          });
        }
      }
      continue;
    }

    let createPayload: JsonObject | null = null;
    try {
      createPayload = buildFieldMinimalPayload({
        source: sourceField,
        itemTypeIdMap: itemTypes.itemTypeIdMap,
      });
      const mappedFieldset = mapRelationship({
        sourceValue: sourceField.fieldset,
        idMap: fieldsets.fieldsetIdMap,
        relationshipType: 'fieldset',
      });
      if (mappedFieldset !== undefined) {
        createPayload.fieldset = mappedFieldset;
      }

      const created = await args.client.fields.create(targetItemTypeId, createPayload as any);
      const createdId = asString(created.id);
      if (!createdId) {
        throw new Error('Create field response did not include id.');
      }

      fields.fieldIdMap.set(sourceFieldId, createdId);
      createdFieldSourceIds.add(sourceFieldId);
      targetFields.push(created as unknown as JsonObject);
      targetFieldsByItemType.set(targetItemTypeId, targetFields);
      logger.debug('Created field in pass A', {
        sourceFieldId,
        sourceFieldApiKey: sourceApiKey,
        sourceItemTypeId,
        targetFieldId: createdId,
        targetItemTypeId,
      });
    } catch (error) {
      fields.missing.push({
        sourceItemTypeId,
        sourceItemTypeApiKey: args.envelope.schema.itemTypeIdToApiKey[sourceItemTypeId] ?? null,
        sourceFieldApiKey: sourceApiKey,
        reason: error instanceof Error ? error.message : 'Could not create destination field.',
      });
      logger.error('Failed to create field in pass A', {
        sourceFieldId,
        sourceFieldApiKey: sourceApiKey,
        sourceFieldType: asString(sourceField.field_type),
        sourceValidatorKeys: isObject(sourceField.validators)
          ? Object.keys(sourceField.validators)
          : [],
        passAPayload: createPayload,
        sourceItemTypeId,
        targetItemTypeId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.debug('Finished field pass A', {
    mappedFields: fields.fieldIdMap.size,
    missing: fields.missing.length,
  });

  args.onProgress?.({
    phase: 'field-import-pass-b',
    finished: 0,
    total: sourceFields.length || 1,
    message: 'Importing fields (pass B)',
  });

  for (let index = 0; index < sourceFields.length; index += 1) {
    const sourceField = sourceFields[index];
    const sourceFieldId = asString(sourceField.id);
    const sourceApiKey = asString(sourceField.api_key);
    const sourceItemTypeId = extractEntityId(sourceField.item_type);

    args.onProgress?.({
      phase: 'field-import-pass-b',
      finished: index,
      total: sourceFields.length || 1,
      message: `Finalizing field ${index + 1}/${sourceFields.length || 1}`,
    });

    if (!sourceFieldId || !sourceApiKey || !sourceItemTypeId) {
      continue;
    }

    if (addOnlyDifferences && !createdFieldSourceIds.has(sourceFieldId)) {
      if (!existingFieldSourceIds.has(sourceFieldId)) {
        existingFieldSourceIds.add(sourceFieldId);
        markAddOnlySkip({
          warnings: fields.warnings,
          counters: addOnlySkippedByResource,
          resource: 'fields',
          key: `field '${sourceApiKey}'`,
        });
      }
      continue;
    }

    const targetFieldId = fields.fieldIdMap.get(sourceFieldId);
    if (!targetFieldId) {
      continue;
    }

    const updatePayload = buildFieldFullPayload({
      source: sourceField,
      itemTypeIdMap: itemTypes.itemTypeIdMap,
      fieldIdMap: fields.fieldIdMap,
      fieldsetIdMap: fieldsets.fieldsetIdMap,
    });
    const runtimePayload = cloneJson(updatePayload);

    const sanitizedDefaultValue = sanitizeLocalizedDefaultValue({
      sourceField,
      payload: runtimePayload,
      targetLocales,
    });
    if (sanitizedDefaultValue.droppedLocales.length > 0) {
      logger.warn('Dropped unsupported locales from field default_value', {
        sourceFieldId,
        sourceFieldApiKey: sourceApiKey,
        targetFieldId,
        droppedLocales: sanitizedDefaultValue.droppedLocales,
        allowedLocales: targetLocales ? Array.from(targetLocales) : [],
      });
    }

    try {
      await args.client.fields.update(targetFieldId, runtimePayload as any);
      logger.debug('Updated field in pass B', {
        sourceFieldId,
        sourceFieldApiKey: sourceApiKey,
        sourceItemTypeId,
        targetFieldId,
      });
    } catch (error) {
      let finalError = error;

      if (isDefaultValueLocalesMismatchError(error) && 'default_value' in runtimePayload) {
        const retryPayload: JsonObject = { ...runtimePayload };
        delete retryPayload.default_value;

        logger.warn(
          'Retrying field pass B update without default_value after locale mismatch',
          {
            sourceFieldId,
            sourceFieldApiKey: sourceApiKey,
            sourceItemTypeId,
            targetFieldId,
            originalError: error instanceof Error ? error.message : 'Unknown error',
          },
        );

        try {
          await args.client.fields.update(targetFieldId, retryPayload as any);
          logger.warn('Updated field in pass B after removing default_value', {
            sourceFieldId,
            sourceFieldApiKey: sourceApiKey,
            sourceItemTypeId,
            targetFieldId,
          });
          continue;
        } catch (retryError) {
          finalError = retryError;
        }
      }

      if (isAppearanceAddonsInvalidError(finalError)) {
        const strippedAddons = stripAppearanceAddonsFromPayload(runtimePayload);
        if (strippedAddons) {
          logger.warn(
            'Retrying field pass B update without appearance addons after validation error',
            {
              sourceFieldId,
              sourceFieldApiKey: sourceApiKey,
              sourceItemTypeId,
              targetFieldId,
            },
          );

          try {
            await args.client.fields.update(targetFieldId, runtimePayload as any);
            logger.warn('Updated field in pass B after removing appearance addons', {
              sourceFieldId,
              sourceFieldApiKey: sourceApiKey,
              sourceItemTypeId,
              targetFieldId,
            });
            continue;
          } catch (retryError) {
            finalError = retryError;
          }
        }
      }

      if (isAppearanceInvalidError(finalError)) {
        const strippedAppearance = stripAppearancePayload(runtimePayload);
        if (strippedAppearance) {
          logger.warn(
            'Retrying field pass B update without appearance after validation error',
            {
              sourceFieldId,
              sourceFieldApiKey: sourceApiKey,
              sourceItemTypeId,
              targetFieldId,
            },
          );

          try {
            await args.client.fields.update(targetFieldId, runtimePayload as any);
            logger.warn('Updated field in pass B after removing appearance', {
              sourceFieldId,
              sourceFieldApiKey: sourceApiKey,
              sourceItemTypeId,
              targetFieldId,
            });
            continue;
          } catch (retryError) {
            finalError = retryError;
          }
        }
      }

      fields.missing.push({
        sourceItemTypeId,
        sourceItemTypeApiKey: args.envelope.schema.itemTypeIdToApiKey[sourceItemTypeId] ?? null,
        sourceFieldApiKey: sourceApiKey,
        reason:
          finalError instanceof Error
            ? `Field pass-B update failed: ${finalError.message}`
            : 'Field pass-B update failed.',
      });
      logger.error('Failed to update field in pass B', {
        sourceFieldId,
        sourceFieldApiKey: sourceApiKey,
        sourceItemTypeId,
        targetFieldId,
        payload: runtimePayload,
        error: finalError instanceof Error ? finalError.message : 'Unknown error',
      });
    }
  }

  logger.debug('Finished field pass B', {
    mappedFields: fields.fieldIdMap.size,
    missing: fields.missing.length,
  });

  args.onProgress?.({
    phase: 'schema-finalize',
    finished: 0,
    total: sourceItemTypes.length || 1,
    message: 'Finalizing models',
  });

  for (let index = 0; index < sourceItemTypes.length; index += 1) {
    const sourceItemType = sourceItemTypes[index];
    const sourceItemTypeId = asString(sourceItemType.id);
    const sourceApiKey = asString(sourceItemType.api_key);

    args.onProgress?.({
      phase: 'schema-finalize',
      finished: index,
      total: sourceItemTypes.length || 1,
      message: `Finalizing model ${index + 1}/${sourceItemTypes.length || 1}`,
    });

    if (!sourceItemTypeId) {
      continue;
    }

    if (addOnlyDifferences && !createdItemTypeSourceIds.has(sourceItemTypeId)) {
      if (!existingItemTypeSourceIds.has(sourceItemTypeId)) {
        existingItemTypeSourceIds.add(sourceItemTypeId);
        markAddOnlySkip({
          warnings: itemTypes.warnings,
          counters: addOnlySkippedByResource,
          resource: 'itemTypes',
          key: `model '${sourceApiKey ?? sourceItemTypeId}'`,
        });
      }
      continue;
    }

    const targetItemTypeId = itemTypes.itemTypeIdMap.get(sourceItemTypeId);
    if (!targetItemTypeId) {
      continue;
    }

    try {
      const payload = buildItemTypeFinalizePayload({
        source: sourceItemType,
        fieldIdMap: fields.fieldIdMap,
        workflowIdMap: args.workflowIdMap,
      });
      await args.client.itemTypes.update(targetItemTypeId, payload as any);
      logger.debug('Finalized model', {
        sourceItemTypeId,
        sourceApiKey,
        targetItemTypeId,
      });
    } catch (error) {
      itemTypes.missing.push({
        sourceItemTypeId,
        sourceApiKey,
        reason:
          error instanceof Error
            ? `Model finalization failed: ${error.message}`
            : 'Model finalization failed.',
      });
      logger.error('Failed to finalize model', {
        sourceItemTypeId,
        sourceApiKey,
        targetItemTypeId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const refreshedTargetFields = await listFieldsByTargetItemType({
    client: args.client,
    targetItemTypeIds: itemTypes.itemTypeIdMap.values(),
  });

  fields.fieldApiKeyMapByItemType = mapFieldApiKeysByItemType({
    sourceFields,
    itemTypeIdMap: itemTypes.itemTypeIdMap,
    fieldIdMap: fields.fieldIdMap,
    targetFieldsByItemType: refreshedTargetFields,
  });

  logger.debug('Finished schema import', {
    itemTypeMappings: itemTypes.itemTypeIdMap.size,
    fieldsetMappings: fieldsets.fieldsetIdMap.size,
    fieldMappings: fields.fieldIdMap.size,
    itemTypeMissing: itemTypes.missing.length,
    fieldsetMissing: fieldsets.missing.length,
    fieldMissing: fields.missing.length,
  });

  return {
    itemTypes,
    fieldsets,
    fields,
    addOnlySkippedByResource:
      Object.keys(addOnlySkippedByResource).length > 0
        ? addOnlySkippedByResource
        : undefined,
    createdItemTypeSourceIds:
      createdItemTypeSourceIds.size > 0
        ? Array.from(createdItemTypeSourceIds)
        : undefined,
  };
}

export async function patchItemTypeWorkflowRelationships(args: {
  client: Client;
  envelope: RecordExportEnvelope;
  itemTypeIdMap: Map<string, string>;
  fieldIdMap: Map<string, string>;
  workflowIdMap: Map<string, string>;
  allowedSourceItemTypeIds?: Set<string>;
  logger?: DebugLogger;
}) {
  const logger = (args.logger ?? createDebugLogger({ enabled: false })).child(
    'schema-import',
  );
  const sourceItemTypes = getSourceItemTypes(args.envelope);

  for (const sourceItemType of sourceItemTypes) {
    const sourceItemTypeId = asString(sourceItemType.id);
    if (!sourceItemTypeId) {
      continue;
    }

    if (
      args.allowedSourceItemTypeIds &&
      !args.allowedSourceItemTypeIds.has(sourceItemTypeId)
    ) {
      continue;
    }

    const targetItemTypeId = args.itemTypeIdMap.get(sourceItemTypeId);
    if (!targetItemTypeId) {
      continue;
    }

    const sourceWorkflowId = extractEntityId(sourceItemType.workflow);
    if (!sourceWorkflowId) {
      continue;
    }

    const targetWorkflowId = args.workflowIdMap.get(sourceWorkflowId);
    if (!targetWorkflowId) {
      continue;
    }

    const payload = buildItemTypeFinalizePayload({
      source: sourceItemType,
      fieldIdMap: args.fieldIdMap,
      workflowIdMap: args.workflowIdMap,
    });

    await args.client.itemTypes.update(targetItemTypeId, payload as any);
    logger.debug('Patched model workflow relationship', {
      sourceItemTypeId,
      sourceWorkflowId,
      targetItemTypeId,
      targetWorkflowId,
    });
  }
}

export function buildFieldsetLookupKey(args: {
  targetItemTypeId: string;
  title: string | null;
  position: number | null;
}) {
  return makeCompositeKey([args.targetItemTypeId, args.title, args.position]);
}
