import type { JsonObject, RecordExportEnvelope } from './types';

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function extractItemTypeId(value: unknown): string | null {
  if (!isObject(value)) {
    return null;
  }

  return extractEntityId(value.item_type);
}

export function collectSourceRecordIds(records: JsonObject[]): Set<string> {
  const ids = new Set<string>();

  for (const record of records) {
    const id = extractEntityId(record.id);
    if (id) {
      ids.add(id);
    }
  }

  return ids;
}

export function collectEmbeddedBlockObjectIds(
  records: JsonObject[],
): Set<string> {
  const recordIds = collectSourceRecordIds(records);
  const blockIds = new Set<string>();
  const seen = new Set<unknown>();

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

    const objectNode = node as JsonObject;
    const id = extractEntityId(objectNode.id);
    const itemTypeId = extractItemTypeId(objectNode);

    if (id && itemTypeId && !recordIds.has(id)) {
      blockIds.add(id);
    }

    Object.values(objectNode).forEach((value) => walk(value));
  }

  records.forEach((record) => walk(record));
  return blockIds;
}

function collectPayloadBlockIds(envelope: RecordExportEnvelope): Set<string> {
  const ids = new Set<string>();
  const fieldsByItemType = envelope.schema.fieldsByItemType ?? {};

  function addId(value: unknown) {
    const id = extractEntityId(value);
    if (id) {
      ids.add(id);
    }
  }

  function walkStructuredTextNode(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach((entry) => walkStructuredTextNode(entry));
      return;
    }

    if (!isObject(node)) {
      return;
    }

    const nodeType = asString(node.type);
    if (nodeType === 'block' || nodeType === 'inlineBlock') {
      addId(node.item);
    }

    Object.values(node).forEach((value) => walkStructuredTextNode(value));
  }

  function collectStructuredTextValue(value: unknown) {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => collectStructuredTextValue(entry));
      return;
    }
    if (!isObject(value)) {
      return;
    }

    if (Array.isArray(value.blocks)) {
      value.blocks.forEach((entry) => addId(entry));
    }

    if ('document' in value) {
      walkStructuredTextNode(value.document);
    } else {
      walkStructuredTextNode(value);
    }
  }

  function collectBlockFieldValue(value: unknown) {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => collectBlockFieldValue(entry));
      return;
    }
    if (typeof value === 'string') {
      ids.add(value);
      return;
    }
    if (!isObject(value)) {
      return;
    }

    const maybeType = extractItemTypeId(value);
    if (maybeType) {
      const blockId = extractEntityId(value.id);
      if (blockId) {
        ids.add(blockId);
      }
      collectEntityBlockIds(value, maybeType);
      return;
    }

    Object.values(value).forEach((entry) => collectBlockFieldValue(entry));
  }

  function collectEntityBlockIds(entity: JsonObject, itemTypeId: string) {
    const fields = fieldsByItemType[itemTypeId];
    if (!fields || !Array.isArray(fields)) {
      return;
    }

    fields.forEach((field) => {
      const fieldApiKey = asString(field.apiKey);
      const fieldType = asString(field.fieldType);
      if (!fieldApiKey || !fieldType || !(fieldApiKey in entity)) {
        return;
      }

      const value = entity[fieldApiKey];
      if (fieldType === 'modular_content' || fieldType === 'single_block') {
        collectBlockFieldValue(value);
      } else if (fieldType === 'structured_text' || fieldType === 'rich_text') {
        collectStructuredTextValue(value);
      }
    });
  }

  envelope.records.forEach((record) => {
    const itemTypeId = extractItemTypeId(record);
    if (!itemTypeId) {
      return;
    }
    collectEntityBlockIds(record, itemTypeId);
  });

  return ids;
}

function collectReferencedBlockIds(envelope: RecordExportEnvelope): Set<string> {
  const ids = new Set<string>();

  envelope.referenceIndex.blockRefs.forEach((reference) => {
    const blockId = asString(reference.blockSourceId);
    if (blockId) {
      ids.add(blockId);
    }

    const parentBlockId = asString(reference.parentBlockSourceId);
    if (parentBlockId) {
      ids.add(parentBlockId);
    }
  });

  envelope.referenceIndex.structuredTextRefs.forEach((reference) => {
    if (reference.targetType !== 'block') {
      return;
    }
    const blockId = asString(reference.targetSourceId);
    if (blockId) {
      ids.add(blockId);
    }
  });

  return ids;
}

export function buildAutomaticBlockIdMap(args: {
  envelope: RecordExportEnvelope;
  existingMap?: Map<string, string>;
}): {
  blockIdMap: Map<string, string>;
  inferredCount: number;
  unresolvedReferenceCount: number;
} {
  const blockIdMap = new Map<string, string>(args.existingMap ?? []);
  const embeddedBlockIds = collectEmbeddedBlockObjectIds(args.envelope.records);
  const referencedBlockIds = collectReferencedBlockIds(args.envelope);
  const payloadBlockIds = collectPayloadBlockIds(args.envelope);
  let inferredCount = 0;

  for (const blockId of embeddedBlockIds) {
    if (!blockIdMap.has(blockId)) {
      blockIdMap.set(blockId, blockId);
      inferredCount += 1;
    }
  }

  for (const blockId of referencedBlockIds) {
    if (!blockIdMap.has(blockId)) {
      blockIdMap.set(blockId, blockId);
      inferredCount += 1;
    }
  }

  for (const blockId of payloadBlockIds) {
    if (!blockIdMap.has(blockId)) {
      blockIdMap.set(blockId, blockId);
      inferredCount += 1;
    }
  }

  const unresolvedReferenceCount = args.envelope.referenceIndex.blockRefs.reduce(
    (count, reference) => {
      if (reference.synthetic) {
        return count;
      }

      return blockIdMap.has(reference.blockSourceId) ? count : count + 1;
    },
    0,
  );

  return {
    blockIdMap,
    inferredCount,
    unresolvedReferenceCount,
  };
}
