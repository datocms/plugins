import {
  buildFieldSummaryIndex,
  extractRecordIdentity,
  rewriteRecordForImport,
  sanitizeRecordForUpdate,
} from './rewrite';
import {
  type FieldApiKeyMapByItemType,
  type IdMaps,
  type JsonObject,
  type PreflightOptions,
  type PreflightReport,
  type PreparedRecordBootstrapJob,
  type PreparedRecordPatchJob,
  type RecordExportEnvelope,
  type UnresolvedReference,
} from './types';
import { validateRecordExportEnvelope } from './validation';

function createSyntheticIdMap(
  values: Iterable<string>,
  prefix: string,
): Map<string, string> {
  const map = new Map<string, string>();

  for (const value of values) {
    map.set(value, `${prefix}_${value}`);
  }

  return map;
}

function collectSourceRecordIds(records: JsonObject[]): string[] {
  const ids: string[] = [];

  for (const record of records) {
    const recordId =
      typeof record.id === 'string'
        ? record.id
        : typeof record.id === 'object' &&
            record.id !== null &&
            'id' in record.id &&
            typeof (record.id as Record<string, unknown>).id === 'string'
          ? ((record.id as Record<string, unknown>).id as string)
          : null;

    if (recordId) {
      ids.push(recordId);
    }
  }

  return ids;
}

function createIdMaps(args: {
  envelope: RecordExportEnvelope;
  recordIdMap?: Map<string, string>;
  uploadIdMap?: Map<string, string>;
  blockIdMap?: Map<string, string>;
}): IdMaps {
  const sourceRecordIds = collectSourceRecordIds(args.envelope.records);
  const recordIds = createSyntheticIdMap(sourceRecordIds, 'record');

  if (args.recordIdMap) {
    args.recordIdMap.forEach((targetId, sourceId) => {
      recordIds.set(sourceId, targetId);
    });
  }

  return {
    recordIds,
    uploadIds: args.uploadIdMap ?? new Map<string, string>(),
    blockIds: args.blockIdMap ?? new Map<string, string>(),
  };
}

export function prepareRecordBootstrapJobs(args: {
  envelope: RecordExportEnvelope;
  itemTypeIdMap?: Map<string, string>;
}): PreparedRecordBootstrapJob[] {
  const jobs: PreparedRecordBootstrapJob[] = [];

  for (const record of args.envelope.records) {
    const { sourceRecordId, sourceItemTypeId } = extractRecordIdentity(record);

    if (!sourceRecordId || !sourceItemTypeId) {
      continue;
    }

    const targetItemTypeId =
      args.itemTypeIdMap?.get(sourceItemTypeId) ?? sourceItemTypeId;

    jobs.push({
      sourceRecordId,
      sourceItemTypeId,
      targetItemTypeId,
      createPayload: {
        item_type: {
          type: 'item_type',
          id: targetItemTypeId,
        },
      },
    });
  }

  return jobs;
}

export function prepareRecordPatchJobs(args: {
  envelope: RecordExportEnvelope;
  recordIdMap: Map<string, string>;
  uploadIdMap?: Map<string, string>;
  blockIdMap?: Map<string, string>;
  itemTypeIdMap?: Map<string, string>;
  fieldApiKeyMapByItemType?: FieldApiKeyMapByItemType;
  skipAssetFields?: boolean;
  records?: JsonObject[];
}): PreparedRecordPatchJob[] {
  const jobs: PreparedRecordPatchJob[] = [];

  const idMaps: IdMaps = {
    recordIds: args.recordIdMap,
    uploadIds: args.uploadIdMap ?? new Map<string, string>(),
    blockIds: args.blockIdMap ?? new Map<string, string>(),
  };

  const fieldSummaryIndex = buildFieldSummaryIndex(
    args.envelope.schema.fieldsByItemType,
  );

  const records = args.records ?? args.envelope.records;

  for (const sourceRecord of records) {
    const { sourceRecordId, sourceItemTypeId } = extractRecordIdentity(sourceRecord);

    if (!sourceRecordId || !sourceItemTypeId) {
      continue;
    }

    const targetRecordId = args.recordIdMap.get(sourceRecordId);
    if (!targetRecordId) {
      continue;
    }

    const targetItemTypeId =
      args.itemTypeIdMap?.get(sourceItemTypeId) ?? sourceItemTypeId;

    const { rewrittenRecord, unresolved } = rewriteRecordForImport(
      sourceRecord,
      fieldSummaryIndex,
      idMaps,
      {
        itemTypeIdMap: args.itemTypeIdMap,
        fieldApiKeyMapByItemType: args.fieldApiKeyMapByItemType,
        skipAssetFields: args.skipAssetFields,
      },
    );

    jobs.push({
      sourceRecordId,
      sourceItemTypeId,
      targetRecordId,
      targetItemTypeId,
      patchPayload: sanitizeRecordForUpdate(rewrittenRecord),
      unresolved,
    });
  }

  return jobs;
}

function summarizeUnresolvedReferences(unresolved: UnresolvedReference[]) {
  return unresolved.reduce(
    (acc, reference) => {
      if (reference.kind === 'record') {
        acc.records += 1;
      }

      if (reference.kind === 'upload') {
        acc.uploads += 1;
      }

      if (reference.kind === 'block') {
        acc.blocks += 1;
      }

      return acc;
    },
    { records: 0, uploads: 0, blocks: 0 },
  );
}

export function runPreflightImport(
  rawEnvelope: unknown,
  options: PreflightOptions,
): PreflightReport {
  const validation = validateRecordExportEnvelope(rawEnvelope);

  if (!validation.envelope) {
    return {
      ok: false,
      strictMode: options.strictMode,
      errors: validation.errors,
      warnings: validation.warnings,
      stats: validation.stats,
      bootstrapJobs: [],
      patchJobs: [],
      unresolvedSummary: {
        records: 0,
        uploads: 0,
        blocks: 0,
      },
    };
  }

  const envelope = validation.envelope;
  const recordsForSimulation = options.skipSourceRecordIds
    ? envelope.records.filter((record) => {
        const { sourceRecordId } = extractRecordIdentity(record);
        return !sourceRecordId || !options.skipSourceRecordIds?.has(sourceRecordId);
      })
    : envelope.records;
  const simulationEnvelope =
    recordsForSimulation === envelope.records
      ? envelope
      : { ...envelope, records: recordsForSimulation };

  const bootstrapJobs = prepareRecordBootstrapJobs({
    envelope: simulationEnvelope,
    itemTypeIdMap: options.itemTypeIdMap,
  });

  const idMaps = createIdMaps({
    envelope: simulationEnvelope,
    recordIdMap: options.recordIdMap,
    uploadIdMap: options.uploadIdMap,
    blockIdMap: options.blockIdMap,
  });

  const patchJobs = prepareRecordPatchJobs({
    envelope: simulationEnvelope,
    recordIdMap: idMaps.recordIds,
    uploadIdMap: idMaps.uploadIds,
    blockIdMap: idMaps.blockIds,
    itemTypeIdMap: options.itemTypeIdMap,
    fieldApiKeyMapByItemType: options.fieldApiKeyMapByItemType,
    skipAssetFields: options.skipAssetFields,
  });

  const allUnresolved = patchJobs.flatMap((job) => job.unresolved);
  const unresolvedSummary = summarizeUnresolvedReferences(allUnresolved);

  const errors = [...validation.errors];
  const warnings = [...validation.warnings];

  const unresolvedRecordOrBlock =
    unresolvedSummary.records + unresolvedSummary.blocks;
  const unresolvedUploadsOnly = unresolvedSummary.uploads > 0 && unresolvedRecordOrBlock === 0;

  if (allUnresolved.length) {
    const unresolvedMessage = `Found ${allUnresolved.length} unresolved references after rewrite simulation.`;

    if (options.strictMode && !unresolvedUploadsOnly) {
      errors.push(unresolvedMessage);
    } else {
      warnings.push(unresolvedMessage);
    }
  }

  if (unresolvedSummary.uploads > 0 && !options.uploadIdMap?.size) {
    warnings.push(
      'Upload references are unresolved because no upload ID mapping was provided yet.',
    );
  }

  return {
    ok: errors.length === 0,
    strictMode: options.strictMode,
    errors,
    warnings,
    stats: validation.stats,
    bootstrapJobs,
    patchJobs,
    unresolvedSummary,
  };
}
