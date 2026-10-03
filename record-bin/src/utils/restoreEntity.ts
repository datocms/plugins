import type { Client } from '@datocms/cma-client-browser';
import { extractEntityModelId } from './recordBinPayload';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Clone the JSON tree without a second serialized copy or recursive JS calls. */
const cloneEntity = (
  entity: Record<string, unknown>,
): Record<string, unknown> => {
  type Container = Record<string, unknown> | unknown[];
  type Frame = {
    source: Container;
    target: Container;
    keys: string[];
    index: number;
  };
  const output: Record<string, unknown> = {};
  const ancestors = new WeakSet<object>();
  const stack: Frame[] = [
    { source: entity, target: output, keys: Object.keys(entity), index: 0 },
  ];
  ancestors.add(entity);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index === frame.keys.length) {
      ancestors.delete(frame.source);
      stack.pop();
      continue;
    }
    const key = frame.keys[frame.index++];
    const value = (frame.source as Record<string, unknown>)[key];
    if (value !== null && typeof value === 'object') {
      if (ancestors.has(value)) {
        throw new Error('The archived record contains circular data.');
      }
      const child: Container = Array.isArray(value) ? [] : {};
      Object.defineProperty(frame.target, key, {
        value: child,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      ancestors.add(value);
      stack.push({
        source: value as Container,
        target: child,
        keys: Object.keys(value),
        index: 0,
      });
    } else {
      Object.defineProperty(frame.target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
  return output;
};

type RestoreField = { api_key: string; field_type: string; localized: boolean };
type Read = <T>(operation: () => Promise<T>) => Promise<T>;
type BlockTask = { entity: Record<string, unknown>; isRoot: boolean };

const sanitizeItemEnvelope = (
  item: Record<string, unknown>,
  fields: RestoreField[],
  isRoot: boolean,
  rootId?: string,
) => {
  const attributes = item.attributes as Record<string, unknown>;
  if (!fields.some((field) => field.api_key === 'created_at'))
    delete attributes.created_at;
  if (!fields.some((field) => field.api_key === 'updated_at'))
    delete attributes.updated_at;
  delete item.__itemTypeId;
  const relationships = isRecord(item.relationships) ? item.relationships : {};
  if (!isRoot) {
    delete item.id;
    delete item.meta;
    item.relationships = { item_type: relationships.item_type };
    return;
  }
  if (rootId) item.id = rootId;
  else delete item.id;
  delete relationships.creator;
  item.relationships = relationships;
  const meta = isRecord(item.meta) ? item.meta : {};
  item.meta = {
    ...(typeof meta.created_at === 'string'
      ? { created_at: meta.created_at }
      : {}),
    ...(typeof meta.first_published_at === 'string' ||
    meta.first_published_at === null
      ? { first_published_at: meta.first_published_at }
      : {}),
  };
};

const appendArchivedBlock = (queue: BlockTask[], value: unknown) => {
  if (!isRecord(value)) {
    throw new Error(
      'An archived block only contains an ID; its complete data is required to restore it.',
    );
  }
  queue.push({ entity: value, isRoot: false });
};

const appendStructuredTextBlocks = (queue: BlockTask[], value: unknown) => {
  if (!isRecord(value) || !isRecord(value.document)) {
    throw new Error('An archived Structured Text field is invalid.');
  }
  const nodes: unknown[] = [value.document];
  while (nodes.length > 0) {
    const node = nodes.pop();
    if (!isRecord(node)) continue;
    if (node.type === 'block' || node.type === 'inlineBlock')
      appendArchivedBlock(queue, node.item);
    if (Array.isArray(node.children)) {
      for (const child of node.children) nodes.push(child);
    }
  }
};

const appendFieldValueBlocks = (
  queue: BlockTask[],
  field: RestoreField,
  value: unknown,
) => {
  if (value === null || value === undefined) return;
  switch (field.field_type) {
    case 'rich_text':
      if (!Array.isArray(value))
        throw new Error('An archived modular content field is invalid.');
      for (const block of value) appendArchivedBlock(queue, block);
      break;
    case 'single_block':
      appendArchivedBlock(queue, value);
      break;
    case 'structured_text':
      appendStructuredTextBlocks(queue, value);
      break;
  }
};

const appendFieldBlocks = (
  queue: BlockTask[],
  field: RestoreField,
  value: unknown,
) => {
  const values =
    field.localized && isRecord(value) ? Object.values(value) : [value];
  for (const localizedValue of values) {
    appendFieldValueBlocks(queue, field, localizedValue);
  }
};

const appendModelBlocks = (
  queue: BlockTask[],
  fields: RestoreField[],
  attributes: Record<string, unknown>,
) => {
  for (const field of fields) {
    if (
      ['rich_text', 'single_block', 'structured_text'].includes(
        field.field_type,
      )
    ) {
      appendFieldBlocks(queue, field, attributes[field.api_key]);
    }
  }
};

const archivedModelId = (item: Record<string, unknown>): string => {
  const modelId = extractEntityModelId(item);
  if (item.type !== 'item' || !isRecord(item.attributes) || !modelId) {
    throw new Error(
      'An archived record or block is missing its model or attributes.',
    );
  }
  return modelId;
};

/** Only traverse block fields declared by the model, keeping JSON/file metadata opaque. */
export const createRestoreEntitySanitizer = (client: Client, read: Read) => {
  const schemas = new Map<string, Promise<RestoreField[]>>();
  const fieldsFor = (modelId: string): Promise<RestoreField[]> => {
    const cached = schemas.get(modelId);
    if (cached) return cached;
    const pending = read(() => client.fields.list(modelId));
    schemas.set(modelId, pending);
    return pending;
  };

  return async (
    entity: Record<string, unknown>,
    rootId?: string,
  ): Promise<Record<string, unknown>> => {
    const root = cloneEntity(entity);
    const queue: BlockTask[] = [{ entity: root, isRoot: true }];
    while (queue.length > 0) {
      const task = queue.pop();
      if (!task) continue;
      const item = task.entity;
      const modelId = archivedModelId(item);
      const attributes = item.attributes as Record<string, unknown>;
      const fields = await fieldsFor(modelId);
      sanitizeItemEnvelope(item, fields, task.isRoot, rootId);
      appendModelBlocks(queue, fields, attributes);
    }
    return root;
  };
};

type ComparisonQueue = [unknown, unknown][];

const compareObjectValues = (
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  pending: ComparisonQueue,
): boolean => {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key)) return false;
    pending.push([a[key], b[key]]);
  }
  return true;
};

const compareArrayValues = (
  a: unknown[],
  b: unknown[],
  pending: ComparisonQueue,
): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) pending.push([a[i], b[i]]);
  return true;
};

const appendComparisons = (
  a: unknown,
  b: unknown,
  pending: ComparisonQueue,
): boolean => {
  if (Array.isArray(a) && Array.isArray(b))
    return compareArrayValues(a, b, pending);
  if (isRecord(a) && isRecord(b)) return compareObjectValues(a, b, pending);
  return false;
};

/** Equality ignores object key order, preserving array order and every field value. */
export const equalRestoreEntities = (
  left: unknown,
  right: unknown,
): boolean => {
  const pending: [unknown, unknown][] = [[left, right]];
  while (pending.length > 0) {
    const pair = pending.pop();
    if (!pair) continue;
    const [a, b] = pair;
    if (a === b) continue;
    if (!appendComparisons(a, b, pending)) return false;
  }
  return true;
};
