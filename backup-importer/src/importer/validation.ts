import {
  type EnvelopeValidationResult,
  type JsonObject,
  SUPPORTED_RECORD_EXPORT_VERSION,
  type ValidationStats,
  type RecordExportEnvelope,
} from './types';

const EMPTY_STATS: ValidationStats = {
  recordCount: 0,
  itemTypeCount: 0,
  fieldCount: 0,
  referenceCounts: {
    recordRefs: 0,
    uploadRefs: 0,
    structuredTextRefs: 0,
    blockRefs: 0,
  },
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function extractEntityId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (isObject(value)) {
    return asString(value.id);
  }

  return null;
}

function extractRecordIdSet(records: JsonObject[]) {
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  const missingIdIndexes: number[] = [];

  records.forEach((record, index) => {
    const id = extractEntityId(record.id);

    if (!id) {
      missingIdIndexes.push(index);
      return;
    }

    if (ids.has(id)) {
      duplicates.add(id);
      return;
    }

    ids.add(id);
  });

  return { ids, duplicates, missingIdIndexes };
}

function collectEmbeddedBlockCount(records: JsonObject[]): number {
  const seen = new Set<unknown>();
  let count = 0;

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (seen.has(node)) {
      return;
    }

    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((entry) => walk(entry));
      return;
    }

    const obj = node as JsonObject;
    const id = asString(obj.id);
    const itemTypeId = extractEntityId(obj.item_type);

    if (id && itemTypeId) {
      count += 1;
    }

    Object.values(obj).forEach((value) => walk(value));
  }

  records.forEach((record) => walk(record));
  return count;
}

export function validateRecordExportEnvelope(
  raw: unknown,
): EnvelopeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(raw)) {
    return {
      envelope: null,
      errors: ['Export file must be a JSON object at the root.'],
      warnings,
      stats: { ...EMPTY_STATS },
    };
  }

  const manifest = asObject(raw.manifest);
  const schema = asObject(raw.schema);
  const referenceIndex = asObject(raw.referenceIndex);
  const projectConfiguration = asObject(raw.projectConfiguration);

  const records = asArray(raw.records).filter(isObject);
  const itemTypes = asArray(schema.itemTypes).filter(isObject);
  const fields = asArray(schema.fields).filter(isObject);

  const itemTypeIdToApiKey = asObject(schema.itemTypeIdToApiKey);
  const fieldIdToApiKey = asObject(schema.fieldIdToApiKey);
  const fieldsByItemType = asObject(schema.fieldsByItemType);

  const recordRefs = asArray(referenceIndex.recordRefs).filter(isObject);
  const uploadRefs = asArray(referenceIndex.uploadRefs).filter(isObject);
  const structuredTextRefs = asArray(referenceIndex.structuredTextRefs).filter(
    isObject,
  );
  const blockRefs = asArray(referenceIndex.blockRefs).filter(isObject);

  const stats: ValidationStats = {
    recordCount: records.length,
    itemTypeCount: itemTypes.length,
    fieldCount: fields.length,
    referenceCounts: {
      recordRefs: recordRefs.length,
      uploadRefs: uploadRefs.length,
      structuredTextRefs: structuredTextRefs.length,
      blockRefs: blockRefs.length,
    },
  };

  const exportVersion = asString(manifest.exportVersion);
  if (!exportVersion) {
    errors.push('Missing `manifest.exportVersion`.');
  } else if (exportVersion !== SUPPORTED_RECORD_EXPORT_VERSION) {
    errors.push(
      `Unsupported export version '${exportVersion}'. Expected '${SUPPORTED_RECORD_EXPORT_VERSION}'.`,
    );
  }

  if (!Array.isArray(raw.records)) {
    errors.push('Missing `records` array.');
  }

  if (!isObject(raw.schema)) {
    errors.push('Missing `schema` object.');
  }

  if (!isObject(raw.referenceIndex)) {
    errors.push('Missing `referenceIndex` object.');
  }

  if (!isObject(raw.projectConfiguration)) {
    warnings.push(
      'Missing `projectConfiguration` object. Import will run with configuration phases disabled.',
    );
  } else {
    if (!Array.isArray(projectConfiguration.workflows)) {
      warnings.push('`projectConfiguration.workflows` is missing or invalid.');
    }
    if (!Array.isArray(projectConfiguration.roles)) {
      warnings.push('`projectConfiguration.roles` is missing or invalid.');
    }
    if (!Array.isArray(projectConfiguration.fieldsets)) {
      warnings.push('`projectConfiguration.fieldsets` is missing or invalid.');
    }
    if (!Array.isArray(projectConfiguration.menuItems)) {
      warnings.push('`projectConfiguration.menuItems` is missing or invalid.');
    }
    if (!Array.isArray(projectConfiguration.schemaMenuItems)) {
      warnings.push('`projectConfiguration.schemaMenuItems` is missing or invalid.');
    }
    if (!Array.isArray(projectConfiguration.modelFilters)) {
      warnings.push('`projectConfiguration.modelFilters` is missing or invalid.');
    }
    if (!Array.isArray(projectConfiguration.plugins)) {
      warnings.push('`projectConfiguration.plugins` is missing or invalid.');
    }
    if (!Array.isArray(projectConfiguration.webhooks)) {
      warnings.push('`projectConfiguration.webhooks` is missing or invalid.');
    }
    if (!Array.isArray(projectConfiguration.buildTriggers)) {
      warnings.push('`projectConfiguration.buildTriggers` is missing or invalid.');
    }
  }

  if (!Object.keys(itemTypeIdToApiKey).length) {
    warnings.push('`schema.itemTypeIdToApiKey` is empty; schema mapping may fail.');
  }

  if (!Object.keys(fieldIdToApiKey).length) {
    warnings.push('`schema.fieldIdToApiKey` is empty; field mapping may fail.');
  }

  if (!Object.keys(fieldsByItemType).length) {
    warnings.push('`schema.fieldsByItemType` is empty; typed field rewriting will be limited.');
  }

  const { ids: recordIds, duplicates, missingIdIndexes } =
    extractRecordIdSet(records);

  if (missingIdIndexes.length) {
    errors.push(
      `Found ${missingIdIndexes.length} records without string IDs at indexes: ${missingIdIndexes
        .slice(0, 10)
        .join(', ')}${missingIdIndexes.length > 10 ? ', ...' : ''}.`,
    );
  }

  if (duplicates.size) {
    errors.push(
      `Duplicate source record IDs found: ${Array.from(duplicates)
        .slice(0, 10)
        .join(', ')}${duplicates.size > 10 ? ', ...' : ''}.`,
    );
  }

  records.forEach((record, index) => {
    const itemTypeId = extractEntityId(record.item_type);
    if (!itemTypeId) {
      warnings.push(`Record at index ${index} is missing \'item_type\' relationship.`);
      return;
    }

    if (!(itemTypeId in itemTypeIdToApiKey)) {
      warnings.push(
        `Record at index ${index} uses unknown item_type '${itemTypeId}' (not present in schema map).`,
      );
    }
  });

  const checkSourceRecord = (recordSourceId: string | null, path: string) => {
    if (!recordSourceId) {
      errors.push(`Invalid reference with missing source record at ${path}.`);
      return;
    }

    if (!recordIds.has(recordSourceId)) {
      warnings.push(
        `Reference source record '${recordSourceId}' at ${path} is not present in exported records.`,
      );
    }
  };

  recordRefs.forEach((ref, index) => {
    const source = asString(ref.recordSourceId);
    const target = asString(ref.targetSourceId);

    checkSourceRecord(source, `referenceIndex.recordRefs[${index}]`);

    if (!target) {
      errors.push(`Missing targetSourceId in referenceIndex.recordRefs[${index}].`);
      return;
    }

    if (!recordIds.has(target)) {
      warnings.push(
        `Target record '${target}' from referenceIndex.recordRefs[${index}] is not present in records payload.`,
      );
    }
  });

  structuredTextRefs.forEach((ref, index) => {
    const source = asString(ref.recordSourceId);
    const target = asString(ref.targetSourceId);
    const targetType = asString(ref.targetType);

    checkSourceRecord(source, `referenceIndex.structuredTextRefs[${index}]`);

    if (!target) {
      errors.push(
        `Missing targetSourceId in referenceIndex.structuredTextRefs[${index}].`,
      );
      return;
    }

    if (targetType === 'record' && !recordIds.has(target)) {
      warnings.push(
        `Structured text record target '${target}' at referenceIndex.structuredTextRefs[${index}] is not present in records payload.`,
      );
    }
  });

  uploadRefs.forEach((ref, index) => {
    const source = asString(ref.recordSourceId);
    const target = asString(ref.targetSourceId);

    checkSourceRecord(source, `referenceIndex.uploadRefs[${index}]`);

    if (!target) {
      errors.push(`Missing targetSourceId in referenceIndex.uploadRefs[${index}].`);
    }
  });

  blockRefs.forEach((ref, index) => {
    const source = asString(ref.recordSourceId);
    const blockId = asString(ref.blockSourceId);

    checkSourceRecord(source, `referenceIndex.blockRefs[${index}]`);

    if (!blockId) {
      errors.push(`Missing blockSourceId in referenceIndex.blockRefs[${index}].`);
    }
  });

  if (blockRefs.length > 0) {
    const embeddedBlockCount = collectEmbeddedBlockCount(records);

    if (embeddedBlockCount <= recordIds.size) {
      warnings.push(
        'Block references were detected, but embedded block payload appears sparse. Ensure the export contains complete nested payloads for block-heavy models.',
      );
    }
  }

  if (errors.length > 0) {
    return {
      envelope: null,
      errors,
      warnings,
      stats,
    };
  }

  return {
    envelope: raw as RecordExportEnvelope,
    errors,
    warnings,
    stats,
  };
}
