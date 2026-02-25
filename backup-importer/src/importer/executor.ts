import { buildClient, type ApiError, type Client } from '@datocms/cma-client-browser';
import { buildAutomaticBlockIdMap } from './blockMapping';
import {
  buildCheckpoint,
  buildEnvelopeFingerprint,
  clearCheckpoint,
  persistCheckpoint,
  readCheckpoint,
} from './checkpoint';
import {
  prepareRecordBootstrapJobs,
  prepareRecordPatchJobs,
  runPreflightImport,
} from './engine';
import { createDebugLogger, type DebugLogger } from './debugLogger';
import {
  buildVerificationWarnings,
  importNonSideEffectConfiguration,
  importPluginsForSchema,
  importSideEffectIntegrations,
  importSiteBaseline,
  replayScheduledActions,
} from './projectConfigImport';
import { downloadImportReport } from './report';
import { extractRecordIdentity } from './rewrite';
import { isRetryableError, withRetry } from './retry';
import { importSchemaCore } from './schemaClone';
import { buildSchemaMapping } from './schemaMapping';
import { importAssetsFromZipFiles } from './assetImport';
import {
  resolveValidationScope,
  restoreFieldValidations,
  suspendFieldValidations,
  suspendTargetItemTypeFieldValidations,
  type FieldValidationSnapshot,
} from './validationWindow';
import type {
  IdMaps,
  ImportExecutionOptions,
  ImportExecutionProgress,
  ImportExecutionReport,
  JsonObject,
  RecordExportEnvelope,
  SchemaFieldSummary,
} from './types';
import { validateRecordExportEnvelope } from './validation';

const SYSTEM_RECORD_KEYS = new Set([
  'id',
  'item_type',
  'meta',
  'created_at',
  'updated_at',
  'is_valid',
  'position',
  'stage',
  'creator',
]);

const RELATIONAL_FIELD_TYPES = new Set([
  'link',
  'links',
  'file',
  'gallery',
  'structured_text',
  'rich_text',
  'modular_content',
  'single_block',
]);

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  if (!error) {
    return 'Unknown error';
  }

  if (typeof error === 'string') {
    return error;
  }

  const maybeApiError = error as ApiError;
  if (maybeApiError?.message) {
    return maybeApiError.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

function extractApiErrorCode(error: unknown): string | null {
  const apiError = error as ApiError & {
    errors?: Array<{ code?: string }>;
    findError?: (code: string) => unknown;
  };

  const firstCode = apiError?.errors?.[0]?.code;
  if (typeof firstCode === 'string') {
    return firstCode;
  }

  const knownCodes = [
    'UNPUBLISHED_LINK',
    'UNPUBLISHED_PARENT',
    'STALE_ITEM_VERSION',
  ];

  for (const code of knownCodes) {
    if (apiError?.findError?.(code)) {
      return code;
    }
  }

  return null;
}

function mergeMaps(
  base: Map<string, string>,
  incoming?: Map<string, string>,
): Map<string, string> {
  const merged = new Map(base);
  if (!incoming) {
    return merged;
  }

  incoming.forEach((value, key) => merged.set(key, value));
  return merged;
}

function fieldDefinitionsByApiKey(
  envelope: RecordExportEnvelope,
  sourceItemTypeId: string,
): Map<string, SchemaFieldSummary> {
  const definitions = envelope.schema.fieldsByItemType[sourceItemTypeId] ?? [];
  const result = new Map<string, SchemaFieldSummary>();

  definitions.forEach((definition) => {
    result.set(definition.apiKey, definition);
  });

  return result;
}

function mapEntityId(
  value: unknown,
  idMap: Map<string, string>,
): { resolved: boolean; value: unknown } {
  if (typeof value === 'string') {
    const mapped = idMap.get(value);
    if (!mapped) {
      return { resolved: false, value };
    }
    return { resolved: true, value: mapped };
  }

  if (!isObject(value)) {
    return { resolved: false, value };
  }

  const id = asString(value.id);
  if (!id) {
    return { resolved: false, value };
  }

  const mapped = idMap.get(id);
  if (!mapped) {
    return { resolved: false, value };
  }

  return { resolved: true, value: { ...value, id: mapped } };
}

function rewriteSeoLocaleValueForBootstrap(args: {
  value: unknown;
  uploadIdMap: Map<string, string>;
  skipAssetFields?: boolean;
}): unknown {
  if (!isObject(args.value)) {
    return args.value;
  }

  const next: JsonObject = { ...args.value };
  if (!('image' in next)) {
    return next;
  }

  if (args.skipAssetFields) {
    next.image = null;
    return next;
  }

  const mapped = mapEntityId(next.image, args.uploadIdMap);
  next.image = mapped.resolved ? mapped.value : null;
  return next;
}

function rewriteSeoBootstrapValue(args: {
  value: unknown;
  localized: boolean;
  uploadIdMap: Map<string, string>;
  skipAssetFields?: boolean;
}): unknown {
  if (args.localized) {
    if (!isObject(args.value)) {
      return args.value;
    }

    const localizedValue: JsonObject = {};
    for (const [locale, localeValue] of Object.entries(args.value)) {
      localizedValue[locale] = rewriteSeoLocaleValueForBootstrap({
        value: localeValue,
        uploadIdMap: args.uploadIdMap,
        skipAssetFields: args.skipAssetFields,
      });
    }

    return localizedValue;
  }

  return rewriteSeoLocaleValueForBootstrap({
    value: args.value,
    uploadIdMap: args.uploadIdMap,
    skipAssetFields: args.skipAssetFields,
  });
}

function resolveRelationalBootstrapValue(args: {
  fieldType: string;
  localized: boolean;
  value: unknown;
  idMaps: IdMaps;
}): { resolved: boolean; value: unknown } {
  if (args.localized) {
    if (!isObject(args.value)) {
      return { resolved: false, value: args.value };
    }

    const localizedResult: Record<string, unknown> = {};
    for (const [locale, localeValue] of Object.entries(args.value)) {
      const resolvedLocale = resolveRelationalBootstrapValue({
        ...args,
        localized: false,
        value: localeValue,
      });
      if (!resolvedLocale.resolved) {
        return { resolved: false, value: args.value };
      }
      localizedResult[locale] = resolvedLocale.value;
    }

    return { resolved: true, value: localizedResult };
  }

  switch (args.fieldType) {
    case 'link':
      return mapEntityId(args.value, args.idMaps.recordIds);
    case 'links':
      if (!Array.isArray(args.value)) {
        return { resolved: false, value: args.value };
      }
      return args.value.reduce(
        (acc, entry) => {
          if (!acc.resolved) {
            return acc;
          }

          const mapped = mapEntityId(entry, args.idMaps.recordIds);
          if (!mapped.resolved) {
            return { resolved: false, value: args.value };
          }

          (acc.value as unknown[]).push(mapped.value);
          return acc;
        },
        { resolved: true, value: [] as unknown[] },
      );
    case 'file':
      return mapEntityId(args.value, args.idMaps.uploadIds);
    case 'gallery':
      if (!Array.isArray(args.value)) {
        return { resolved: false, value: args.value };
      }
      return args.value.reduce(
        (acc, entry) => {
          if (!acc.resolved) {
            return acc;
          }

          const mapped = mapEntityId(entry, args.idMaps.uploadIds);
          if (!mapped.resolved) {
            return { resolved: false, value: args.value };
          }

          (acc.value as unknown[]).push(mapped.value);
          return acc;
        },
        { resolved: true, value: [] as unknown[] },
      );
    default:
      return { resolved: false, value: args.value };
  }
}

export function buildBootstrapCreatePayload(args: {
  sourceRecord: JsonObject;
  sourceItemTypeId: string;
  targetItemTypeId: string;
  envelope: RecordExportEnvelope;
  includeResolvedRelations?: boolean;
  idMaps?: IdMaps;
  skipAssetFields?: boolean;
}): JsonObject {
  const payload: JsonObject = {
    item_type: {
      type: 'item_type',
      id: args.targetItemTypeId,
    },
  };

  const definitions = fieldDefinitionsByApiKey(args.envelope, args.sourceItemTypeId);
  const processedFields = new Set<string>();

  for (const definition of definitions.values()) {
    processedFields.add(definition.apiKey);

    if (!(definition.apiKey in args.sourceRecord)) {
      continue;
    }

    const sourceValue = args.sourceRecord[definition.apiKey];

    if (definition.fieldType === 'seo') {
      payload[definition.apiKey] = rewriteSeoBootstrapValue({
        value: sourceValue,
        localized: definition.localized,
        uploadIdMap: args.idMaps?.uploadIds ?? new Map<string, string>(),
        skipAssetFields: args.skipAssetFields,
      });
      continue;
    }

    if (!RELATIONAL_FIELD_TYPES.has(definition.fieldType)) {
      payload[definition.apiKey] = sourceValue;
      continue;
    }

    if (args.skipAssetFields) {
      if (definition.fieldType === 'file') {
        payload[definition.apiKey] = null;
        continue;
      }
      if (definition.fieldType === 'gallery') {
        payload[definition.apiKey] = [];
        continue;
      }
    }

    if (!args.includeResolvedRelations || !args.idMaps) {
      continue;
    }

    const resolved = resolveRelationalBootstrapValue({
      fieldType: definition.fieldType,
      localized: definition.localized,
      value: sourceValue,
      idMaps: args.idMaps,
    });

    if (resolved.resolved) {
      payload[definition.apiKey] = resolved.value;
    }
  }

  for (const [key, value] of Object.entries(args.sourceRecord)) {
    if (SYSTEM_RECORD_KEYS.has(key) || processedFields.has(key)) {
      continue;
    }

    payload[key] = value;
  }

  return payload;
}

function defaultOptions(
  options: Partial<ImportExecutionOptions>,
): ImportExecutionOptions {
  return {
    strictMode: options.strictMode ?? true,
    skipAssets: options.skipAssets ?? false,
    skipSchemaImport: options.skipSchemaImport ?? false,
    skipSiteSettingsImport: options.skipSiteSettingsImport ?? false,
    skipPluginImport: options.skipPluginImport ?? false,
    skipWorkflowImport: options.skipWorkflowImport ?? false,
    skipRoleImport: options.skipRoleImport ?? false,
    skipModelFilterImport: options.skipModelFilterImport ?? false,
    skipMenuItemImport: options.skipMenuItemImport ?? false,
    skipSchemaMenuItemImport: options.skipSchemaMenuItemImport ?? false,
    skipScheduledActionsImport: options.skipScheduledActionsImport ?? false,
    skipWebhookImport: options.skipWebhookImport ?? false,
    skipBuildTriggerImport: options.skipBuildTriggerImport ?? false,
    addOnlyDifferences: options.addOnlyDifferences ?? true,
    debugLogging: options.debugLogging ?? false,
    retry: {
      maxAttempts: options.retry?.maxAttempts ?? 5,
      baseDelayMs: options.retry?.baseDelayMs ?? 500,
      maxDelayMs: options.retry?.maxDelayMs ?? 6000,
    },
    concurrency: {
      create: options.concurrency?.create ?? 2,
      update: options.concurrency?.update ?? 4,
      publish: options.concurrency?.publish ?? 4,
      upload: options.concurrency?.upload ?? 2,
    },
    publishAfterImport: options.publishAfterImport ?? true,
    resumeFromCheckpoint: options.resumeFromCheckpoint ?? true,
    downloadReportAfterRun: options.downloadReportAfterRun ?? false,
    uploadIdMap: options.uploadIdMap,
    blockIdMap: options.blockIdMap,
  };
}

function createInitialReport(
  options: ImportExecutionOptions,
): ImportExecutionReport {
  return {
    ok: false,
    strictMode: options.strictMode,
    addOnlyDifferencesEnabled: options.addOnlyDifferences,
    validationWindowEnabled: true,
    validationFieldsInScope: 0,
    validationFieldsSuspended: 0,
    validationFieldsRestored: 0,
    validationSuspendFailures: 0,
    validationRestoreFailures: 0,
    validationSuspendFailureFieldIds: [],
    validationRestoreFailureFieldIds: [],
    existingRecordMatches: 0,
    skippedExistingRecords: 0,
    skippedExistingByResource: {},
    errors: [],
    warnings: [],
    preflight: null,
    schemaMapping: null,
    assetImport: null,
    createdCount: 0,
    updatedCount: 0,
    publishedCount: 0,
    treeUpdatedCount: 0,
    skippedPatchCount: 0,
    createFailures: [],
    updateFailures: [],
    publishFailures: [],
    treeFailures: [],
    unresolvedSummary: {
      records: 0,
      uploads: 0,
      blocks: 0,
    },
    itemTypeIdMap: new Map<string, string>(),
    fieldIdMap: new Map<string, string>(),
    fieldsetIdMap: new Map<string, string>(),
    recordIdMap: new Map<string, string>(),
    uploadIdMap: new Map<string, string>(),
    resumedFromCheckpoint: false,
    checkpointFingerprint: null,
  };
}

function bumpSkippedExistingByResource(
  report: ImportExecutionReport,
  resource: string,
  increment = 1,
) {
  if (increment <= 0) {
    return;
  }

  report.skippedExistingByResource[resource] =
    (report.skippedExistingByResource[resource] ?? 0) + increment;
}

function mergeSkippedExistingByResource(
  report: ImportExecutionReport,
  incoming: Record<string, number> | undefined,
) {
  if (!incoming) {
    return;
  }

  Object.entries(incoming).forEach(([resource, count]) => {
    bumpSkippedExistingByResource(report, resource, count);
  });
}

function indexSourceRecordsById(envelope: RecordExportEnvelope) {
  const byId = new Map<string, JsonObject>();

  envelope.records.forEach((record) => {
    const sourceRecordId = extractRecordIdentity(record).sourceRecordId;
    if (!sourceRecordId) {
      return;
    }

    byId.set(sourceRecordId, record);
  });

  return byId;
}

function collectSourceBlockRecordIds(envelope: RecordExportEnvelope): Set<string> {
  const sourceItemTypesById = indexSourceItemTypesById(envelope);
  const ids = new Set<string>();

  envelope.records.forEach((record) => {
    const { sourceRecordId, sourceItemTypeId } = extractRecordIdentity(record);
    if (!sourceRecordId || !sourceItemTypeId) {
      return;
    }

    const sourceItemType = sourceItemTypesById.get(sourceItemTypeId);
    if (sourceItemType?.modular_block) {
      ids.add(sourceRecordId);
    }
  });

  return ids;
}

async function createClient(args: {
  apiToken: string;
  environment: string;
}): Promise<Client> {
  return buildClient({
    apiToken: args.apiToken,
    environment: args.environment,
  });
}

async function runWithConcurrency<T>(args: {
  inputs: T[];
  limit: number;
  worker: (input: T, index: number) => Promise<void>;
}): Promise<void> {
  if (!args.inputs.length) {
    return;
  }

  let cursor = 0;
  const safeLimit = Math.max(1, Math.min(args.limit, args.inputs.length));

  const runners = Array.from({ length: safeLimit }, async () => {
    while (cursor < args.inputs.length) {
      const index = cursor;
      cursor += 1;

      const input = args.inputs[index];
      await args.worker(input, index);
    }
  });

  await Promise.all(runners);
}

function shouldRetryPublishLater(error: unknown): boolean {
  const code = extractApiErrorCode(error);
  if (code === 'UNPUBLISHED_LINK' || code === 'UNPUBLISHED_PARENT') {
    return true;
  }

  const message = formatError(error).toLowerCase();
  return (
    message.includes('unpublished') ||
    message.includes('parent') ||
    message.includes('dependency')
  );
}

function isSourceRecordPublished(record: JsonObject): boolean {
  const meta = isObject(record.meta) ? record.meta : null;
  const stage = asString(record.stage);
  const status = meta ? asString(meta.status) : null;
  const isPublishedFlag =
    meta && 'published' in meta ? Boolean(meta.published) : null;

  if (stage === 'published') {
    return true;
  }

  if (status && ['published', 'updated'].includes(status)) {
    return true;
  }

  if (typeof isPublishedFlag === 'boolean') {
    return isPublishedFlag;
  }

  return false;
}

function shouldAttemptValidationFallbackForCreate(error: unknown): boolean {
  const message = formatError(error);
  return (
    message.includes('INVALID_FIELD') &&
    (message.includes('VALIDATION_') || message.includes('INVALID_FORMAT'))
  );
}

function extractTreeUpdatePayload(args: {
  sourceRecord: JsonObject;
  recordIdMap: Map<string, string>;
}): { payload: JsonObject; unresolved: string[] } {
  const payload: JsonObject = {};
  const unresolved: string[] = [];

  if ('position' in args.sourceRecord) {
    const position = asNumber(args.sourceRecord.position);
    if (position !== null) {
      payload.position = position;
    }
  }

  if ('parent_id' in args.sourceRecord) {
    const sourceParentId = asString(args.sourceRecord.parent_id);
    if (sourceParentId) {
      const targetParentId = args.recordIdMap.get(sourceParentId);
      if (!targetParentId) {
        unresolved.push(sourceParentId);
      } else {
        payload.parent_id = targetParentId;
      }
    } else {
      payload.parent_id = null;
    }
  }

  return { payload, unresolved };
}

function dedupeMessages(messages: string[]): string[] {
  return Array.from(new Set(messages));
}

type RecordItemTypeMappingCheckResult = {
  warnings: string[];
  errors: string[];
  repairedMappings: number;
};

function indexSourceItemTypesById(envelope: RecordExportEnvelope): Map<string, JsonObject> {
  return new Map(
    envelope.schema.itemTypes
      .filter(isObject)
      .map((itemType) => [asString(itemType.id), itemType] as const)
      .filter((entry): entry is [string, JsonObject] => Boolean(entry[0])),
  );
}

async function validateAndRepairRecordItemTypeMappings(args: {
  client: Client;
  envelope: RecordExportEnvelope;
  itemTypeIdMap: Map<string, string>;
  logger: DebugLogger;
}): Promise<RecordItemTypeMappingCheckResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const sourceUsageCounts = new Map<string, number>();
  const sourceItemTypesById = indexSourceItemTypesById(args.envelope);
  let skippedBlockRecords = 0;
  let repairedMappings = 0;

  args.envelope.records.forEach((record) => {
    const { sourceItemTypeId } = extractRecordIdentity(record);
    if (!sourceItemTypeId) {
      return;
    }

    const sourceItemType = sourceItemTypesById.get(sourceItemTypeId);
    if (sourceItemType?.modular_block) {
      skippedBlockRecords += 1;
      return;
    }

    sourceUsageCounts.set(
      sourceItemTypeId,
      (sourceUsageCounts.get(sourceItemTypeId) ?? 0) + 1,
    );
  });

  if (skippedBlockRecords > 0) {
    warnings.push(
      `Skipped ${skippedBlockRecords} modular block payload record(s) from top-level record model validation.`,
    );
  }

  if (sourceUsageCounts.size === 0) {
    return { warnings, errors, repairedMappings };
  }

  const targetItemTypes = (await args.client.itemTypes.list()).filter(
    isObject,
  ) as JsonObject[];
  const targetItemTypeById = new Map(
    targetItemTypes
      .map((itemType) => [asString(itemType.id), itemType] as const)
      .filter((entry): entry is [string, JsonObject] => Boolean(entry[0])),
  );
  const targetItemTypeIdByApiKey = new Map(
    targetItemTypes
      .map((itemType) => [asString(itemType.api_key), asString(itemType.id)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
  );

  for (const [sourceItemTypeId, usageCount] of sourceUsageCounts.entries()) {
    const sourceItemType = sourceItemTypesById.get(sourceItemTypeId);
    const sourceApiKey =
      args.envelope.schema.itemTypeIdToApiKey[sourceItemTypeId] ??
      asString(sourceItemType?.api_key);
    const mappedTargetId = args.itemTypeIdMap.get(sourceItemTypeId);
    let resolvedTargetId = mappedTargetId ?? null;

    if (!resolvedTargetId || !targetItemTypeById.has(resolvedTargetId)) {
      if (sourceApiKey) {
        const byApiKey = targetItemTypeIdByApiKey.get(sourceApiKey) ?? null;
        if (byApiKey) {
          resolvedTargetId = byApiKey;
          args.itemTypeIdMap.set(sourceItemTypeId, byApiKey);
          repairedMappings += 1;
          warnings.push(
            `Repaired model mapping for records: source model '${sourceApiKey}' (${sourceItemTypeId}) -> target '${byApiKey}'.`,
          );
          continue;
        }
      }

      errors.push(
        `Cannot map record model '${sourceApiKey ?? sourceItemTypeId}' (${sourceItemTypeId}) used by ${usageCount} record(s): model not found in target schema.`,
      );
      continue;
    }

    const targetItemType = targetItemTypeById.get(resolvedTargetId);
    const targetIsBlock = Boolean(targetItemType?.modular_block);
    if (targetIsBlock) {
      warnings.push(
        `Record model mapping points to modular block model '${sourceApiKey ?? sourceItemTypeId}' (${sourceItemTypeId} -> ${resolvedTargetId}) for ${usageCount} record(s); creates may fail if treated as top-level records.`,
      );
    }
  }

  args.logger.debug('Validated record model mappings before bootstrap', {
    sourceModelCountInRecords: sourceUsageCounts.size,
    targetModelCount: targetItemTypes.length,
    repairedMappings,
    warnings: warnings.length,
    errors: errors.length,
  });

  return { warnings, errors, repairedMappings };
}

async function resolveTargetProjectId(client: Client): Promise<string | null> {
  try {
    const site = await (client.site as { find?: () => Promise<unknown> }).find?.();
    if (!site || typeof site !== 'object') {
      return null;
    }

    return asString((site as { id?: unknown }).id);
  } catch (_error) {
    return null;
  }
}

async function scanExistingRecordsBySourceId(args: {
  client: Client;
  sourceRecordIds: string[];
  chunkSize: number;
  logger: DebugLogger;
}): Promise<{ matchedSourceIds: Set<string>; warnings: string[] }> {
  const warnings: string[] = [];
  const matchedSourceIds = new Set<string>();
  const itemsClient = args.client.items as {
    list?: (query: unknown) => Promise<unknown>;
  };

  if (typeof itemsClient.list !== 'function') {
    warnings.push(
      '[add-only][records] Skipped existing-record scan: client.items.list is unavailable.',
    );
    return { matchedSourceIds, warnings };
  }

  for (let start = 0; start < args.sourceRecordIds.length; start += args.chunkSize) {
    const chunk = args.sourceRecordIds.slice(start, start + args.chunkSize);
    if (chunk.length === 0) {
      continue;
    }

    try {
      const response = await itemsClient.list({
        filter: {
          ids: chunk.join(','),
        },
        page: {
          limit: Math.min(500, Math.max(1, chunk.length)),
        },
      } as any);
      const chunkSet = new Set(chunk);
      const records = Array.isArray(response) ? response : [];

      records.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }

        const id = asString((entry as { id?: unknown }).id);
        if (!id || !chunkSet.has(id)) {
          return;
        }

        matchedSourceIds.add(id);
      });
    } catch (error) {
      const message = formatError(error);
      warnings.push(
        `[add-only][records] Existing-record scan chunk failed (${start}-${start + chunk.length - 1}): ${message}`,
      );
      args.logger.warn('Existing-record scan chunk failed', {
        chunkStart: start,
        chunkSize: chunk.length,
        error: message,
      });
    }
  }

  return { matchedSourceIds, warnings };
}

export async function executeImportFromEnvelope(args: {
  envelopeRaw: unknown;
  apiToken: string;
  environment: string;
  options?: Partial<ImportExecutionOptions>;
  assetZipFiles?: File[];
  onProgress?: (progress: ImportExecutionProgress) => void;
}): Promise<ImportExecutionReport> {
  const options = defaultOptions(args.options ?? {});
  const logger = createDebugLogger({ enabled: options.debugLogging });
  const executorLogger = logger.child('executor');
  const report = createInitialReport(options);
  const emitProgress = (progress: ImportExecutionProgress) => {
    args.onProgress?.(progress);
    executorLogger.debug('Phase progress', progress);
  };

  executorLogger.debug('Starting import execution', {
    strictMode: options.strictMode,
    skipAssets: options.skipAssets,
    skipSchemaImport: options.skipSchemaImport,
    skipSiteSettingsImport: options.skipSiteSettingsImport,
    skipPluginImport: options.skipPluginImport,
    skipWorkflowImport: options.skipWorkflowImport,
    skipRoleImport: options.skipRoleImport,
    skipModelFilterImport: options.skipModelFilterImport,
    skipMenuItemImport: options.skipMenuItemImport,
    skipSchemaMenuItemImport: options.skipSchemaMenuItemImport,
    skipScheduledActionsImport: options.skipScheduledActionsImport,
    skipWebhookImport: options.skipWebhookImport,
    skipBuildTriggerImport: options.skipBuildTriggerImport,
    addOnlyDifferences: options.addOnlyDifferences,
    debugLogging: options.debugLogging,
    publishAfterImport: options.publishAfterImport,
    resumeFromCheckpoint: options.resumeFromCheckpoint,
    providedAssetZipFiles: args.assetZipFiles?.length ?? 0,
  });

  emitProgress({
    phase: 'validate',
    finished: 0,
    total: 1,
    message: 'Validating export envelope',
  });

  const validation = validateRecordExportEnvelope(args.envelopeRaw);
  if (!validation.envelope) {
    report.errors.push(...validation.errors);
    report.warnings.push(...validation.warnings);
    executorLogger.error('Validation failed before execution', {
      errors: validation.errors.length,
      warnings: validation.warnings.length,
    });
    return report;
  }

  const envelope = validation.envelope;
  report.warnings.push(...validation.warnings);

  const fingerprint = buildEnvelopeFingerprint(envelope);
  report.checkpointFingerprint = fingerprint;

  const createdSourceRecordIds = new Set<string>();
  const updatedSourceRecordIds = new Set<string>();
  const publishedSourceRecordIds = new Set<string>();
  const treeUpdatedSourceRecordIds = new Set<string>();
  const existingMatchedRecordIds = new Set<string>();
  let itemTypeIdMap = new Map<string, string>();
  let fieldIdMap = new Map<string, string>();
  let fieldsetIdMap = new Map<string, string>();
  let blockIdMap = options.blockIdMap ?? new Map<string, string>();

  if (options.resumeFromCheckpoint) {
    const checkpoint = readCheckpoint(fingerprint);
    if (checkpoint && checkpoint.strictMode === options.strictMode) {
      report.resumedFromCheckpoint = true;
      itemTypeIdMap = new Map(checkpoint.itemTypeIdMap ?? []);
      fieldIdMap = new Map(checkpoint.fieldIdMap ?? []);
      fieldsetIdMap = new Map(checkpoint.fieldsetIdMap ?? []);
      report.recordIdMap = new Map(checkpoint.recordIdMap);
      report.uploadIdMap = mergeMaps(
        new Map(checkpoint.uploadIdMap),
        options.uploadIdMap,
      );
      blockIdMap = mergeMaps(new Map(checkpoint.blockIdMap), blockIdMap);
      checkpoint.createdSourceRecordIds.forEach((id) => createdSourceRecordIds.add(id));
      checkpoint.updatedSourceRecordIds.forEach((id) => updatedSourceRecordIds.add(id));
      checkpoint.publishedSourceRecordIds.forEach((id) =>
        publishedSourceRecordIds.add(id),
      );
      checkpoint.treeUpdatedSourceRecordIds.forEach((id) =>
        treeUpdatedSourceRecordIds.add(id),
      );
      report.warnings.push(
        `Resumed from checkpoint saved at ${checkpoint.savedAt} (${checkpoint.phase}).`,
      );
    } else {
      report.uploadIdMap = mergeMaps(new Map<string, string>(), options.uploadIdMap);
    }
  } else {
    report.uploadIdMap = mergeMaps(new Map<string, string>(), options.uploadIdMap);
  }

  report.itemTypeIdMap = new Map(itemTypeIdMap);
  report.fieldIdMap = new Map(fieldIdMap);
  report.fieldsetIdMap = new Map(fieldsetIdMap);

  const persist = (phase: ImportExecutionProgress['phase']) => {
    if (!options.resumeFromCheckpoint) {
      return;
    }

    persistCheckpoint(
      buildCheckpoint({
        fingerprint,
        strictMode: options.strictMode,
        phase,
        itemTypeIdMap,
        fieldIdMap,
        fieldsetIdMap,
        recordIdMap: report.recordIdMap,
        uploadIdMap: report.uploadIdMap,
        blockIdMap,
        createdSourceRecordIds,
        updatedSourceRecordIds,
        publishedSourceRecordIds,
        treeUpdatedSourceRecordIds,
      }),
    );
  };

  const client = await createClient({
    apiToken: args.apiToken,
    environment: args.environment,
  });

  const autoBlockMapping = buildAutomaticBlockIdMap({
    envelope,
    existingMap: blockIdMap,
  });
  blockIdMap = autoBlockMapping.blockIdMap;

  if (autoBlockMapping.inferredCount > 0) {
    report.warnings.push(
      `Auto-mapped ${autoBlockMapping.inferredCount} embedded block IDs from payload.`,
    );
  }
  if (autoBlockMapping.unresolvedReferenceCount > 0) {
    report.warnings.push(
      `${autoBlockMapping.unresolvedReferenceCount} block reference(s) could not be auto-mapped from embedded payload.`,
    );
  }

  if (options.skipSiteSettingsImport) {
    emitProgress({
      phase: 'site-baseline',
      finished: 1,
      total: 1,
      message: 'Skipping site baseline settings by option',
    });
    report.warnings.push('Skipped site settings import phase by option.');
    executorLogger.warn('Site baseline phase skipped by option');
  } else {
    const siteBaseline = await importSiteBaseline({
      client,
      envelope,
      logger,
      onProgress: emitProgress,
    });
    report.warnings.push(...siteBaseline.warnings);
    executorLogger.debug('Site baseline phase finished', {
      warnings: siteBaseline.warnings.length,
      failures: siteBaseline.failures.length,
    });
    if (siteBaseline.failures.length > 0) {
      report.errors.push(
        ...siteBaseline.failures.map(
          (failure) => `[${failure.resource}] ${failure.message}`,
        ),
      );
      report.errors = dedupeMessages(report.errors);
      executorLogger.error('Site baseline failed; aborting import', {
        failures: siteBaseline.failures,
      });
      persist('site-baseline');
      return report;
    }
  }
  persist('site-baseline');

  if (options.skipPluginImport) {
    emitProgress({
      phase: 'config-import',
      finished: 1,
      total: 1,
      message: 'Skipping pre-schema plugin import by option',
    });
    report.warnings.push('Skipped plugin import phase by option.');
    executorLogger.warn('Pre-schema plugin import skipped by option');
  } else {
    const preSchemaPlugins = await importPluginsForSchema({
      client,
      envelope,
      addOnlyDifferences: options.addOnlyDifferences,
      logger,
      onProgress: emitProgress,
    });
    report.warnings.push(...preSchemaPlugins.warnings);
    mergeSkippedExistingByResource(report, preSchemaPlugins.addOnlySkippedByResource);
    if (preSchemaPlugins.failures.length > 0) {
      executorLogger.warn('Pre-schema plugin import completed with failures', {
        failures: preSchemaPlugins.failures.length,
      });
    } else {
      executorLogger.debug('Pre-schema plugin import completed', {
        warnings: preSchemaPlugins.warnings.length,
      });
    }
  }

  const schemaMapping = options.skipSchemaImport
    ? await (async () => {
        emitProgress({
          phase: 'schema-skeleton',
          finished: 1,
          total: 1,
          message: 'Skipping schema import phases and mapping existing target schema',
        });
        report.warnings.push(
          'Skipped schema import phases by option; using existing target schema mappings only.',
        );
        executorLogger.warn('Schema import phases skipped by option');
        return buildSchemaMapping(client, envelope);
      })()
    : await importSchemaCore({
        client,
        envelope,
        addOnlyDifferences: options.addOnlyDifferences,
        initialItemTypeIdMap: itemTypeIdMap,
        initialFieldIdMap: fieldIdMap,
        initialFieldsetIdMap: fieldsetIdMap,
        logger,
        onProgress: emitProgress,
      });
  report.schemaMapping = schemaMapping;
  report.warnings.push(...schemaMapping.itemTypes.warnings);
  report.warnings.push(...schemaMapping.fieldsets.warnings);
  report.warnings.push(...schemaMapping.fields.warnings);
  mergeSkippedExistingByResource(report, schemaMapping.addOnlySkippedByResource);

  itemTypeIdMap = schemaMapping.itemTypes.itemTypeIdMap;
  fieldIdMap = schemaMapping.fields.fieldIdMap;
  fieldsetIdMap = schemaMapping.fieldsets.fieldsetIdMap;
  report.itemTypeIdMap = new Map(itemTypeIdMap);
  report.fieldIdMap = new Map(fieldIdMap);
  report.fieldsetIdMap = new Map(fieldsetIdMap);
  executorLogger.debug('Schema import phase finished', {
    itemTypeMappings: itemTypeIdMap.size,
    fieldMappings: fieldIdMap.size,
    fieldsetMappings: fieldsetIdMap.size,
    itemTypeMissing: schemaMapping.itemTypes.missing.length,
    fieldMissing: schemaMapping.fields.missing.length,
    fieldsetMissing: schemaMapping.fieldsets.missing.length,
  });

  const schemaMissingCount =
    schemaMapping.itemTypes.missing.length +
    schemaMapping.fieldsets.missing.length +
    schemaMapping.fields.missing.length;
  if (schemaMissingCount > 0) {
    report.errors.push(
      `Schema import has ${schemaMissingCount} blocking issue(s) across models/fieldsets/fields.`,
    );
    report.errors.push(
      ...schemaMapping.itemTypes.missing.map(
        (entry) =>
          `Model '${entry.sourceItemTypeId}' (${entry.sourceApiKey ?? 'unknown api_key'}): ${entry.reason}`,
      ),
    );
    report.errors.push(
      ...schemaMapping.fieldsets.missing.map(
        (entry) =>
          `Fieldset '${entry.sourceFieldsetId}' (${entry.sourceItemTypeId ?? 'unknown model'}): ${entry.reason}`,
      ),
    );
    report.errors.push(
      ...schemaMapping.fields.missing.map(
        (entry) =>
          `Field '${entry.sourceItemTypeApiKey ?? entry.sourceItemTypeId}.${entry.sourceFieldApiKey}': ${entry.reason}`,
      ),
    );
    report.errors = dedupeMessages(report.errors);
    executorLogger.error('Schema import produced blocking issues', {
      schemaMissingCount,
      itemTypeMissing: schemaMapping.itemTypes.missing.length,
      fieldsetMissing: schemaMapping.fieldsets.missing.length,
      fieldMissing: schemaMapping.fields.missing.length,
    });
    persist('schema-finalize');
    return report;
  }

  persist('schema-finalize');

  const nonSideEffectConfig = await importNonSideEffectConfiguration({
    client,
    envelope,
    itemTypeIdMap,
    fieldIdMap,
    createdItemTypeSourceIds: new Set(
      schemaMapping.createdItemTypeSourceIds ?? [],
    ),
    addOnlyDifferences: options.addOnlyDifferences,
    logger,
    onProgress: emitProgress,
  }, {
    includePlugins: false,
    includeWorkflows: !options.skipWorkflowImport,
    includeRoles: !options.skipRoleImport,
    includeModelFilters: !options.skipModelFilterImport,
    includeMenuItems: !options.skipMenuItemImport,
    includeSchemaMenuItems: !options.skipSchemaMenuItemImport,
  });
  report.warnings.push(...nonSideEffectConfig.warnings);
  mergeSkippedExistingByResource(report, nonSideEffectConfig.addOnlySkippedByResource);
  if (nonSideEffectConfig.failures.length > 0) {
    executorLogger.warn('Configuration phase completed with best-effort failures', {
      failures: nonSideEffectConfig.failures.length,
    });
  }
  persist('config-import');

  if (options.skipAssets) {
    if (args.assetZipFiles?.length) {
      report.warnings.push(
        `Skip assets enabled: ignored ${args.assetZipFiles.length} provided asset ZIP file(s).`,
      );
    } else {
      report.warnings.push('Skip assets enabled: asset import step was skipped.');
    }
    executorLogger.debug('Asset import step skipped by option', {
      providedAssetZipFiles: args.assetZipFiles?.length ?? 0,
    });
  } else if (args.assetZipFiles?.length) {
    emitProgress({
      phase: 'asset-import',
      finished: 0,
      total: args.assetZipFiles.length,
      message: 'Importing asset ZIP files',
    });

    const assetImport = await importAssetsFromZipFiles({
      client,
      zipFiles: args.assetZipFiles,
      strictMode: options.strictMode,
      retry: options.retry,
      uploadConcurrency: options.concurrency.upload,
      scanExistingUploads: true,
      initialUploadIdMap: report.uploadIdMap,
      logger,
      onProgress: (progress) => {
        emitProgress({
          phase: 'asset-import',
          finished: progress.finished,
          total: progress.total,
          message: progress.message,
        });
      },
    });

    report.assetImport = assetImport;
    report.uploadIdMap = assetImport.uploadIdMap;
    report.warnings.push(...assetImport.warnings);
    if (options.addOnlyDifferences && assetImport.skippedAssets > 0) {
      bumpSkippedExistingByResource(report, 'assets', assetImport.skippedAssets);
    }
    executorLogger.debug('Asset import phase completed', {
      ok: assetImport.ok,
      processedZipFiles: assetImport.processedZipFiles,
      importedAssets: assetImport.importedAssets,
      skippedAssets: assetImport.skippedAssets,
      failures: assetImport.failures.length,
      warnings: assetImport.warnings.length,
      errors: assetImport.errors.length,
      uploadIdMapSize: assetImport.uploadIdMap.size,
    });

    if (!assetImport.ok && options.strictMode) {
      report.errors.push(...assetImport.errors);
      report.errors = dedupeMessages(report.errors);
      executorLogger.error('Asset import failed in strict mode', {
        errors: assetImport.errors,
      });
      persist('asset-import');
      return report;
    }
  }

  const sourceRecordsById = indexSourceRecordsById(envelope);
  const sourceBlockRecordIds = collectSourceBlockRecordIds(envelope);
  const sourceRecordIds = envelope.records
    .map((record) => {
      const { sourceRecordId } = extractRecordIdentity(record);
      return sourceRecordId;
    })
    .filter((sourceRecordId): sourceRecordId is string => {
      if (!sourceRecordId) {
        return false;
      }

      return !sourceBlockRecordIds.has(sourceRecordId);
    });

  if (sourceBlockRecordIds.size > 0) {
    const warningMessage = `Detected ${sourceBlockRecordIds.size} modular block payload record(s); excluding them from top-level record create/update phases.`;
    report.warnings.push(warningMessage);
    executorLogger.warn(warningMessage);
  }

  let existingRecordScanDone = false;
  if (options.addOnlyDifferences && sourceRecordIds.length > 0) {
    emitProgress({
      phase: 'bootstrap-create',
      finished: 0,
      total: sourceRecordIds.length,
      message: 'Scanning existing target records by source ID',
    });

    const recordScan = await scanExistingRecordsBySourceId({
      client,
      sourceRecordIds,
      chunkSize: 100,
      logger: executorLogger,
    });
    report.warnings.push(...recordScan.warnings);

    recordScan.matchedSourceIds.forEach((sourceId) => {
      existingMatchedRecordIds.add(sourceId);
      if (!report.recordIdMap.has(sourceId)) {
        report.recordIdMap.set(sourceId, sourceId);
      }
    });

    report.existingRecordMatches = existingMatchedRecordIds.size;
    report.skippedExistingRecords = existingMatchedRecordIds.size;

    if (existingMatchedRecordIds.size > 0) {
      bumpSkippedExistingByResource(
        report,
        'records',
        existingMatchedRecordIds.size,
      );
      existingMatchedRecordIds.forEach((sourceId) => {
        report.warnings.push(
          `[add-only][records] Skipped existing record '${sourceId}'`,
        );
      });
    } else {
      const targetProjectId = await resolveTargetProjectId(client);
      const sourceProjectId = envelope.manifest.sourceProjectId;
      const sourceEnvironment = envelope.manifest.sourceEnvironment;
      const mismatchDetails: string[] = [];

      if (
        sourceProjectId &&
        targetProjectId &&
        sourceProjectId !== targetProjectId
      ) {
        mismatchDetails.push(
          `sourceProjectId=${sourceProjectId}, targetProjectId=${targetProjectId}`,
        );
      }
      if (
        sourceEnvironment &&
        args.environment &&
        sourceEnvironment !== args.environment
      ) {
        mismatchDetails.push(
          `sourceEnvironment=${sourceEnvironment}, targetEnvironment=${args.environment}`,
        );
      }

      if (mismatchDetails.length > 0) {
        report.warnings.push(
          `[add-only][records] Existing-record ID scan matched zero records (${mismatchDetails.join(
            '; ',
          )}). Continuing with create-only import.`,
        );
      }
    }

    existingRecordScanDone = true;
  }

  emitProgress({
    phase: 'preflight',
    finished: 0,
    total: 1,
    message: 'Running rewrite preflight',
  });

  const preflight = runPreflightImport(envelope, {
    strictMode: options.strictMode,
    skipAssetFields: options.skipAssets,
    itemTypeIdMap: schemaMapping.itemTypes.itemTypeIdMap,
    fieldApiKeyMapByItemType: schemaMapping.fields.fieldApiKeyMapByItemType,
    recordIdMap: report.recordIdMap,
    skipSourceRecordIds: (() => {
      const ids = new Set<string>(sourceBlockRecordIds);
      if (options.addOnlyDifferences) {
        existingMatchedRecordIds.forEach((id) => ids.add(id));
      }
      return ids.size > 0 ? ids : undefined;
    })(),
    uploadIdMap: report.uploadIdMap,
    blockIdMap,
  });

  report.preflight = preflight;
  report.unresolvedSummary = preflight.unresolvedSummary;
  report.warnings.push(...preflight.warnings);
  executorLogger.debug('Preflight phase finished', {
    ok: preflight.ok,
    bootstrapJobs: preflight.bootstrapJobs.length,
    patchJobs: preflight.patchJobs.length,
    unresolvedSummary: preflight.unresolvedSummary,
    warnings: preflight.warnings.length,
    errors: preflight.errors.length,
  });

  if (!preflight.ok) {
    const unresolvedSamples = Array.from(
      new Set(
        preflight.patchJobs
          .flatMap((job) => job.unresolved)
          .slice(0, 200)
          .map((entry) => `${entry.kind}:${entry.sourceId}`),
      ),
    ).slice(0, 25);

    report.errors.push(...preflight.errors);
    report.errors = dedupeMessages(report.errors);
    executorLogger.error('Preflight failed with blocking errors', {
      errors: preflight.errors,
      unresolvedSummary: preflight.unresolvedSummary,
      unresolvedSamples,
    });
    persist('preflight');
    return report;
  }

  const recordItemTypeMappingCheck = await validateAndRepairRecordItemTypeMappings({
    client,
    envelope,
    itemTypeIdMap,
    logger: executorLogger,
  });
  report.warnings.push(...recordItemTypeMappingCheck.warnings);
  if (recordItemTypeMappingCheck.repairedMappings > 0) {
    report.itemTypeIdMap = new Map(itemTypeIdMap);
  }
  if (recordItemTypeMappingCheck.errors.length > 0) {
    report.errors.push(
      ...recordItemTypeMappingCheck.errors.map(
        (entry) => `Record model mapping error: ${entry}`,
      ),
    );
    report.errors = dedupeMessages(report.errors);
    executorLogger.error('Record model mapping validation failed', {
      errors: recordItemTypeMappingCheck.errors,
    });
    persist('preflight');
    return report;
  }

  if (
    options.addOnlyDifferences &&
    sourceRecordIds.length > 0 &&
    !existingRecordScanDone
  ) {
    emitProgress({
      phase: 'bootstrap-create',
      finished: 0,
      total: sourceRecordIds.length,
      message: 'Scanning existing target records by source ID',
    });

    const recordScan = await scanExistingRecordsBySourceId({
      client,
      sourceRecordIds,
      chunkSize: 100,
      logger: executorLogger,
    });
    report.warnings.push(...recordScan.warnings);

    recordScan.matchedSourceIds.forEach((sourceId) => {
      existingMatchedRecordIds.add(sourceId);
      if (!report.recordIdMap.has(sourceId)) {
        report.recordIdMap.set(sourceId, sourceId);
      }
    });

    report.existingRecordMatches = existingMatchedRecordIds.size;
    report.skippedExistingRecords = existingMatchedRecordIds.size;

    if (existingMatchedRecordIds.size > 0) {
      bumpSkippedExistingByResource(
        report,
        'records',
        existingMatchedRecordIds.size,
      );
      existingMatchedRecordIds.forEach((sourceId) => {
        report.warnings.push(
          `[add-only][records] Skipped existing record '${sourceId}'`,
        );
      });
    } else {
      const targetProjectId = await resolveTargetProjectId(client);
      const sourceProjectId = envelope.manifest.sourceProjectId;
      const sourceEnvironment = envelope.manifest.sourceEnvironment;
      const mismatchDetails: string[] = [];

      if (
        sourceProjectId &&
        targetProjectId &&
        sourceProjectId !== targetProjectId
      ) {
        mismatchDetails.push(
          `sourceProjectId=${sourceProjectId}, targetProjectId=${targetProjectId}`,
        );
      }
      if (
        sourceEnvironment &&
        args.environment &&
        sourceEnvironment !== args.environment
      ) {
        mismatchDetails.push(
          `sourceEnvironment=${sourceEnvironment}, targetEnvironment=${args.environment}`,
        );
      }

      if (mismatchDetails.length > 0) {
        report.warnings.push(
          `[add-only][records] Existing-record ID scan matched zero records (${mismatchDetails.join(
            '; ',
          )}). Continuing with create-only import.`,
        );
      }
    }
  }

  const recordMutationSourceIds = sourceRecordIds.filter(
    (sourceRecordId) =>
      !(
        options.addOnlyDifferences &&
        existingMatchedRecordIds.has(sourceRecordId)
      ),
  );

  const validationWindowLogger = executorLogger.child('validation-window');
  let validationSnapshots: FieldValidationSnapshot[] = [];
  let validationWindowActive = false;
  const fallbackSuspendedTargetItemTypes = new Set<string>();

  emitProgress({
    phase: 'validation-window-discovery',
    finished: 0,
    total: 1,
    message: 'Resolving validation window scope',
  });

  const validationScope = resolveValidationScope({
    envelope,
    sourceRecordIds: recordMutationSourceIds,
    logger: validationWindowLogger,
  });
  report.warnings.push(...validationScope.warnings);
  report.validationFieldsInScope = validationScope.sourceFieldEntries.length;

  emitProgress({
    phase: 'validation-window-discovery',
    finished: 1,
    total: 1,
    message: `Validation scope resolved (${validationScope.sourceFieldEntries.length} field(s))`,
  });

  if (validationScope.sourceFieldEntries.length === 0) {
    emitProgress({
      phase: 'validation-window-suspend',
      finished: 1,
      total: 1,
      message: 'No field validations to suspend',
    });
    persist('validation-window-suspend');
  } else {
    emitProgress({
      phase: 'validation-window-suspend',
      finished: 0,
      total: validationScope.sourceFieldEntries.length,
      message: 'Suspending field validations',
    });

    const suspendResult = await suspendFieldValidations({
      client,
      scope: validationScope,
      itemTypeIdMap,
      fieldIdMap,
      retry: options.retry,
      updateConcurrency: options.concurrency.update,
      logger: validationWindowLogger,
    });

    report.warnings.push(...suspendResult.warnings);
    report.validationFieldsSuspended = suspendResult.suspendedCount;
    report.validationSuspendFailures = suspendResult.failures.length;
    report.validationSuspendFailureFieldIds = [
      ...suspendResult.failureFieldIds,
    ];

    emitProgress({
      phase: 'validation-window-suspend',
      finished: suspendResult.suspendedCount,
      total: validationScope.sourceFieldEntries.length,
      message: `Suspended validations for ${suspendResult.suspendedCount}/${validationScope.sourceFieldEntries.length} field(s)`,
    });

    validationSnapshots = suspendResult.snapshots;
    validationWindowActive = validationSnapshots.length > 0;

    if (!suspendResult.ok) {
      report.errors.push(
        `Validation window suspend failed for ${suspendResult.failures.length} field(s).`,
      );
      report.errors.push(
        ...suspendResult.failures.map(
          (failure) =>
            `Validation suspend failed for '${failure.sourceFieldApiKey}' (${failure.targetFieldId}): ${failure.message}`,
        ),
      );
      persist('validation-window-suspend');

      if (validationSnapshots.length > 0) {
        emitProgress({
          phase: 'validation-window-restore',
          finished: 0,
          total: validationSnapshots.length,
          message: 'Restoring validations after suspend failure',
        });

        const restoreResult = await restoreFieldValidations({
          client,
          snapshots: validationSnapshots,
          retry: options.retry,
          updateConcurrency: options.concurrency.update,
          logger: validationWindowLogger,
        });

        report.warnings.push(...restoreResult.warnings);
        report.validationFieldsRestored += restoreResult.restoredCount;
        report.validationRestoreFailures += restoreResult.failures.length;
        report.validationRestoreFailureFieldIds.push(
          ...restoreResult.failureFieldIds,
        );

        emitProgress({
          phase: 'validation-window-restore',
          finished: restoreResult.restoredCount,
          total: validationSnapshots.length,
          message: `Restored validations for ${restoreResult.restoredCount}/${validationSnapshots.length} field(s)`,
        });

        if (!restoreResult.ok) {
          report.errors.push(
            `Validation restore failed for ${restoreResult.failures.length} field(s) after suspend failure.`,
          );
          report.errors.push(
            ...restoreResult.failures.map(
              (failure) =>
                `Validation restore failed for '${failure.sourceFieldApiKey}' (${failure.targetFieldId}): ${failure.message}`,
            ),
          );
        }
        persist('validation-window-restore');
      }

      report.errors = dedupeMessages(report.errors);
      return report;
    }

    persist('validation-window-suspend');
  }

  try {
  const bootstrapJobs = prepareRecordBootstrapJobs({
    envelope,
    itemTypeIdMap: schemaMapping.itemTypes.itemTypeIdMap,
  }).filter(
    (job) =>
      !sourceBlockRecordIds.has(job.sourceRecordId) &&
      !createdSourceRecordIds.has(job.sourceRecordId) &&
      !(options.addOnlyDifferences && existingMatchedRecordIds.has(job.sourceRecordId)),
  );

  emitProgress({
    phase: 'bootstrap-create',
    finished: 0,
    total: bootstrapJobs.length || 1,
    message: 'Creating destination records',
  });

  let pendingBootstrapJobs = [...bootstrapJobs];
  const latestBootstrapErrors = new Map<string, string>();
  const maxBootstrapPasses = Math.max(2, bootstrapJobs.length + 1);

  for (
    let pass = 1;
    pendingBootstrapJobs.length > 0 && pass <= maxBootstrapPasses;
    pass += 1
  ) {
    let passProgress = 0;
    const nextPending: typeof pendingBootstrapJobs = [];

    await runWithConcurrency({
      inputs: pendingBootstrapJobs,
      limit: options.concurrency.create,
      worker: async (job, index) => {
        const sourceRecord = sourceRecordsById.get(job.sourceRecordId);

        emitProgress({
          phase: 'bootstrap-create',
          finished: report.createdCount + index,
          total: bootstrapJobs.length || 1,
          message: `Bootstrap pass ${pass}: creating '${job.sourceRecordId}'`,
        });

        if (!sourceRecord) {
          latestBootstrapErrors.set(job.sourceRecordId, 'Source record not found.');
          nextPending.push(job);
          return;
        }

        let payload: JsonObject | null = null;

        try {
          const idMaps: IdMaps = {
            recordIds: report.recordIdMap,
            uploadIds: report.uploadIdMap,
            blockIds: blockIdMap,
          };

          payload = buildBootstrapCreatePayload({
            sourceRecord,
            sourceItemTypeId: job.sourceItemTypeId,
            targetItemTypeId: job.targetItemTypeId,
            envelope,
            includeResolvedRelations: true,
            idMaps,
            skipAssetFields: options.skipAssets,
          });

          const created = await withRetry({
            operationName: 'items.create',
            options: options.retry,
            fn: async () => client.items.create(payload as any),
          });

          const createdId = asString(created.id);
          if (!createdId) {
            throw new Error('Created record missing ID in API response.');
          }

          report.recordIdMap.set(job.sourceRecordId, createdId);
          createdSourceRecordIds.add(job.sourceRecordId);
          report.createdCount += 1;
          passProgress += 1;
        } catch (error) {
          let message = formatError(error);

          if (
            shouldAttemptValidationFallbackForCreate(error) &&
            !fallbackSuspendedTargetItemTypes.has(job.targetItemTypeId)
          ) {
            validationWindowLogger.warn(
              'Attempting bootstrap validation fallback for failing target model',
              {
                sourceRecordId: job.sourceRecordId,
                sourceItemTypeId: job.sourceItemTypeId,
                targetItemTypeId: job.targetItemTypeId,
              },
            );
            const fallback = await suspendTargetItemTypeFieldValidations({
              client,
              targetItemTypeId: job.targetItemTypeId,
              sourceItemTypeId: job.sourceItemTypeId,
              sourceEnvelope: envelope,
              itemTypeIdMap,
              retry: options.retry,
              updateConcurrency: options.concurrency.update,
              logger: validationWindowLogger,
            });

            report.warnings.push(...fallback.warnings);
            report.validationFieldsInScope += fallback.inScopeCount;
            report.validationFieldsSuspended += fallback.suspendedCount;
            report.validationSuspendFailures += fallback.failures.length;
            report.validationSuspendFailureFieldIds.push(...fallback.failureFieldIds);

            if (fallback.suspendedCount > 0) {
              validationWindowActive = true;
              const existingByTargetFieldId = new Map(
                validationSnapshots.map((snapshot) => [snapshot.targetFieldId, snapshot]),
              );
              fallback.snapshots.forEach((snapshot) => {
                if (!existingByTargetFieldId.has(snapshot.targetFieldId)) {
                  existingByTargetFieldId.set(snapshot.targetFieldId, snapshot);
                }
              });
              validationSnapshots = Array.from(existingByTargetFieldId.values());
            }

            if (fallback.ok) {
              fallbackSuspendedTargetItemTypes.add(job.targetItemTypeId);
              try {
                if (!payload) {
                  const idMaps: IdMaps = {
                    recordIds: report.recordIdMap,
                    uploadIds: report.uploadIdMap,
                    blockIds: blockIdMap,
                  };
                  payload = buildBootstrapCreatePayload({
                    sourceRecord,
                    sourceItemTypeId: job.sourceItemTypeId,
                    targetItemTypeId: job.targetItemTypeId,
                    envelope,
                    includeResolvedRelations: true,
                    idMaps,
                    skipAssetFields: options.skipAssets,
                  });
                }

                const createdAfterFallback = await withRetry({
                  operationName: 'items.create.after-validation-fallback',
                  options: options.retry,
                  fn: async () => client.items.create(payload as any),
                });
                const createdId = asString(createdAfterFallback.id);
                if (!createdId) {
                  throw new Error(
                    'Created record missing ID in API response after validation fallback.',
                  );
                }

                report.recordIdMap.set(job.sourceRecordId, createdId);
                createdSourceRecordIds.add(job.sourceRecordId);
                report.createdCount += 1;
                passProgress += 1;
                return;
              } catch (retryError) {
                message = formatError(retryError);
              }
            }
          }

          latestBootstrapErrors.set(job.sourceRecordId, message);
          executorLogger.warn('Bootstrap create attempt failed', {
            sourceRecordId: job.sourceRecordId,
            sourceItemTypeId: job.sourceItemTypeId,
            targetItemTypeId: job.targetItemTypeId,
            pass,
            payloadItemType:
              payload && isObject(payload.item_type) ? payload.item_type : null,
            error: message,
          });
          nextPending.push(job);
        }
      },
    });

    persist('bootstrap-create');

    if (nextPending.length === 0) {
      pendingBootstrapJobs = [];
      break;
    }

    if (passProgress === 0) {
      pendingBootstrapJobs = nextPending;
      break;
    }

    pendingBootstrapJobs = nextPending;
  }

  pendingBootstrapJobs.forEach((job) => {
    const message =
      latestBootstrapErrors.get(job.sourceRecordId) ??
      'Could not resolve required dependencies for record creation.';

    report.createFailures.push({
      sourceRecordId: job.sourceRecordId,
      message,
    });
    report.errors.push(`Bootstrap failed for '${job.sourceRecordId}': ${message}`);
    executorLogger.error('Bootstrap create failed after retries', {
      sourceRecordId: job.sourceRecordId,
      sourceItemTypeId: job.sourceItemTypeId,
      error: message,
    });
  });

  if (options.strictMode && report.createFailures.length > 0) {
    report.errors = dedupeMessages(report.errors);
    persist('bootstrap-create');
    return report;
  }

  const pendingPatchSourceIds = sourceRecordIds
    .filter(
      (sourceRecordId) =>
        report.recordIdMap.has(sourceRecordId) &&
        !updatedSourceRecordIds.has(sourceRecordId) &&
        !(options.addOnlyDifferences && existingMatchedRecordIds.has(sourceRecordId)),
    );
  const patchChunkSize = Math.max(
    100,
    Math.min(1000, options.concurrency.update * 50),
  );

  emitProgress({
    phase: 'patch-update',
    finished: 0,
    total: pendingPatchSourceIds.length || 1,
    message: 'Applying rewritten payloads',
  });

  let processedPatchJobs = 0;

  for (
    let chunkStart = 0;
    chunkStart < pendingPatchSourceIds.length;
    chunkStart += patchChunkSize
  ) {
    const chunkSourceIds = pendingPatchSourceIds.slice(
      chunkStart,
      chunkStart + patchChunkSize,
    );

    const chunkRecords = chunkSourceIds
      .map((sourceRecordId) => sourceRecordsById.get(sourceRecordId))
      .filter((record): record is JsonObject => Boolean(record));

    const patchJobs = prepareRecordPatchJobs({
      envelope,
      recordIdMap: report.recordIdMap,
      uploadIdMap: report.uploadIdMap,
      blockIdMap,
      itemTypeIdMap: schemaMapping.itemTypes.itemTypeIdMap,
      fieldApiKeyMapByItemType: schemaMapping.fields.fieldApiKeyMapByItemType,
      skipAssetFields: options.skipAssets,
      records: chunkRecords,
    }).filter((job) => !updatedSourceRecordIds.has(job.sourceRecordId));

    await runWithConcurrency({
      inputs: patchJobs,
      limit: options.concurrency.update,
      worker: async (job, index) => {
        emitProgress({
          phase: 'patch-update',
          finished: processedPatchJobs + index,
          total: pendingPatchSourceIds.length || 1,
          message: `Updating '${job.sourceRecordId}'`,
        });

        const unresolvedRecordOrBlock = job.unresolved.some(
          (entry) => entry.kind === 'record' || entry.kind === 'block',
        );
        const unresolvedUploads = !options.skipAssets &&
          job.unresolved.some((entry) => entry.kind === 'upload');

        if (unresolvedRecordOrBlock || unresolvedUploads) {
          const reasons: string[] = [];
          if (unresolvedRecordOrBlock) {
            reasons.push('record/block references');
          }
          if (unresolvedUploads) {
            reasons.push('upload references');
          }

          const message = `Skipped update for '${job.sourceRecordId}' due to unresolved ${reasons.join(
            ' and ',
          )} (${job.unresolved.length}).`;

          if (options.strictMode) {
            report.updateFailures.push({
              sourceRecordId: job.sourceRecordId,
              targetRecordId: job.targetRecordId,
              message,
            });
            report.errors.push(message);
            executorLogger.error('Patch update blocked by unresolved references', {
              sourceRecordId: job.sourceRecordId,
              targetRecordId: job.targetRecordId,
              unresolvedCount: job.unresolved.length,
              unresolvedKinds: Array.from(
                new Set(job.unresolved.map((entry) => entry.kind)),
              ),
            });
          } else {
            report.skippedPatchCount += 1;
            report.warnings.push(message);
            executorLogger.warn('Patch update skipped by unresolved references', {
              sourceRecordId: job.sourceRecordId,
              targetRecordId: job.targetRecordId,
              unresolvedCount: job.unresolved.length,
              unresolvedKinds: Array.from(
                new Set(job.unresolved.map((entry) => entry.kind)),
              ),
            });
          }
          return;
        }

        try {
          await withRetry({
            operationName: 'items.update',
            options: options.retry,
            fn: async () =>
              client.items.update(job.targetRecordId, job.patchPayload as any),
          });

          updatedSourceRecordIds.add(job.sourceRecordId);
          report.updatedCount += 1;
        } catch (error) {
          const message = formatError(error);
          report.updateFailures.push({
            sourceRecordId: job.sourceRecordId,
            targetRecordId: job.targetRecordId,
            message,
          });
          report.errors.push(
            `Update failed for '${job.sourceRecordId}' (${job.targetRecordId}): ${message}`,
          );
          executorLogger.error('Patch update failed', {
            sourceRecordId: job.sourceRecordId,
            targetRecordId: job.targetRecordId,
            error: message,
          });
        }
      },
    });

    processedPatchJobs += patchJobs.length;
    persist('patch-update');
  }

  if (pendingPatchSourceIds.length === 0) {
    persist('patch-update');
  }

  if (options.strictMode && report.updateFailures.length > 0) {
    report.errors = dedupeMessages(report.errors);
    return report;
  }

  emitProgress({
    phase: 'tree-replay',
    finished: 0,
    total: envelope.records.length || 1,
    message: 'Replaying tree relations',
  });

  const treeJobs = envelope.records
    .map((sourceRecord) => {
      const { sourceRecordId } = extractRecordIdentity(sourceRecord);
      if (!sourceRecordId) {
        return null;
      }

      if (treeUpdatedSourceRecordIds.has(sourceRecordId)) {
        return null;
      }

      if (options.addOnlyDifferences && existingMatchedRecordIds.has(sourceRecordId)) {
        return null;
      }

      const targetRecordId = report.recordIdMap.get(sourceRecordId);
      if (!targetRecordId) {
        return null;
      }

      const extracted = extractTreeUpdatePayload({
        sourceRecord,
        recordIdMap: report.recordIdMap,
      });

      if (Object.keys(extracted.payload).length === 0) {
        return null;
      }

      return {
        sourceRecordId,
        targetRecordId,
        ...extracted,
      };
    })
    .filter((job): job is NonNullable<typeof job> => Boolean(job));

  await runWithConcurrency({
    inputs: treeJobs,
    limit: options.concurrency.update,
    worker: async (job, index) => {
      emitProgress({
        phase: 'tree-replay',
        finished: index,
        total: treeJobs.length || 1,
        message: `Replaying tree for '${job.sourceRecordId}'`,
      });

      if (job.unresolved.length > 0) {
        const message = `Tree replay skipped for '${job.sourceRecordId}': unresolved parent ${job.unresolved.join(
          ', ',
        )}.`;
        if (options.strictMode) {
          report.treeFailures.push({
            sourceRecordId: job.sourceRecordId,
            targetRecordId: job.targetRecordId,
            message,
          });
          report.errors.push(message);
          executorLogger.error('Tree replay blocked by unresolved parent', {
            sourceRecordId: job.sourceRecordId,
            targetRecordId: job.targetRecordId,
            unresolvedParents: job.unresolved,
          });
        } else {
          report.warnings.push(message);
          executorLogger.warn('Tree replay skipped by unresolved parent', {
            sourceRecordId: job.sourceRecordId,
            targetRecordId: job.targetRecordId,
            unresolvedParents: job.unresolved,
          });
        }
        return;
      }

      try {
        await withRetry({
          operationName: 'items.update.tree',
          options: options.retry,
          fn: async () => client.items.update(job.targetRecordId, job.payload as any),
        });
        treeUpdatedSourceRecordIds.add(job.sourceRecordId);
        report.treeUpdatedCount += 1;
      } catch (error) {
        const message = formatError(error);
        report.treeFailures.push({
          sourceRecordId: job.sourceRecordId,
          targetRecordId: job.targetRecordId,
          message,
        });
        report.errors.push(
          `Tree replay failed for '${job.sourceRecordId}' (${job.targetRecordId}): ${message}`,
        );
        executorLogger.error('Tree replay failed', {
          sourceRecordId: job.sourceRecordId,
          targetRecordId: job.targetRecordId,
          error: message,
        });
      }
    },
  });

  persist('tree-replay');

  if (options.strictMode && report.treeFailures.length > 0) {
    report.errors = dedupeMessages(report.errors);
    return report;
  }

  if (options.publishAfterImport) {
    const publishQueue = envelope.records
      .filter((record) => isSourceRecordPublished(record))
      .map((record) => extractRecordIdentity(record).sourceRecordId)
      .filter((sourceRecordId): sourceRecordId is string => Boolean(sourceRecordId))
      .filter((sourceRecordId) => !publishedSourceRecordIds.has(sourceRecordId))
      .filter(
        (sourceRecordId) =>
          !(
            options.addOnlyDifferences &&
            existingMatchedRecordIds.has(sourceRecordId)
          ),
      )
      .map((sourceRecordId) => ({
        sourceRecordId,
        targetRecordId: report.recordIdMap.get(sourceRecordId),
      }))
      .filter(
        (entry): entry is { sourceRecordId: string; targetRecordId: string } =>
          Boolean(entry.targetRecordId),
      );

    let pendingPublish = [...publishQueue];
    const maxRounds = 6;

    for (let round = 1; pendingPublish.length > 0 && round <= maxRounds; round += 1) {
      emitProgress({
        phase: 'publish-replay',
        finished: publishQueue.length - pendingPublish.length,
        total: publishQueue.length || 1,
        message: `Publish replay round ${round} (${pendingPublish.length} pending)`,
      });

      const nextPending: typeof pendingPublish = [];
      let roundProgress = 0;

      await runWithConcurrency({
        inputs: pendingPublish,
        limit: options.concurrency.publish,
        worker: async (entry) => {
          try {
            await withRetry({
              operationName: 'items.publish',
              options: options.retry,
              shouldRetry: (error) =>
                isRetryableError(error) || shouldRetryPublishLater(error),
              fn: async () => client.items.publish(entry.targetRecordId),
            });
            publishedSourceRecordIds.add(entry.sourceRecordId);
            report.publishedCount += 1;
            roundProgress += 1;
          } catch (error) {
            if (shouldRetryPublishLater(error)) {
              nextPending.push(entry);
              return;
            }

            const message = formatError(error);
            report.publishFailures.push({
              sourceRecordId: entry.sourceRecordId,
              targetRecordId: entry.targetRecordId,
              message,
            });
            report.errors.push(
              `Publish failed for '${entry.sourceRecordId}' (${entry.targetRecordId}): ${message}`,
            );
            executorLogger.error('Publish replay failed', {
              sourceRecordId: entry.sourceRecordId,
              targetRecordId: entry.targetRecordId,
              error: message,
            });
          }
        },
      });

      persist('publish-replay');

      if (nextPending.length === 0) {
        pendingPublish = [];
        break;
      }

      if (roundProgress === 0) {
        pendingPublish = nextPending;
        break;
      }

      pendingPublish = nextPending;
    }

    pendingPublish.forEach((entry) => {
      const message = `Could not publish '${entry.sourceRecordId}' (${entry.targetRecordId}) after dependency rounds.`;
      report.publishFailures.push({
        sourceRecordId: entry.sourceRecordId,
        targetRecordId: entry.targetRecordId,
        message,
      });
      report.errors.push(message);
      executorLogger.error('Publish replay failed after dependency rounds', {
        sourceRecordId: entry.sourceRecordId,
        targetRecordId: entry.targetRecordId,
      });
    });
  }

  if (options.skipScheduledActionsImport) {
    emitProgress({
      phase: 'schedule-replay',
      finished: 1,
      total: 1,
      message: 'Skipping scheduled actions replay by option',
    });
    report.warnings.push('Skipped scheduled actions replay by option.');
    executorLogger.warn('Schedule replay phase skipped by option');
  } else {
    const scheduleReplay = await replayScheduledActions({
      client,
      envelope,
      recordIdMap: report.recordIdMap,
      skipSourceRecordIds:
        options.addOnlyDifferences ? existingMatchedRecordIds : undefined,
      logger,
      onProgress: emitProgress,
    });
    report.warnings.push(...scheduleReplay.warnings);
    executorLogger.debug('Schedule replay phase finished', {
      warnings: scheduleReplay.warnings.length,
      failures: scheduleReplay.failures.length,
    });
  }
  persist('schedule-replay');
  } finally {
    if (validationWindowActive) {
      emitProgress({
        phase: 'validation-window-restore',
        finished: 0,
        total: validationSnapshots.length || 1,
        message: 'Restoring field validations',
      });

      const restoreResult = await restoreFieldValidations({
        client,
        snapshots: validationSnapshots,
        retry: options.retry,
        updateConcurrency: options.concurrency.update,
        logger: validationWindowLogger,
      });

      report.warnings.push(...restoreResult.warnings);
      report.validationFieldsRestored += restoreResult.restoredCount;
      report.validationRestoreFailures += restoreResult.failures.length;
      report.validationRestoreFailureFieldIds.push(...restoreResult.failureFieldIds);

      emitProgress({
        phase: 'validation-window-restore',
        finished: restoreResult.restoredCount,
        total: validationSnapshots.length || 1,
        message: `Restored validations for ${restoreResult.restoredCount}/${validationSnapshots.length} field(s)`,
      });

      if (!restoreResult.ok) {
        report.errors.push(
          `Validation window restore failed for ${restoreResult.failures.length} field(s).`,
        );
        report.errors.push(
          ...restoreResult.failures.map(
            (failure) =>
              `Validation restore failed for '${failure.sourceFieldApiKey}' (${failure.targetFieldId}): ${failure.message}`,
          ),
        );
      }

      persist('validation-window-restore');
      validationWindowActive = false;
      validationSnapshots = [];
    }
  }

  const integrationImport = await importSideEffectIntegrations({
    client,
    envelope,
    itemTypeIdMap,
    fieldIdMap,
    addOnlyDifferences: options.addOnlyDifferences,
    includeWebhooks: !options.skipWebhookImport,
    includeBuildTriggers: !options.skipBuildTriggerImport,
    logger,
    onProgress: emitProgress,
  });
  report.warnings.push(...integrationImport.warnings);
  mergeSkippedExistingByResource(report, integrationImport.addOnlySkippedByResource);
  executorLogger.debug('Integration import phase finished', {
    warnings: integrationImport.warnings.length,
    failures: integrationImport.failures.length,
  });
  persist('integration-import');

  emitProgress({
    phase: 'verify',
    finished: 0,
    total: 1,
    message: 'Running post-import verification',
  });
  report.warnings.push(
    ...buildVerificationWarnings({
      envelope,
      itemTypeIdMap,
      fieldIdMap,
      fieldsetIdMap,
      recordIdMap: report.recordIdMap,
      uploadIdMap: report.uploadIdMap,
    }),
  );
  persist('verify');

  report.errors = dedupeMessages(report.errors);
  report.warnings = dedupeMessages(report.warnings);
  report.validationSuspendFailureFieldIds = Array.from(
    new Set(report.validationSuspendFailureFieldIds),
  );
  report.validationRestoreFailureFieldIds = Array.from(
    new Set(report.validationRestoreFailureFieldIds),
  );
  report.ok = report.errors.length === 0;
  executorLogger.debug('Import execution finished', {
    ok: report.ok,
    createdCount: report.createdCount,
    updatedCount: report.updatedCount,
    publishedCount: report.publishedCount,
    treeUpdatedCount: report.treeUpdatedCount,
    createFailures: report.createFailures.length,
    updateFailures: report.updateFailures.length,
    publishFailures: report.publishFailures.length,
    treeFailures: report.treeFailures.length,
    unresolvedSummary: report.unresolvedSummary,
    warnings: report.warnings.length,
    errors: report.errors.length,
  });

  if (options.downloadReportAfterRun) {
    emitProgress({
      phase: 'report-export',
      finished: 0,
      total: 1,
      message: 'Downloading import report',
    });
    downloadImportReport(report);
  }

  if (report.ok) {
    clearCheckpoint(fingerprint);
  } else {
    persist('done');
  }

  emitProgress({
    phase: 'done',
    finished: 1,
    total: 1,
    message: report.ok ? 'Import execution finished' : 'Import finished with errors',
  });

  return report;
}
