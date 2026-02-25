import type { Client } from '@datocms/cma-client-browser';
import { withRetry } from './retry';
import { buildFieldPassAValidators } from './schemaClone';
import type { DebugLogger } from './debugLogger';
import type { JsonObject, RecordExportEnvelope, RetryOptions } from './types';
import { asString, cloneJson, isObject } from './resourceUtils';

const BLOCK_CONTAINER_FIELD_TYPES = new Set([
  'modular_content',
  'single_block',
  'structured_text',
  'rich_text',
]);

type SourceFieldDescriptor = {
  sourceItemTypeId: string;
  sourceItemTypeApiKey: string | null;
  sourceFieldId: string;
  sourceFieldApiKey: string;
  sourceFieldType: string | null;
  sourceField: JsonObject;
};

export type ValidationScope = {
  sourceItemTypeIds: Set<string>;
  sourceFieldEntries: SourceFieldDescriptor[];
  warnings: string[];
};

export type FieldValidationSnapshot = {
  sourceItemTypeId: string;
  sourceItemTypeApiKey: string | null;
  sourceFieldId: string;
  sourceFieldApiKey: string;
  targetItemTypeId: string;
  targetFieldId: string;
  targetFieldApiKey: string;
  targetFieldType: string | null;
  originalValidators: unknown;
  originalAllLocalesRequired: boolean;
};

export type ValidationWindowFailure = {
  sourceItemTypeId: string;
  sourceFieldId: string;
  sourceFieldApiKey: string;
  targetFieldId: string;
  message: string;
  payload: JsonObject;
};

export type ValidationSuspendResult = {
  ok: boolean;
  inScopeCount: number;
  suspendedCount: number;
  skippedUnmappedCount: number;
  warnings: string[];
  failures: ValidationWindowFailure[];
  failureFieldIds: string[];
  snapshots: FieldValidationSnapshot[];
};

export type ValidationRestoreResult = {
  ok: boolean;
  restoredCount: number;
  warnings: string[];
  failures: ValidationWindowFailure[];
  failureFieldIds: string[];
};

type ScopedTargetField = {
  descriptor: SourceFieldDescriptor;
  snapshot: FieldValidationSnapshot;
  relaxedValidators: JsonObject;
};

function extractEntityId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (!isObject(value)) {
    return null;
  }

  const id = value.id;
  if (typeof id === 'string') {
    return id;
  }
  if (typeof id === 'number' && Number.isFinite(id)) {
    return String(id);
  }

  return null;
}

function extractFieldId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function formatError(error: unknown): string {
  if (!error) {
    return 'Unknown error';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }

  return 'Unknown error';
}

function indexSourceItemTypesById(
  envelope: RecordExportEnvelope,
): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();

  envelope.schema.itemTypes.forEach((itemType) => {
    const id = extractEntityId(itemType.id);
    if (!id) {
      return;
    }

    result.set(id, itemType);
  });

  return result;
}

function indexSourceFieldsByItemType(
  envelope: RecordExportEnvelope,
): Map<string, SourceFieldDescriptor[]> {
  const sourceItemTypeApiKeys = envelope.schema.itemTypeIdToApiKey;
  const result = new Map<string, SourceFieldDescriptor[]>();

  envelope.schema.fields.forEach((field) => {
    if (!isObject(field)) {
      return;
    }

    const sourceItemTypeId = extractEntityId(field.item_type);
    const sourceFieldId = extractFieldId(field.id);
    const sourceFieldApiKey = asString(field.api_key);

    if (!sourceItemTypeId || !sourceFieldId || !sourceFieldApiKey) {
      return;
    }

    const entry: SourceFieldDescriptor = {
      sourceItemTypeId,
      sourceItemTypeApiKey: sourceItemTypeApiKeys[sourceItemTypeId] ?? null,
      sourceFieldId,
      sourceFieldApiKey,
      sourceFieldType: asString(field.field_type),
      sourceField: field,
    };

    const existing = result.get(sourceItemTypeId) ?? [];
    existing.push(entry);
    result.set(sourceItemTypeId, existing);
  });

  return result;
}

function collectKnownItemTypeIds(envelope: RecordExportEnvelope): Set<string> {
  const ids = new Set<string>();

  envelope.schema.itemTypes.forEach((itemType) => {
    const id = asString(itemType.id);
    if (id) {
      ids.add(id);
    }
  });

  return ids;
}

function collectKnownItemTypeRefs(args: {
  value: unknown;
  knownItemTypeIds: Set<string>;
  output: Set<string>;
  visited: WeakSet<object>;
}) {
  if (typeof args.value === 'string') {
    if (args.knownItemTypeIds.has(args.value)) {
      args.output.add(args.value);
    }
    return;
  }

  if (typeof args.value === 'number' && Number.isFinite(args.value)) {
    const asId = String(args.value);
    if (args.knownItemTypeIds.has(asId)) {
      args.output.add(asId);
    }
    return;
  }

  if (Array.isArray(args.value)) {
    args.value.forEach((entry) =>
      collectKnownItemTypeRefs({
        ...args,
        value: entry,
      }),
    );
    return;
  }

  if (!isObject(args.value)) {
    return;
  }

  if (args.visited.has(args.value)) {
    return;
  }

  args.visited.add(args.value);

  const maybeId = extractEntityId(args.value.id);
  if (maybeId && args.knownItemTypeIds.has(maybeId)) {
    args.output.add(maybeId);
  }

  Object.values(args.value).forEach((entry) =>
    collectKnownItemTypeRefs({
      ...args,
      value: entry,
    }),
  );
}

function extractReferencedBlockModelIds(args: {
  sourceField: JsonObject;
  knownItemTypeIds: Set<string>;
  sourceItemTypesById: Map<string, JsonObject>;
}): Set<string> {
  const sourceFieldType = asString(args.sourceField.field_type);
  if (!sourceFieldType || !BLOCK_CONTAINER_FIELD_TYPES.has(sourceFieldType)) {
    return new Set();
  }

  const validators = isObject(args.sourceField.validators)
    ? args.sourceField.validators
    : null;
  if (!validators) {
    return new Set();
  }

  const referencedModelIds = new Set<string>();
  collectKnownItemTypeRefs({
    value: validators,
    knownItemTypeIds: args.knownItemTypeIds,
    output: referencedModelIds,
    visited: new WeakSet<object>(),
  });

  const referencedBlockModelIds = new Set<string>();
  referencedModelIds.forEach((sourceItemTypeId) => {
    const sourceItemType = args.sourceItemTypesById.get(sourceItemTypeId);
    if (sourceItemType?.modular_block) {
      referencedBlockModelIds.add(sourceItemTypeId);
    }
  });

  return referencedBlockModelIds;
}

export function resolveValidationScope(args: {
  envelope: RecordExportEnvelope;
  sourceRecordIds: Iterable<string>;
  logger: DebugLogger;
}): ValidationScope {
  const warnings: string[] = [];
  const sourceRecordIdSet = new Set(args.sourceRecordIds);
  const sourceItemTypesById = indexSourceItemTypesById(args.envelope);
  const sourceFieldsByItemType = indexSourceFieldsByItemType(args.envelope);
  const knownItemTypeIds = collectKnownItemTypeIds(args.envelope);
  const sourceItemTypeIds = new Set<string>();

  args.envelope.records.forEach((record) => {
    if (!isObject(record)) {
      return;
    }

    const sourceRecordId = asString(record.id);
    if (!sourceRecordId || !sourceRecordIdSet.has(sourceRecordId)) {
      return;
    }

    const sourceItemTypeId = extractEntityId(record.item_type);
    if (!sourceItemTypeId) {
      warnings.push(
        `[validation-window] Record '${sourceRecordId}' is missing source item_type id.`,
      );
      return;
    }

    sourceItemTypeIds.add(sourceItemTypeId);
  });

  const queue = Array.from(sourceItemTypeIds);
  while (queue.length > 0) {
    const sourceItemTypeId = queue.shift();
    if (!sourceItemTypeId) {
      continue;
    }

    const fields = sourceFieldsByItemType.get(sourceItemTypeId) ?? [];
    fields.forEach((field) => {
      const nestedBlockModels = extractReferencedBlockModelIds({
        sourceField: field.sourceField,
        knownItemTypeIds,
        sourceItemTypesById,
      });
      nestedBlockModels.forEach((nestedSourceItemTypeId) => {
        if (sourceItemTypeIds.has(nestedSourceItemTypeId)) {
          return;
        }

        sourceItemTypeIds.add(nestedSourceItemTypeId);
        queue.push(nestedSourceItemTypeId);
      });
    });
  }

  const sourceFieldEntries: SourceFieldDescriptor[] = [];
  sourceItemTypeIds.forEach((sourceItemTypeId) => {
    const fields = sourceFieldsByItemType.get(sourceItemTypeId);
    if (!fields || fields.length === 0) {
      return;
    }

    fields.forEach((field) => sourceFieldEntries.push(field));
  });

  args.logger.debug('Resolved validation window scope', {
    sourceRecordCount: sourceRecordIdSet.size,
    scopedItemTypes: sourceItemTypeIds.size,
    scopedFields: sourceFieldEntries.length,
    warnings: warnings.length,
  });

  return {
    sourceItemTypeIds,
    sourceFieldEntries,
    warnings,
  };
}

function normalizeValidatorsForPayload(value: unknown): JsonObject {
  if (isObject(value)) {
    return cloneJson(value);
  }

  return {};
}

function buildRelaxedValidatorsFromTargetField(targetField: JsonObject): JsonObject {
  const preserved = buildFieldPassAValidators({
    source: targetField,
    itemTypeIdMap: new Map<string, string>(),
  });

  return normalizeValidatorsForPayload(preserved);
}

export function buildRelaxedValidators(args: {
  sourceField: JsonObject;
  itemTypeIdMap: Map<string, string>;
}): JsonObject {
  const preserved = buildFieldPassAValidators({
    source: args.sourceField,
    itemTypeIdMap: args.itemTypeIdMap,
  });

  return normalizeValidatorsForPayload(preserved);
}

async function runWithConcurrency<T>(args: {
  inputs: T[];
  limit: number;
  worker: (input: T) => Promise<void>;
}) {
  if (args.inputs.length === 0) {
    return;
  }

  const safeLimit = Math.max(1, Math.min(args.limit, args.inputs.length));
  let cursor = 0;

  const runners = Array.from({ length: safeLimit }, async () => {
    while (cursor < args.inputs.length) {
      const index = cursor;
      cursor += 1;
      await args.worker(args.inputs[index]);
    }
  });

  await Promise.all(runners);
}

async function buildScopedTargetFields(args: {
  client: Client;
  scope: ValidationScope;
  itemTypeIdMap: Map<string, string>;
  fieldIdMap: Map<string, string>;
  logger: DebugLogger;
}): Promise<{
  fields: ScopedTargetField[];
  skippedUnmappedCount: number;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const fieldsClient = args.client.fields as Client['fields'] & {
    find?: (fieldId: string) => Promise<unknown>;
  };
  const targetFieldsByItemType = new Map<string, JsonObject[]>();

  const uniqueTargetItemTypeIds = new Set<string>();
  args.scope.sourceItemTypeIds.forEach((sourceItemTypeId) => {
    const targetItemTypeId = args.itemTypeIdMap.get(sourceItemTypeId);
    if (targetItemTypeId) {
      uniqueTargetItemTypeIds.add(targetItemTypeId);
      return;
    }

    warnings.push(
      `[validation-window] Missing target model mapping for source item type '${sourceItemTypeId}'.`,
    );
  });

  await Promise.all(
    Array.from(uniqueTargetItemTypeIds).map(async (targetItemTypeId) => {
      const listed = await fieldsClient.list(targetItemTypeId);
      const normalized = Array.isArray(listed)
        ? listed.filter(isObject)
        : [];
      targetFieldsByItemType.set(targetItemTypeId, normalized as JsonObject[]);
    }),
  );

  const scopedTargetFields: ScopedTargetField[] = [];
  let skippedUnmappedCount = 0;

  for (const descriptor of args.scope.sourceFieldEntries) {
    const targetItemTypeId = args.itemTypeIdMap.get(descriptor.sourceItemTypeId);
    if (!targetItemTypeId) {
      skippedUnmappedCount += 1;
      continue;
    }

    const targetFields = targetFieldsByItemType.get(targetItemTypeId) ?? [];
    const targetByApiKey = new Map(
      targetFields
        .map((field) => [asString(field.api_key), field] as const)
        .filter((entry): entry is [string, JsonObject] => Boolean(entry[0])),
    );
    const targetById = new Map(
      targetFields
        .map((field) => [asString(field.id), field] as const)
        .filter((entry): entry is [string, JsonObject] => Boolean(entry[0])),
    );

    let targetField = (() => {
      const mappedTargetFieldId = args.fieldIdMap.get(descriptor.sourceFieldId);
      if (mappedTargetFieldId) {
        return targetById.get(mappedTargetFieldId) ?? null;
      }
      return null;
    })();

    if (!targetField) {
      targetField = targetByApiKey.get(descriptor.sourceFieldApiKey) ?? null;
    }

    const mappedTargetFieldId = args.fieldIdMap.get(descriptor.sourceFieldId);
    if (!targetField && mappedTargetFieldId && typeof fieldsClient.find === 'function') {
      try {
        const found = await fieldsClient.find(mappedTargetFieldId);
        if (isObject(found)) {
          targetField = found;
        }
      } catch (error) {
        warnings.push(
          `[validation-window] Failed to resolve mapped field '${mappedTargetFieldId}' for '${descriptor.sourceFieldApiKey}': ${formatError(
            error,
          )}`,
        );
      }
    }

    if (!targetField) {
      skippedUnmappedCount += 1;
      warnings.push(
        `[validation-window] Could not map source field '${descriptor.sourceItemTypeApiKey ?? descriptor.sourceItemTypeId}.${descriptor.sourceFieldApiKey}' to target field.`,
      );
      continue;
    }

    const targetFieldId = asString(targetField.id);
    const targetFieldApiKey =
      asString(targetField.api_key) ?? descriptor.sourceFieldApiKey;
    if (!targetFieldId) {
      skippedUnmappedCount += 1;
      warnings.push(
        `[validation-window] Target field for '${descriptor.sourceFieldApiKey}' is missing id.`,
      );
      continue;
    }

    const relaxedValidators = buildRelaxedValidators({
      sourceField: descriptor.sourceField,
      itemTypeIdMap: args.itemTypeIdMap,
    });

    const snapshot: FieldValidationSnapshot = {
      sourceItemTypeId: descriptor.sourceItemTypeId,
      sourceItemTypeApiKey: descriptor.sourceItemTypeApiKey,
      sourceFieldId: descriptor.sourceFieldId,
      sourceFieldApiKey: descriptor.sourceFieldApiKey,
      targetItemTypeId,
      targetFieldId,
      targetFieldApiKey,
      targetFieldType: asString(targetField.field_type),
      originalValidators: normalizeValidatorsForPayload(targetField.validators),
      originalAllLocalesRequired: Boolean(targetField.all_locales_required),
    };

    scopedTargetFields.push({
      descriptor,
      snapshot,
      relaxedValidators,
    });
  }

  args.logger.debug('Resolved target fields for validation window scope', {
    inScope: args.scope.sourceFieldEntries.length,
    mapped: scopedTargetFields.length,
    skippedUnmapped: skippedUnmappedCount,
    warnings: warnings.length,
  });

  if (args.scope.sourceFieldEntries.length > 0 && scopedTargetFields.length === 0) {
    warnings.push(
      `[validation-window] No scoped source fields could be mapped to target fields (${args.scope.sourceFieldEntries.length} in scope).`,
    );
  }

  return {
    fields: scopedTargetFields,
    skippedUnmappedCount,
    warnings,
  };
}

export async function suspendFieldValidations(args: {
  client: Client;
  scope: ValidationScope;
  itemTypeIdMap: Map<string, string>;
  fieldIdMap: Map<string, string>;
  retry: RetryOptions;
  updateConcurrency: number;
  logger: DebugLogger;
}): Promise<ValidationSuspendResult> {
  const warnings: string[] = [];
  const fieldsClient = args.client.fields;
  const resolved = await buildScopedTargetFields({
    client: args.client,
    scope: args.scope,
    itemTypeIdMap: args.itemTypeIdMap,
    fieldIdMap: args.fieldIdMap,
    logger: args.logger,
  });
  warnings.push(...args.scope.warnings, ...resolved.warnings);

  if (resolved.fields.length === 0) {
    return {
      ok: true,
      inScopeCount: args.scope.sourceFieldEntries.length,
      suspendedCount: 0,
      skippedUnmappedCount: resolved.skippedUnmappedCount,
      warnings,
      failures: [],
      failureFieldIds: [],
      snapshots: [],
    };
  }

  const firstPassRetryQueue: ScopedTargetField[] = [];
  const firstPassMessages = new Map<string, string>();
  const snapshots = new Map<string, FieldValidationSnapshot>();
  let preservedStructuralValidatorsCount = 0;

  await runWithConcurrency({
    inputs: resolved.fields,
    limit: args.updateConcurrency,
    worker: async (entry) => {
      const payload: JsonObject = {
        validators: cloneJson(entry.relaxedValidators),
        all_locales_required: false,
      };
      if (Object.keys(entry.relaxedValidators).length > 0) {
        preservedStructuralValidatorsCount += 1;
      }

      try {
        await withRetry({
          operationName: 'fields.update.validation-window.suspend',
          options: args.retry,
          fn: async () => fieldsClient.update(entry.snapshot.targetFieldId, payload as any),
        });
        snapshots.set(entry.snapshot.targetFieldId, entry.snapshot);
      } catch (error) {
        firstPassRetryQueue.push(entry);
        firstPassMessages.set(entry.snapshot.targetFieldId, formatError(error));
      }
    },
  });

  const failures: ValidationWindowFailure[] = [];

  for (const entry of firstPassRetryQueue) {
    const payload: JsonObject = {
      validators: cloneJson(entry.relaxedValidators),
      all_locales_required: false,
    };

    try {
      await withRetry({
        operationName: 'fields.update.validation-window.suspend.retry',
        options: args.retry,
        fn: async () => fieldsClient.update(entry.snapshot.targetFieldId, payload as any),
      });
      snapshots.set(entry.snapshot.targetFieldId, entry.snapshot);
    } catch (error) {
      failures.push({
        sourceItemTypeId: entry.descriptor.sourceItemTypeId,
        sourceFieldId: entry.descriptor.sourceFieldId,
        sourceFieldApiKey: entry.descriptor.sourceFieldApiKey,
        targetFieldId: entry.snapshot.targetFieldId,
        message: formatError(error),
        payload,
      });
    }
  }

  if (preservedStructuralValidatorsCount > 0) {
    warnings.push(
      `[validation-window] Preserved structural validators for ${preservedStructuralValidatorsCount} field(s).`,
    );
  }

  if (failures.length > 0) {
    failures.forEach((failure) => {
      args.logger.error('Failed to suspend field validations', {
        sourceItemTypeId: failure.sourceItemTypeId,
        sourceFieldId: failure.sourceFieldId,
        sourceFieldApiKey: failure.sourceFieldApiKey,
        targetFieldId: failure.targetFieldId,
        error: failure.message,
      });
    });
  }

  // Include first-pass errors only when the second pass still fails.
  failures.forEach((failure) => {
    const firstPassError = firstPassMessages.get(failure.targetFieldId);
    if (firstPassError && firstPassError !== failure.message) {
      warnings.push(
        `[validation-window] Retry for field '${failure.targetFieldId}' changed error from '${firstPassError}' to '${failure.message}'.`,
      );
    }
  });

  const failureFieldIds = failures.map((failure) => failure.targetFieldId);

  args.logger.debug('Finished suspending field validations', {
    inScopeCount: args.scope.sourceFieldEntries.length,
    mappedCount: resolved.fields.length,
    suspendedCount: snapshots.size,
    failures: failures.length,
    skippedUnmapped: resolved.skippedUnmappedCount,
  });

  return {
    ok: failures.length === 0,
    inScopeCount: args.scope.sourceFieldEntries.length,
    suspendedCount: snapshots.size,
    skippedUnmappedCount: resolved.skippedUnmappedCount,
    warnings,
    failures,
    failureFieldIds,
    snapshots: Array.from(snapshots.values()),
  };
}

export async function suspendTargetItemTypeFieldValidations(args: {
  client: Client;
  targetItemTypeId: string;
  sourceItemTypeId?: string;
  sourceEnvelope?: RecordExportEnvelope;
  itemTypeIdMap?: Map<string, string>;
  retry: RetryOptions;
  updateConcurrency: number;
  logger: DebugLogger;
}): Promise<ValidationSuspendResult> {
  const warnings: string[] = [];
  const fieldsClient = args.client.fields;
  const listedFields = await fieldsClient.list(args.targetItemTypeId);
  const targetFields = Array.isArray(listedFields)
    ? listedFields.filter(isObject)
    : [];
  const snapshots = new Map<string, FieldValidationSnapshot>();
  const sourceFieldsByApiKey = new Map<string, JsonObject>();
  if (args.sourceEnvelope && args.sourceItemTypeId) {
    args.sourceEnvelope.schema.fields.forEach((field) => {
      if (!isObject(field)) {
        return;
      }
      const itemTypeId = extractEntityId(field.item_type);
      const apiKey = asString(field.api_key);
      if (!itemTypeId || !apiKey) {
        return;
      }
      if (itemTypeId !== args.sourceItemTypeId) {
        return;
      }
      sourceFieldsByApiKey.set(apiKey, field);
    });
  }
  const firstPassRetryQueue: Array<{
    targetField: JsonObject;
    payload: JsonObject;
    snapshot: FieldValidationSnapshot;
  }> = [];
  const failures: ValidationWindowFailure[] = [];

  await runWithConcurrency({
    inputs: targetFields,
    limit: args.updateConcurrency,
    worker: async (targetField) => {
      const targetFieldId = extractEntityId(targetField.id);
      const targetFieldApiKey = asString(targetField.api_key) ?? 'unknown';
      if (!targetFieldId) {
        warnings.push(
          `[validation-window] Skipped target field without id on model '${args.targetItemTypeId}'.`,
        );
        return;
      }

      const sourceFieldForTargetApiKey = sourceFieldsByApiKey.get(targetFieldApiKey);
      const relaxedValidators =
        sourceFieldForTargetApiKey && args.itemTypeIdMap
          ? buildRelaxedValidators({
              sourceField: sourceFieldForTargetApiKey,
              itemTypeIdMap: args.itemTypeIdMap,
            })
          : buildRelaxedValidatorsFromTargetField(targetField);

      const payload: JsonObject = {
        validators: relaxedValidators,
        all_locales_required: false,
      };

      const snapshot: FieldValidationSnapshot = {
        sourceItemTypeId: args.targetItemTypeId,
        sourceItemTypeApiKey: null,
        sourceFieldId: targetFieldId,
        sourceFieldApiKey: targetFieldApiKey,
        targetItemTypeId: args.targetItemTypeId,
        targetFieldId,
        targetFieldApiKey,
        targetFieldType: asString(targetField.field_type),
        originalValidators: normalizeValidatorsForPayload(targetField.validators),
        originalAllLocalesRequired: Boolean(
          (targetField as JsonObject).all_locales_required,
        ),
      };

      try {
        await withRetry({
          operationName: 'fields.update.validation-window.suspend.target-item-type',
          options: args.retry,
          fn: async () => fieldsClient.update(targetFieldId, payload as any),
        });
        snapshots.set(targetFieldId, snapshot);
      } catch (_error) {
        firstPassRetryQueue.push({ targetField, payload, snapshot });
      }
    },
  });

  for (const entry of firstPassRetryQueue) {
    try {
      await withRetry({
        operationName:
          'fields.update.validation-window.suspend.target-item-type.retry',
        options: args.retry,
        fn: async () =>
          fieldsClient.update(entry.snapshot.targetFieldId, entry.payload as any),
      });
      snapshots.set(entry.snapshot.targetFieldId, entry.snapshot);
    } catch (error) {
      failures.push({
        sourceItemTypeId: args.targetItemTypeId,
        sourceFieldId: entry.snapshot.sourceFieldId,
        sourceFieldApiKey: entry.snapshot.sourceFieldApiKey,
        targetFieldId: entry.snapshot.targetFieldId,
        message: formatError(error),
        payload: entry.payload,
      });
    }
  }

  const failureFieldIds = failures.map((failure) => failure.targetFieldId);

  args.logger.debug('Finished target-item-type validation suspension fallback', {
    targetItemTypeId: args.targetItemTypeId,
    inScopeCount: targetFields.length,
    suspendedCount: snapshots.size,
    failures: failures.length,
  });

  return {
    ok: failures.length === 0,
    inScopeCount: targetFields.length,
    suspendedCount: snapshots.size,
    skippedUnmappedCount: 0,
    warnings,
    failures,
    failureFieldIds,
    snapshots: Array.from(snapshots.values()),
  };
}

export async function restoreFieldValidations(args: {
  client: Client;
  snapshots: FieldValidationSnapshot[];
  retry: RetryOptions;
  updateConcurrency: number;
  logger: DebugLogger;
}): Promise<ValidationRestoreResult> {
  const warnings: string[] = [];
  const fieldsClient = args.client.fields;
  const firstPassRetryQueue: FieldValidationSnapshot[] = [];
  const restoredTargetFieldIds = new Set<string>();
  const failures: ValidationWindowFailure[] = [];

  await runWithConcurrency({
    inputs: args.snapshots,
    limit: args.updateConcurrency,
    worker: async (snapshot) => {
      const payload: JsonObject = {
        validators: normalizeValidatorsForPayload(snapshot.originalValidators),
        all_locales_required: snapshot.originalAllLocalesRequired,
      };

      try {
        await withRetry({
          operationName: 'fields.update.validation-window.restore',
          options: args.retry,
          fn: async () => fieldsClient.update(snapshot.targetFieldId, payload as any),
        });
        restoredTargetFieldIds.add(snapshot.targetFieldId);
      } catch (_error) {
        firstPassRetryQueue.push(snapshot);
      }
    },
  });

  for (const snapshot of firstPassRetryQueue) {
    const payload: JsonObject = {
      validators: normalizeValidatorsForPayload(snapshot.originalValidators),
      all_locales_required: snapshot.originalAllLocalesRequired,
    };

    try {
      await withRetry({
        operationName: 'fields.update.validation-window.restore.retry',
        options: args.retry,
        fn: async () => fieldsClient.update(snapshot.targetFieldId, payload as any),
      });
      restoredTargetFieldIds.add(snapshot.targetFieldId);
    } catch (error) {
      failures.push({
        sourceItemTypeId: snapshot.sourceItemTypeId,
        sourceFieldId: snapshot.sourceFieldId,
        sourceFieldApiKey: snapshot.sourceFieldApiKey,
        targetFieldId: snapshot.targetFieldId,
        message: formatError(error),
        payload,
      });
    }
  }

  if (failures.length > 0) {
    failures.forEach((failure) => {
      args.logger.error('Failed to restore field validations', {
        sourceItemTypeId: failure.sourceItemTypeId,
        sourceFieldId: failure.sourceFieldId,
        sourceFieldApiKey: failure.sourceFieldApiKey,
        targetFieldId: failure.targetFieldId,
        error: failure.message,
      });
    });
  }

  const failureFieldIds = failures.map((failure) => failure.targetFieldId);

  args.logger.debug('Finished restoring field validations', {
    requested: args.snapshots.length,
    restored: restoredTargetFieldIds.size,
    failures: failures.length,
  });

  return {
    ok: failures.length === 0,
    restoredCount: restoredTargetFieldIds.size,
    warnings,
    failures,
    failureFieldIds,
  };
}
