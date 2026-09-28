import { stableSerialize } from '../selection/identity';
import {
  readItemId,
  readItemModelId,
  type TraversableRecord,
} from '../selection/traversal';
import type {
  BlockAncestryEntry,
  SchemaField,
  SchemaIndex,
  TraversedFieldValue,
  ValuePath,
} from '../selection/types';

type UnknownRecord = Record<string, unknown>;

export type ChangedFieldValue = {
  /** The field value resolved from the same fresh nested root. */
  fieldValue: TraversedFieldValue;
  /** Its complete value after replacement, relative to `ref.valuePath`. */
  value: unknown;
};

export type CompileRootUpdateAttributesInput = {
  root: TraversableRecord | UnknownRecord;
  schema: SchemaIndex;
  changedValues: ReadonlyArray<ChangedFieldValue>;
};

/**
 * Raised when scan-time paths or ancestry no longer describe the supplied root.
 * Callers should discard the whole root plan rather than submit a partial payload.
 */
export class NestedPayloadCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NestedPayloadCompilationError';
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.getOwnPropertyDescriptor(record, key) !== undefined;
}

function isArrayIndex(value: unknown, index: number): value is unknown[] {
  return Array.isArray(value) && index >= 0 && index < value.length;
}

function missingPathError(): NestedPayloadCompilationError {
  return new NestedPayloadCompilationError(
    'A selected nested field is no longer available at its recorded path.',
  );
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  const record = asRecord(value);
  if (!record) return value;

  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, cloneValue(entry)]),
  );
}

function attributesForOwner(owner: UnknownRecord): UnknownRecord {
  return asRecord(owner.attributes) ?? owner;
}

type PathLookup = {
  found: boolean;
  value: unknown;
};

function valueAtPath(value: unknown, path: ValuePath): PathLookup {
  let current = value;

  for (const part of path) {
    if (typeof part === 'number') {
      if (!isArrayIndex(current, part)) {
        return { found: false, value: undefined };
      }
      current = current[part];
      continue;
    }

    const record = asRecord(current);
    if (!record || !hasOwn(record, part)) {
      return { found: false, value: undefined };
    }
    current = record[part];
  }

  return { found: true, value: current };
}

/** One step down a write path; missing object keys are created, array slots never. */
function childForWrite(
  current: unknown,
  part: string | number,
  nextPart: string | number,
): unknown {
  if (typeof part === 'number') {
    if (!isArrayIndex(current, part)) throw missingPathError();
    return current[part];
  }

  const record = asRecord(current);
  if (!record) throw missingPathError();
  if (!hasOwn(record, part)) {
    if (typeof nextPart === 'number') throw missingPathError();
    record[part] = {};
  }
  return record[part];
}

function setValueAtPath(
  root: UnknownRecord,
  path: ValuePath,
  nextValue: unknown,
): void {
  if (path.length === 0) {
    throw new NestedPayloadCompilationError(
      'A field value path cannot point to the complete root record.',
    );
  }

  let current: unknown = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    current = childForWrite(current, path[index], path[index + 1]);
  }

  const finalPart = path[path.length - 1];
  if (typeof finalPart === 'number') {
    if (!isArrayIndex(current, finalPart)) throw missingPathError();
    current[finalPart] = cloneValue(nextValue);
    return;
  }

  const record = asRecord(current);
  if (!record) throw missingPathError();
  record[finalPart] = cloneValue(nextValue);
}

function pathKey(path: ValuePath): string {
  return stableSerialize(path);
}

function comparePaths(left: ValuePath, right: ValuePath): number {
  return (
    left.length - right.length || pathKey(left).localeCompare(pathKey(right))
  );
}

function markDirtyField(
  dirtyFieldsByOwnerId: Map<string, Set<string>>,
  ownerId: string,
  fieldId: string,
): void {
  const fields = dirtyFieldsByOwnerId.get(ownerId) ?? new Set<string>();
  fields.add(fieldId);
  dirtyFieldsByOwnerId.set(ownerId, fields);
}

function assertAncestryEntry(
  root: UnknownRecord,
  schema: SchemaIndex,
  entry: BlockAncestryEntry,
  expectedParentModelId: string,
): void {
  const parentField = schema.fieldsById.get(entry.parentFieldId);
  const kindMatchesField =
    (entry.kind === 'modular_content' &&
      parentField?.fieldType === 'rich_text') ||
    (entry.kind === 'single_block' &&
      parentField?.fieldType === 'single_block') ||
    ((entry.kind === 'structured_text_block' ||
      entry.kind === 'structured_text_inline_block') &&
      parentField?.fieldType === 'structured_text');
  if (
    !parentField ||
    !kindMatchesField ||
    parentField.modelId !== expectedParentModelId ||
    parentField.apiKey !== entry.parentFieldApiKey ||
    !parentField.referencedBlockModelIds.includes(entry.blockModelId)
  ) {
    throw new NestedPayloadCompilationError(
      'A selected block path no longer matches the current schema.',
    );
  }

  const locatedBlock = valueAtPath(root, entry.valuePath);
  const block = asRecord(locatedBlock.value);
  if (
    !locatedBlock.found ||
    !block ||
    readItemId(block) !== entry.blockId ||
    readItemModelId(block) !== entry.blockModelId
  ) {
    throw new NestedPayloadCompilationError(
      'A selected block is no longer available at its recorded path.',
    );
  }
}

function assertFreshFieldValue(
  root: UnknownRecord,
  rootId: string,
  rootModelId: string,
  schema: SchemaIndex,
  fieldValue: TraversedFieldValue,
): void {
  const { ref, field, owner } = fieldValue;
  const schemaField = schema.fieldsById.get(ref.fieldId);

  if (
    ref.rootRecordId !== rootId ||
    ref.rootModelId !== rootModelId ||
    field.id !== ref.fieldId ||
    field.apiKey !== ref.fieldApiKey ||
    field.modelId !== ref.ownerModelId ||
    field.fieldType !== ref.fieldType ||
    owner.id !== ref.ownerRecordId ||
    owner.modelId !== ref.ownerModelId ||
    !schemaField ||
    schemaField.modelId !== ref.ownerModelId ||
    schemaField.apiKey !== ref.fieldApiKey ||
    schemaField.fieldType !== ref.fieldType
  ) {
    throw new NestedPayloadCompilationError(
      'A selected field value no longer matches the current record or schema.',
    );
  }

  if (ref.blockAncestry.length === 0) {
    if (ref.ownerRecordId !== rootId || ref.ownerModelId !== rootModelId) {
      throw new NestedPayloadCompilationError(
        'A selected field has invalid root-record ancestry.',
      );
    }
  } else {
    let parentModelId = rootModelId;

    for (const entry of ref.blockAncestry) {
      assertAncestryEntry(root, schema, entry, parentModelId);
      parentModelId = entry.blockModelId;
    }

    const ownerEntry = ref.blockAncestry[ref.blockAncestry.length - 1];
    if (
      ownerEntry.blockId !== ref.ownerRecordId ||
      ownerEntry.blockModelId !== ref.ownerModelId
    ) {
      throw new NestedPayloadCompilationError(
        'A selected field has invalid block ancestry.',
      );
    }
  }

  const current = valueAtPath(root, ref.valuePath);
  if (
    (ref.present && !current.found) ||
    stableSerialize(current.value) !== stableSerialize(fieldValue.value)
  ) {
    throw new NestedPayloadCompilationError(
      'A selected field value has changed since it was resolved.',
    );
  }
}

function normalizeChanges(
  root: UnknownRecord,
  rootId: string,
  rootModelId: string,
  schema: SchemaIndex,
  changedValues: ReadonlyArray<ChangedFieldValue>,
): ChangedFieldValue[] {
  const changesByPath = new Map<string, ChangedFieldValue>();

  for (const change of changedValues) {
    assertFreshFieldValue(root, rootId, rootModelId, schema, change.fieldValue);

    if (
      stableSerialize(change.fieldValue.value) === stableSerialize(change.value)
    ) {
      continue;
    }

    const key = pathKey(change.fieldValue.ref.valuePath);
    const previous = changesByPath.get(key);
    if (
      previous &&
      stableSerialize(previous.value) !== stableSerialize(change.value)
    ) {
      throw new NestedPayloadCompilationError(
        'More than one replacement produced conflicting values for a field.',
      );
    }
    changesByPath.set(key, change);
  }

  return [...changesByPath.values()].sort((left, right) =>
    comparePaths(left.fieldValue.ref.valuePath, right.fieldValue.ref.valuePath),
  );
}

function requestBlock(id: string, attributes: UnknownRecord): UnknownRecord {
  return {
    id,
    type: 'item',
    attributes,
  };
}

/**
 * Produces root-level field attributes for `client.items.update()`.
 *
 * Existing unchanged blocks become ID references. Existing dirty blocks become
 * compact update records containing only dirty fields. Dirty container fields
 * are composed recursively so multiple descendant changes share one root
 * payload without losing localization, order, or Structured Text topology.
 */
export function compileRootUpdateAttributes({
  root,
  schema,
  changedValues,
}: CompileRootUpdateAttributesInput): Record<string, unknown> {
  const rootRecord = root as UnknownRecord;
  const rootId = readItemId(rootRecord);
  const rootModelId = readItemModelId(rootRecord);

  if (!rootId || !rootModelId) {
    throw new NestedPayloadCompilationError(
      'The fresh root record is missing its ID or model relationship.',
    );
  }

  const rootModel = schema.modelsById.get(rootModelId);
  if (!rootModel || rootModel.isBlockModel) {
    throw new NestedPayloadCompilationError(
      'The supplied record is not a known root model.',
    );
  }

  const changes = normalizeChanges(
    rootRecord,
    rootId,
    rootModelId,
    schema,
    changedValues,
  );
  if (changes.length === 0) return {};

  const composedRoot = cloneValue(rootRecord) as UnknownRecord;
  const dirtyFieldsByOwnerId = new Map<string, Set<string>>();
  const dirtyBlockIds = new Set<string>();

  for (const change of changes) {
    const { ref } = change.fieldValue;
    setValueAtPath(composedRoot, ref.valuePath, change.value);
    markDirtyField(dirtyFieldsByOwnerId, ref.ownerRecordId, ref.fieldId);

    let parentOwnerId = rootId;
    for (const ancestry of ref.blockAncestry) {
      markDirtyField(
        dirtyFieldsByOwnerId,
        parentOwnerId,
        ancestry.parentFieldId,
      );
      dirtyBlockIds.add(ancestry.blockId);
      parentOwnerId = ancestry.blockId;
    }
  }

  const compileBlock = (value: unknown): unknown => {
    if (typeof value === 'string') return value;

    const block = asRecord(value);
    const blockId = block ? readItemId(block) : null;
    const blockModelId = block ? readItemModelId(block) : null;
    const blockModel = blockModelId
      ? schema.modelsById.get(blockModelId)
      : undefined;

    if (!block || !blockId || !blockModelId || !blockModel?.isBlockModel) {
      throw new NestedPayloadCompilationError(
        'A nested block has an invalid record or model reference.',
      );
    }

    if (!dirtyBlockIds.has(blockId)) return blockId;

    const attributes = compileOwnerAttributes(block, blockId, blockModelId);
    if (Object.keys(attributes).length === 0) {
      throw new NestedPayloadCompilationError(
        'A dirty nested block did not contain any compilable field changes.',
      );
    }
    return requestBlock(blockId, attributes);
  };

  const compileStructuredTextNode = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(compileStructuredTextNode);
    }

    const node = asRecord(value);
    if (!node) return value;

    if (node.type === 'block' || node.type === 'inlineBlock') {
      return {
        ...Object.fromEntries(
          Object.entries(node).map(([key, entry]) => [
            key,
            key === 'item' ? compileBlock(entry) : cloneValue(entry),
          ]),
        ),
      };
    }

    // Linked records are external records, not owned nested blocks. Their
    // nodes and children are deliberately opaque to this compiler.
    if (node.type === 'itemLink' || node.type === 'inlineItem') {
      return cloneValue(node);
    }

    return Object.fromEntries(
      Object.entries(node).map(([key, entry]) => [
        key,
        key === 'children' && Array.isArray(entry)
          ? entry.map(compileStructuredTextNode)
          : cloneValue(entry),
      ]),
    );
  };

  const compileStructuredText = (value: unknown): unknown => {
    const structuredText = asRecord(value);
    if (!structuredText) return cloneValue(value);

    const document = asRecord(structuredText.document);
    if (document?.type === 'root') {
      return Object.fromEntries(
        Object.entries(structuredText)
          // Hydration-only block collections are not part of a DAST request.
          .filter(([key]) => key !== 'blocks')
          .map(([key, entry]) => [
            key,
            key === 'document'
              ? compileStructuredTextNode(entry)
              : cloneValue(entry),
          ]),
      );
    }

    return structuredText.type === 'root'
      ? compileStructuredTextNode(structuredText)
      : cloneValue(structuredText);
  };

  const compileModularContent = (
    field: SchemaField,
    value: unknown,
  ): unknown => {
    if (value === null) return null;
    if (!Array.isArray(value)) {
      throw new NestedPayloadCompilationError(
        `The "${field.apiKey}" Modular Content value is invalid.`,
      );
    }
    return value.map(compileBlock);
  };

  const compileUnlocalizedFieldValue = (
    field: SchemaField,
    value: unknown,
  ): unknown => {
    if (value === undefined) return null;

    switch (field.fieldType) {
      case 'rich_text':
        return compileModularContent(field, value);
      case 'single_block':
        return value === null ? null : compileBlock(value);
      case 'structured_text':
        return compileStructuredText(value);
      default:
        // Scalar values, SEO objects, uploads and linked-record references
        // stay opaque. Linked records are never recursively compiled.
        return cloneValue(value);
    }
  };

  const compileFieldValue = (field: SchemaField, value: unknown): unknown => {
    if (!field.localized) {
      return compileUnlocalizedFieldValue(field, value);
    }

    const localized = asRecord(value);
    if (!localized) {
      throw new NestedPayloadCompilationError(
        `The localized "${field.apiKey}" value is invalid.`,
      );
    }

    return Object.fromEntries(
      Object.entries(localized).map(([locale, localeValue]) => [
        locale,
        compileUnlocalizedFieldValue(field, localeValue),
      ]),
    );
  };

  function compileOwnerAttributes(
    owner: UnknownRecord,
    ownerId: string,
    ownerModelId: string,
  ): UnknownRecord {
    const dirtyFieldIds = dirtyFieldsByOwnerId.get(ownerId);
    if (!dirtyFieldIds || dirtyFieldIds.size === 0) return {};

    const fields = schema.fieldsByModelId.get(ownerModelId) ?? [];
    const attributes = attributesForOwner(owner);
    const result: UnknownRecord = {};

    for (const field of fields) {
      if (!dirtyFieldIds.has(field.id)) continue;
      result[field.apiKey] = compileFieldValue(field, attributes[field.apiKey]);
    }

    if (Object.keys(result).length !== dirtyFieldIds.size) {
      throw new NestedPayloadCompilationError(
        'One or more dirty fields are missing from the current schema.',
      );
    }

    return result;
  }

  return compileOwnerAttributes(composedRoot, rootId, rootModelId);
}
