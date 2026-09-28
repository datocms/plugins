import type { ApiTypes, RawApiTypes } from '@datocms/cma-client-browser';
import { fieldValueIdentity, fingerprintValue } from './identity';
import type {
  BlockAncestryEntry,
  EmbeddedBlockKind,
  FieldValueRef,
  SchemaField,
  SchemaIndex,
  TraversedFieldValue,
  ValuePath,
} from './types';

type UnknownRecord = Record<string, unknown>;

export type TraversableRecord =
  | (ApiTypes.ItemInNestedResponse & UnknownRecord)
  | (RawApiTypes.ItemInNestedResponse & UnknownRecord);

export type TraverseRecordOptions = {
  record: TraversableRecord | UnknownRecord;
  rootModelId: string;
  schema: SchemaIndex;
  siteId: string;
  environment: string;
  /** Site locales to materialize for localized fields, including missing values. */
  locales?: ReadonlyArray<string>;
  /** Defensive ceiling for malformed, cyclic hydrated payloads. */
  maxBlockDepth?: number;
};

export type TraverseRecordResult = {
  fieldValues: TraversedFieldValue[];
  /** Semantic identities encountered at more than one concrete value path. */
  duplicateFieldValueIds: string[];
};

type FieldValueEntry = {
  locale: string | null;
  value: unknown;
  present: boolean;
  valuePath: ValuePath;
};

type VisitOwnerContext = {
  owner: UnknownRecord;
  ownerId: string;
  ownerModelId: string;
  ownerPath: ValuePath;
  blockAncestry: ReadonlyArray<BlockAncestryEntry>;
  ancestorFieldValueIds: ReadonlyArray<string>;
};

export type BlockCandidate = {
  block: UnknownRecord;
  kind: EmbeddedBlockKind;
  valuePath: ValuePath;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.getOwnPropertyDescriptor(record, key) !== undefined;
}

function relationshipId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const relationship = asRecord(value);
  if (!relationship) return null;
  if (typeof relationship.id === 'string') return relationship.id;
  const data = asRecord(relationship.data);
  return typeof data?.id === 'string' ? data.id : null;
}

export function readItemId(record: UnknownRecord): string | null {
  return typeof record.id === 'string' && record.id.length > 0
    ? record.id
    : null;
}

export function readItemModelId(record: UnknownRecord): string | null {
  const direct = relationshipId(record.item_type);
  if (direct) return direct;

  const relationships = asRecord(record.relationships);
  const fromRelationship = relationshipId(relationships?.item_type);
  if (fromRelationship) return fromRelationship;

  return typeof record.itemTypeId === 'string' ? record.itemTypeId : null;
}

export function readCurrentVersion(record: UnknownRecord): string | null {
  const meta = asRecord(record.meta);
  return typeof meta?.current_version === 'string'
    ? meta.current_version
    : null;
}

/** A record's fields live under `attributes` in API payloads, or at the top level. */
export function ownerAttributes(
  owner: UnknownRecord,
  ownerPath: ValuePath,
): { attributes: UnknownRecord; attributesPath: ValuePath } {
  const attributes = asRecord(owner.attributes);
  return attributes
    ? { attributes, attributesPath: [...ownerPath, 'attributes'] }
    : { attributes: owner, attributesPath: ownerPath };
}

/** Normalizes localization independently at every root or block record level. */
export function fieldValueEntries(
  attributes: UnknownRecord,
  attributesPath: ValuePath,
  field: SchemaField,
  locales: ReadonlyArray<string>,
): FieldValueEntry[] {
  const fieldPresent = hasOwn(attributes, field.apiKey);
  const rawValue = fieldPresent ? attributes[field.apiKey] : undefined;
  const fieldPath = [...attributesPath, field.apiKey];

  if (!field.localized) {
    return [
      {
        locale: null,
        value: rawValue,
        present: fieldPresent,
        valuePath: fieldPath,
      },
    ];
  }

  const localizedValue = asRecord(rawValue);
  const localeKeys =
    locales.length > 0
      ? [...new Set(locales)]
      : localizedValue
        ? Object.keys(localizedValue)
        : [];

  return localeKeys.map((locale) => ({
    locale,
    value: localizedValue?.[locale],
    present:
      fieldPresent && Boolean(localizedValue && hasOwn(localizedValue, locale)),
    valuePath: [...fieldPath, locale],
  }));
}

function isEmbeddedRecord(value: unknown): value is UnknownRecord {
  const record = asRecord(value);
  if (!record) return false;
  return (
    readItemId(record) !== null &&
    readItemModelId(record) !== null &&
    (record.type === undefined || record.type === 'item')
  );
}

function structuredTextDocument(value: unknown): UnknownRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const document = asRecord(record.document);
  if (document?.type === 'root') return document;
  return record.type === 'root' ? record : null;
}

function structuredTextBlockCandidate(
  node: UnknownRecord,
  path: ValuePath,
): BlockCandidate[] {
  if (!isEmbeddedRecord(node.item)) return [];
  return [
    {
      block: node.item,
      kind:
        node.type === 'block'
          ? 'structured_text_block'
          : 'structured_text_inline_block',
      valuePath: [...path, 'item'],
    },
  ];
}

function collectStructuredTextBlocks(
  value: unknown,
  valuePath: ValuePath,
): BlockCandidate[] {
  const document = structuredTextDocument(value);
  if (!document) return [];

  const documentPath =
    asRecord(value)?.document === document
      ? [...valuePath, 'document']
      : valuePath;
  const candidates: BlockCandidate[] = [];

  const visitNode = (nodeValue: unknown, path: ValuePath): void => {
    const node = asRecord(nodeValue);
    if (!node) return;

    if (node.type === 'block' || node.type === 'inlineBlock') {
      // Only the referenced node item is a block. Linked-record nodes are never
      // considered, and arbitrary object properties are intentionally ignored.
      candidates.push(...structuredTextBlockCandidate(node, path));
      return;
    }

    const children = Array.isArray(node.children) ? node.children : [];
    for (const [index, child] of children.entries()) {
      visitNode(child, [...path, 'children', index]);
    }
  };

  visitNode(document, documentPath);
  return candidates;
}

/**
 * The blocks embedded directly in one field value, in document order:
 * Modular Content items, a Single Block, or Structured Text `block` and
 * `inlineBlock` nodes. Nested blocks are not included.
 */
export function embeddedBlockCandidates(
  fieldType: ApiTypes.Field['field_type'],
  value: unknown,
  valuePath: ValuePath = [],
): BlockCandidate[] {
  if (fieldType === 'rich_text') {
    if (!Array.isArray(value)) return [];
    return value.flatMap((block, index) =>
      isEmbeddedRecord(block)
        ? [
            {
              block,
              kind: 'modular_content' as const,
              valuePath: [...valuePath, index],
            },
          ]
        : [],
    );
  }

  if (fieldType === 'single_block') {
    return isEmbeddedRecord(value)
      ? [{ block: value, kind: 'single_block', valuePath }]
      : [];
  }

  if (fieldType === 'structured_text') {
    return collectStructuredTextBlocks(value, valuePath);
  }

  return [];
}

export function isContainerField(field: SchemaField): boolean {
  return (
    field.fieldType === 'rich_text' ||
    field.fieldType === 'single_block' ||
    field.fieldType === 'structured_text'
  );
}

type TraversalState = {
  schema: SchemaIndex;
  siteId: string;
  environment: string;
  locales: ReadonlyArray<string>;
  maxBlockDepth: number;
  rootModelId: string;
  rootRecordId: string;
  rootRecordVersion: string | null;
  results: TraversedFieldValue[];
  activeBlocks: WeakSet<object>;
  activeBlockIds: Set<string>;
  emittedFieldValueIds: Set<string>;
  duplicateFieldValueIds: Set<string>;
};

/**
 * Adds `valueFingerprint`, computed on first read and then kept. A search
 * traverses every field of every record, and a container's fingerprint
 * serializes its whole subtree again at each nesting level; hashing all of
 * that eagerly dominated re-searching cached records. Only the values that
 * matched (and the writer's fresh reads of the selected values) are ever
 * compared. Traversed records are never mutated (cached records are replaced
 * wholesale, fresh reads are new objects), so reading it late is safe.
 */
function withLazyFingerprint(
  fields: Omit<FieldValueRef, 'valueFingerprint'>,
  entry: FieldValueEntry,
): FieldValueRef {
  const ref = fields as FieldValueRef;
  Object.defineProperty(ref, 'valueFingerprint', {
    configurable: true,
    enumerable: true,
    get(): string {
      const value = fingerprintValue(entry.value, entry.present);
      Object.defineProperty(ref, 'valueFingerprint', {
        value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
      return value;
    },
  });
  return ref;
}

/** Emits one field value (once per identity) and returns its identity. */
function emitFieldValue(
  state: TraversalState,
  context: VisitOwnerContext,
  field: SchemaField,
  entry: FieldValueEntry,
): string {
  const fields: Omit<FieldValueRef, 'valueFingerprint'> = {
    kind: 'field_value',
    siteId: state.siteId,
    environment: state.environment,
    rootModelId: state.rootModelId,
    rootRecordId: state.rootRecordId,
    rootRecordVersion: state.rootRecordVersion,
    ownerModelId: context.ownerModelId,
    ownerRecordId: context.ownerId,
    fieldId: field.id,
    fieldApiKey: field.apiKey,
    fieldType: field.fieldType,
    locale: entry.locale,
    blockAncestry: context.blockAncestry,
    ancestorFieldValueIds: context.ancestorFieldValueIds,
    valuePath: entry.valuePath,
    present: entry.present,
  };
  const ref = withLazyFingerprint(fields, entry);
  const refId = fieldValueIdentity(ref);

  if (state.emittedFieldValueIds.has(refId)) {
    state.duplicateFieldValueIds.add(refId);
    return refId;
  }

  state.emittedFieldValueIds.add(refId);
  state.results.push({
    ref,
    value: entry.value,
    field,
    owner: { id: context.ownerId, modelId: context.ownerModelId },
    isContainer: isContainerField(field),
  });
  return refId;
}

function visitEmbeddedBlocks(
  state: TraversalState,
  context: VisitOwnerContext,
  field: SchemaField,
  entry: FieldValueEntry,
  fieldValueId: string,
): void {
  for (const candidate of embeddedBlockCandidates(
    field.fieldType,
    entry.value,
    entry.valuePath,
  )) {
    const blockId = readItemId(candidate.block);
    const blockModelId = readItemModelId(candidate.block);
    const blockModel = blockModelId
      ? state.schema.modelsById.get(blockModelId)
      : undefined;

    // This guards against accidentally following links or inline items.
    if (!blockId || !blockModelId || !blockModel?.isBlockModel) continue;
    if (
      state.activeBlocks.has(candidate.block) ||
      state.activeBlockIds.has(blockId)
    ) {
      continue;
    }

    const ancestryEntry: BlockAncestryEntry = {
      blockId,
      blockModelId,
      kind: candidate.kind,
      parentFieldId: field.id,
      parentFieldApiKey: field.apiKey,
      parentFieldValueId: fieldValueId,
      locale: entry.locale,
      valuePath: candidate.valuePath,
    };

    state.activeBlocks.add(candidate.block);
    state.activeBlockIds.add(blockId);
    visitOwner(state, {
      owner: candidate.block,
      ownerId: blockId,
      ownerModelId: blockModelId,
      ownerPath: candidate.valuePath,
      blockAncestry: [...context.blockAncestry, ancestryEntry],
      ancestorFieldValueIds: [...context.ancestorFieldValueIds, fieldValueId],
    });
    state.activeBlocks.delete(candidate.block);
    state.activeBlockIds.delete(blockId);
  }
}

function visitOwner(state: TraversalState, context: VisitOwnerContext): void {
  const fields = state.schema.fieldsByModelId.get(context.ownerModelId) ?? [];
  const { attributes, attributesPath } = ownerAttributes(
    context.owner,
    context.ownerPath,
  );

  for (const field of fields) {
    for (const entry of fieldValueEntries(
      attributes,
      attributesPath,
      field,
      state.locales,
    )) {
      const fieldValueId = emitFieldValue(state, context, field, entry);
      if (
        entry.present &&
        isContainerField(field) &&
        context.blockAncestry.length < state.maxBlockDepth
      ) {
        visitEmbeddedBlocks(state, context, field, entry, fieldValueId);
      }
    }
  }
}

export function traverseRecordWithDiagnostics({
  record,
  rootModelId,
  schema,
  siteId,
  environment,
  locales = [],
  maxBlockDepth = 64,
}: TraverseRecordOptions): TraverseRecordResult {
  const rootRecord = record as UnknownRecord;
  const rootRecordId = readItemId(rootRecord);
  if (!rootRecordId) {
    return { fieldValues: [], duplicateFieldValueIds: [] };
  }

  const state: TraversalState = {
    schema,
    siteId,
    environment,
    locales,
    maxBlockDepth,
    rootModelId,
    rootRecordId,
    rootRecordVersion: readCurrentVersion(rootRecord),
    results: [],
    activeBlocks: new WeakSet<object>(),
    activeBlockIds: new Set<string>(),
    emittedFieldValueIds: new Set<string>(),
    duplicateFieldValueIds: new Set<string>(),
  };

  visitOwner(state, {
    owner: rootRecord,
    ownerId: rootRecordId,
    ownerModelId: rootModelId,
    ownerPath: [],
    blockAncestry: [],
    ancestorFieldValueIds: [],
  });

  return {
    fieldValues: state.results,
    duplicateFieldValueIds: [...state.duplicateFieldValueIds].sort(),
  };
}

export function traverseRecord(
  options: TraverseRecordOptions,
): TraversedFieldValue[] {
  return traverseRecordWithDiagnostics(options).fieldValues;
}
