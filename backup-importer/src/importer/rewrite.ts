import {
  type FieldApiKeyMapByItemType,
  type FieldSummaryIndex,
  type IdMaps,
  type JsonObject,
  type RewriteResult,
  type SchemaFieldSummary,
  type UnresolvedReference,
  type UnresolvedReferenceKind,
} from './types';

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

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function appendPath(basePath: string, segment: string): string {
  if (segment.startsWith('[')) {
    return `${basePath}${segment}`;
  }

  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
    return `${basePath}.${segment}`;
  }

  const escaped = segment.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `${basePath}["${escaped}"]`;
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
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

function extractItemTypeId(entity: JsonObject): string | null {
  return extractEntityId(entity.item_type);
}

function remapItemTypeReference(
  value: unknown,
  itemTypeIdMap?: Map<string, string>,
): unknown {
  if (!itemTypeIdMap) {
    return value;
  }

  if (typeof value === 'string') {
    return itemTypeIdMap.get(value) ?? value;
  }

  if (!isObject(value)) {
    return value;
  }

  const id = asString(value.id);
  if (!id) {
    return value;
  }

  value.id = itemTypeIdMap.get(id) ?? id;
  return value;
}

function resolveTargetFieldApiKey(args: {
  sourceItemTypeId: string;
  sourceFieldApiKey: string;
  fieldApiKeyMapByItemType?: FieldApiKeyMapByItemType;
}): string {
  const perModelMap = args.fieldApiKeyMapByItemType?.get(args.sourceItemTypeId);
  if (!perModelMap) {
    return args.sourceFieldApiKey;
  }

  return perModelMap.get(args.sourceFieldApiKey) ?? args.sourceFieldApiKey;
}

function addUnresolved(
  unresolved: UnresolvedReference[],
  kind: UnresolvedReferenceKind,
  sourceId: string,
  path: string,
  reason: string,
) {
  const signature = `${kind}|${sourceId}|${path}|${reason}`;

  if (
    unresolved.some(
      (entry) =>
        `${entry.kind}|${entry.sourceId}|${entry.path}|${entry.reason}` ===
        signature,
    )
  ) {
    return;
  }

  unresolved.push({ kind, sourceId, path, reason });
}

function rewriteStringReference(
  sourceId: string,
  idMap: Map<string, string>,
  unresolved: UnresolvedReference[],
  kind: UnresolvedReferenceKind,
  path: string,
): string {
  const targetId = idMap.get(sourceId);

  if (!targetId) {
    addUnresolved(unresolved, kind, sourceId, path, 'Missing ID mapping');
    return sourceId;
  }

  return targetId;
}

function rewriteRecordRefValue(
  value: unknown,
  idMaps: IdMaps,
  unresolved: UnresolvedReference[],
  path: string,
): unknown {
  if (typeof value === 'string') {
    return rewriteStringReference(value, idMaps.recordIds, unresolved, 'record', path);
  }

  if (!isObject(value)) {
    return value;
  }

  const maybeId = asString(value.id);
  if (!maybeId) {
    return value;
  }

  const targetId = idMaps.recordIds.get(maybeId);

  if (!targetId) {
    addUnresolved(unresolved, 'record', maybeId, path, 'Missing ID mapping');
    return value;
  }

  value.id = targetId;
  return value;
}

function rewriteUploadRefValue(
  value: unknown,
  idMaps: IdMaps,
  unresolved: UnresolvedReference[],
  path: string,
): unknown {
  if (typeof value === 'string') {
    return rewriteStringReference(value, idMaps.uploadIds, unresolved, 'upload', path);
  }

  if (!isObject(value)) {
    return value;
  }

  const id = asString(value.id);
  const uploadId = asString(value.upload_id);
  const sourceId = id ?? uploadId;

  if (!sourceId) {
    return value;
  }

  const targetId = idMaps.uploadIds.get(sourceId);
  if (!targetId) {
    addUnresolved(unresolved, 'upload', sourceId, path, 'Missing upload mapping');
    return value;
  }

  if (id) {
    value.id = targetId;
  }

  if (uploadId) {
    value.upload_id = targetId;
  }

  return value;
}

function rewriteSeoValue(
  value: unknown,
  idMaps: IdMaps,
  unresolved: UnresolvedReference[],
  path: string,
  skipAssetFields?: boolean,
): unknown {
  if (!isObject(value)) {
    return value;
  }

  if (!('image' in value)) {
    return value;
  }

  if (skipAssetFields) {
    value.image = null;
    return value;
  }

  value.image = rewriteUploadRefValue(
    value.image,
    idMaps,
    unresolved,
    appendPath(path, 'image'),
  );
  return value;
}

function rewriteBlockRefValue(
  value: unknown,
  idMaps: IdMaps,
  unresolved: UnresolvedReference[],
  path: string,
): unknown {
  if (typeof value === 'string') {
    return rewriteStringReference(value, idMaps.blockIds, unresolved, 'block', path);
  }

  if (!isObject(value)) {
    return value;
  }

  const blockId = asString(value.id);
  if (!blockId) {
    return value;
  }

  const targetId = idMaps.blockIds.get(blockId);
  if (!targetId) {
    addUnresolved(unresolved, 'block', blockId, path, 'Missing block mapping');
    return value;
  }

  value.id = targetId;
  return value;
}

function rewriteStructuredTextNode(
  node: unknown,
  idMaps: IdMaps,
  unresolved: UnresolvedReference[],
  path: string,
) {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => {
      rewriteStructuredTextNode(
        entry,
        idMaps,
        unresolved,
        appendPath(path, `[${index}]`),
      );
    });
    return;
  }

  if (!isObject(node)) {
    return;
  }

  const nodeType = asString(node.type);

  if (nodeType === 'itemLink' || nodeType === 'inlineItem') {
    node.item = rewriteRecordRefValue(
      node.item,
      idMaps,
      unresolved,
      appendPath(path, 'item'),
    );
  }

  if (nodeType === 'block' || nodeType === 'inlineBlock') {
    node.item = rewriteBlockRefValue(
      node.item,
      idMaps,
      unresolved,
      appendPath(path, 'item'),
    );
  }

  Object.entries(node).forEach(([key, value]) => {
    if (key === 'item') {
      return;
    }

    rewriteStructuredTextNode(value, idMaps, unresolved, appendPath(path, key));
  });
}

function rewriteStructuredTextValue(
  value: unknown,
  idMaps: IdMaps,
  unresolved: UnresolvedReference[],
  path: string,
) {
  if (!isObject(value)) {
    return value;
  }

  const links = value.links;
  if (Array.isArray(links)) {
    value.links = links.map((entry: unknown, index: number) =>
      rewriteRecordRefValue(
        entry,
        idMaps,
        unresolved,
        appendPath(appendPath(path, 'links'), `[${index}]`),
      ),
    );
  }

  const blocks = value.blocks;
  if (Array.isArray(blocks)) {
    value.blocks = blocks.map((entry: unknown, index: number) =>
      rewriteBlockRefValue(
        entry,
        idMaps,
        unresolved,
        appendPath(appendPath(path, 'blocks'), `[${index}]`),
      ),
    );
  }

  if ('document' in value) {
    rewriteStructuredTextNode(
      value.document,
      idMaps,
      unresolved,
      appendPath(path, 'document'),
    );
  } else {
    rewriteStructuredTextNode(value, idMaps, unresolved, path);
  }

  return value;
}

function rewriteBlockObject(
  blockObject: JsonObject,
  fieldSummaryIndex: FieldSummaryIndex,
  idMaps: IdMaps,
  unresolved: UnresolvedReference[],
  path: string,
  fieldApiKeyMapByItemType?: FieldApiKeyMapByItemType,
  itemTypeIdMap?: Map<string, string>,
  skipAssetFields?: boolean,
) {
  const blockModelId = extractItemTypeId(blockObject);
  blockObject.item_type = remapItemTypeReference(blockObject.item_type, itemTypeIdMap);

  if (asString(blockObject.id)) {
    rewriteBlockRefValue(blockObject, idMaps, unresolved, appendPath(path, 'id'));
  }

  if (!blockModelId) {
    return;
  }

  const modelFields = fieldSummaryIndex.get(blockModelId);
  if (!modelFields) {
    return;
  }

  for (const fieldDefinition of modelFields.values()) {
    if (!(fieldDefinition.apiKey in blockObject)) {
      continue;
    }

    const sourceFieldApiKey = fieldDefinition.apiKey;
    const targetFieldApiKey = resolveTargetFieldApiKey({
      sourceItemTypeId: blockModelId,
      sourceFieldApiKey,
      fieldApiKeyMapByItemType,
    });

    const rewritten = rewriteFieldValue(
      blockObject[sourceFieldApiKey],
      fieldDefinition,
      fieldSummaryIndex,
      idMaps,
      unresolved,
      appendPath(path, sourceFieldApiKey),
      fieldApiKeyMapByItemType,
      itemTypeIdMap,
      skipAssetFields,
    );

    if (targetFieldApiKey !== sourceFieldApiKey) {
      delete blockObject[sourceFieldApiKey];
    }

    blockObject[targetFieldApiKey] = rewritten;
  }
}

function rewriteBlockCollection(
  value: unknown,
  fieldSummaryIndex: FieldSummaryIndex,
  idMaps: IdMaps,
  unresolved: UnresolvedReference[],
  path: string,
  fieldApiKeyMapByItemType?: FieldApiKeyMapByItemType,
  itemTypeIdMap?: Map<string, string>,
  skipAssetFields?: boolean,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      const entryPath = appendPath(path, `[${index}]`);

      if (isObject(entry)) {
        rewriteBlockObject(
          entry,
          fieldSummaryIndex,
          idMaps,
          unresolved,
          entryPath,
          fieldApiKeyMapByItemType,
          itemTypeIdMap,
          skipAssetFields,
        );
        return entry;
      }

      return rewriteBlockRefValue(entry, idMaps, unresolved, entryPath);
    });
  }

  if (isObject(value)) {
    rewriteBlockObject(
      value,
      fieldSummaryIndex,
      idMaps,
      unresolved,
      path,
      fieldApiKeyMapByItemType,
      itemTypeIdMap,
      skipAssetFields,
    );
    return value;
  }

  return rewriteBlockRefValue(value, idMaps, unresolved, path);
}

function rewriteLocalizedFieldValue(
  value: unknown,
  fieldDefinition: SchemaFieldSummary,
  fieldSummaryIndex: FieldSummaryIndex,
  idMaps: IdMaps,
  unresolved: UnresolvedReference[],
  path: string,
  fieldApiKeyMapByItemType?: FieldApiKeyMapByItemType,
  itemTypeIdMap?: Map<string, string>,
  skipAssetFields?: boolean,
): unknown {
  if (!fieldDefinition.localized || !isObject(value)) {
    return rewriteFieldValue(
      value,
      { ...fieldDefinition, localized: false },
      fieldSummaryIndex,
      idMaps,
      unresolved,
      path,
      fieldApiKeyMapByItemType,
      itemTypeIdMap,
      skipAssetFields,
    );
  }

  for (const [locale, localeValue] of Object.entries(value)) {
    value[locale] = rewriteFieldValue(
      localeValue,
      { ...fieldDefinition, localized: false },
      fieldSummaryIndex,
      idMaps,
      unresolved,
      appendPath(path, locale),
      fieldApiKeyMapByItemType,
      itemTypeIdMap,
      skipAssetFields,
    );
  }

  return value;
}

function rewriteFieldValue(
  value: unknown,
  fieldDefinition: SchemaFieldSummary,
  fieldSummaryIndex: FieldSummaryIndex,
  idMaps: IdMaps,
  unresolved: UnresolvedReference[],
  path: string,
  fieldApiKeyMapByItemType?: FieldApiKeyMapByItemType,
  itemTypeIdMap?: Map<string, string>,
  skipAssetFields?: boolean,
): unknown {
  if (fieldDefinition.localized) {
    return rewriteLocalizedFieldValue(
      value,
      fieldDefinition,
      fieldSummaryIndex,
      idMaps,
      unresolved,
      path,
      fieldApiKeyMapByItemType,
      itemTypeIdMap,
      skipAssetFields,
    );
  }

  switch (fieldDefinition.fieldType) {
    case 'link':
      return rewriteRecordRefValue(value, idMaps, unresolved, path);
    case 'links':
      if (Array.isArray(value)) {
        return value.map((entry, index) =>
          rewriteRecordRefValue(
            entry,
            idMaps,
            unresolved,
            appendPath(path, `[${index}]`),
          ),
        );
      }
      return rewriteRecordRefValue(value, idMaps, unresolved, path);
    case 'file':
      if (skipAssetFields) {
        return null;
      }
      return rewriteUploadRefValue(value, idMaps, unresolved, path);
    case 'gallery':
      if (skipAssetFields) {
        return [];
      }
      if (Array.isArray(value)) {
        return value.map((entry, index) =>
          rewriteUploadRefValue(
            entry,
            idMaps,
            unresolved,
            appendPath(path, `[${index}]`),
          ),
        );
      }
      return rewriteUploadRefValue(value, idMaps, unresolved, path);
    case 'structured_text':
    case 'rich_text':
      return rewriteStructuredTextValue(value, idMaps, unresolved, path);
    case 'seo':
      return rewriteSeoValue(value, idMaps, unresolved, path, skipAssetFields);
    case 'modular_content':
    case 'single_block':
      return rewriteBlockCollection(
        value,
        fieldSummaryIndex,
        idMaps,
        unresolved,
        path,
        fieldApiKeyMapByItemType,
        itemTypeIdMap,
        skipAssetFields,
      );
    default:
      return value;
  }
}

export function buildFieldSummaryIndex(
  fieldsByItemType: Record<string, SchemaFieldSummary[]>,
): FieldSummaryIndex {
  const index: FieldSummaryIndex = new Map();

  for (const [itemTypeId, definitions] of Object.entries(fieldsByItemType)) {
    const fieldsByApiKey = new Map<string, SchemaFieldSummary>();

    definitions.forEach((definition) => {
      fieldsByApiKey.set(definition.apiKey, definition);
    });

    index.set(itemTypeId, fieldsByApiKey);
  }

  return index;
}

export function rewriteRecordForImport(
  record: JsonObject,
  fieldSummaryIndex: FieldSummaryIndex,
  idMaps: IdMaps,
  options?: {
    fieldApiKeyMapByItemType?: FieldApiKeyMapByItemType;
    itemTypeIdMap?: Map<string, string>;
    skipAssetFields?: boolean;
  },
): RewriteResult {
  const rewrittenRecord = deepClone(record);
  const unresolved: UnresolvedReference[] = [];
  const sourceItemTypeId = extractItemTypeId(rewrittenRecord);

  rewrittenRecord.item_type = remapItemTypeReference(
    rewrittenRecord.item_type,
    options?.itemTypeIdMap,
  );

  if (!sourceItemTypeId) {
    return { rewrittenRecord, unresolved };
  }

  const modelFields = fieldSummaryIndex.get(sourceItemTypeId);
  if (!modelFields) {
    return { rewrittenRecord, unresolved };
  }

  for (const fieldDefinition of modelFields.values()) {
    if (!(fieldDefinition.apiKey in rewrittenRecord)) {
      continue;
    }

    const sourceFieldApiKey = fieldDefinition.apiKey;
    const targetFieldApiKey = resolveTargetFieldApiKey({
      sourceItemTypeId,
      sourceFieldApiKey,
      fieldApiKeyMapByItemType: options?.fieldApiKeyMapByItemType,
    });

    const rewritten = rewriteFieldValue(
      rewrittenRecord[sourceFieldApiKey],
      fieldDefinition,
      fieldSummaryIndex,
      idMaps,
      unresolved,
      appendPath('$.record', sourceFieldApiKey),
      options?.fieldApiKeyMapByItemType,
      options?.itemTypeIdMap,
      options?.skipAssetFields,
    );

    if (targetFieldApiKey !== sourceFieldApiKey) {
      delete rewrittenRecord[sourceFieldApiKey];
    }

    rewrittenRecord[targetFieldApiKey] = rewritten;
  }

  return { rewrittenRecord, unresolved };
}

export function sanitizeRecordForUpdate(record: JsonObject): JsonObject {
  const payload: JsonObject = {};

  for (const [key, value] of Object.entries(record)) {
    if (SYSTEM_RECORD_KEYS.has(key)) {
      continue;
    }

    payload[key] = value;
  }

  return payload;
}

export function extractRecordIdentity(record: JsonObject): {
  sourceRecordId: string | null;
  sourceItemTypeId: string | null;
} {
  const sourceRecordId = extractEntityId(record.id);
  const sourceItemTypeId = extractItemTypeId(record);

  return { sourceRecordId, sourceItemTypeId };
}
