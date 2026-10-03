import type { Field, Item } from '../types';
import { cloneFieldValue } from '../utils/fieldUtils';

export type FieldSchema = Pick<Field, 'api_key' | 'field_type' | 'localized'>;
export type LoadFields = (modelId: string) => Promise<FieldSchema[]>;
type BlockIdentity = 'new' | 'keep' | 'omit';
const BLOCK_FIELDS = new Set(['rich_text', 'single_block', 'structured_text']);

function hasOwn(value: object, key: string): boolean {
  return Object.getOwnPropertyDescriptor(value, key) !== undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object in the localized field payload');
  }
  return value as Record<string, unknown>;
}

function newBlockId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function cloneLocalizedValue(
  value: unknown,
  fieldType: string,
  loadFields: LoadFields,
  identity: BlockIdentity,
) {
  const result: Record<string, unknown> = {};
  for (const [locale, localizedValue] of Object.entries(objectValue(value))) {
    // biome-ignore lint/performance/noAwaitInLoops: Preserve every localized value of the copied block.
    result[locale] = await cloneCmaFieldValue(
      localizedValue,
      fieldType,
      loadFields,
      identity,
    );
  }
  return result;
}

/** Transform only schema-defined block fields; JSON, assets and record links remain opaque. */
async function cloneBlock(
  value: unknown,
  loadFields: LoadFields,
  identity: BlockIdentity,
): Promise<unknown> {
  const block = objectValue(value);
  const model = objectValue(
    objectValue(objectValue(block.relationships).item_type).data,
  );
  if (block.type !== 'item' || typeof model.id !== 'string') {
    throw new Error(
      'Expected a fully expanded block with its model relationship',
    );
  }
  const attributes = objectValue(block.attributes);
  const fields = await loadFields(model.id);
  const fieldKeys = new Set(fields.map((field) => field.api_key));
  if (Object.keys(attributes).some((key) => !fieldKeys.has(key))) {
    throw new Error(
      'The block schema changed or could not be read completely; no block content was discarded',
    );
  }
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (!hasOwn(attributes, field.api_key)) continue;
    const clone = field.localized ? cloneLocalizedValue : cloneCmaFieldValue;
    // biome-ignore lint/performance/noAwaitInLoops: Schema reads are cached and only one record is cloned per worker.
    result[field.api_key] = await clone(
      attributes[field.api_key],
      field.field_type,
      loadFields,
      identity,
    );
  }
  return {
    ...(identity === 'omit'
      ? {}
      : { id: identity === 'new' ? newBlockId() : block.id }),
    type: 'item',
    attributes: result,
    relationships: { item_type: { data: { type: 'item_type', id: model.id } } },
  };
}

async function cloneModularContent(
  value: unknown,
  loadFields: LoadFields,
  identity: BlockIdentity,
) {
  if (!Array.isArray(value))
    throw new Error('Expected an expanded modular content array');
  const result: unknown[] = [];
  for (const block of value) {
    // biome-ignore lint/performance/noAwaitInLoops: Keep block cloning and schema requests bounded per record.
    result.push(await cloneBlock(block, loadFields, identity));
  }
  return result;
}

async function cloneStructuredText(
  value: unknown,
  loadFields: LoadFields,
  identity: BlockIdentity,
) {
  const result = cloneFieldValue(value);
  const pending: Record<string, unknown>[] = [
    objectValue(objectValue(result).document),
  ];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node.type === 'block' || node.type === 'inlineBlock') {
      // biome-ignore lint/performance/noAwaitInLoops: Only embedded blocks are cloned; inlineItem/itemLink references are preserved.
      node.item = await cloneBlock(node.item, loadFields, identity);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) pending.push(objectValue(child));
    }
  }
  return result;
}

export async function cloneCmaFieldValue(
  value: unknown,
  fieldType: string,
  loadFields: LoadFields,
  identity: BlockIdentity = 'new',
): Promise<unknown> {
  if (value === null) return null;
  switch (fieldType) {
    case 'single_block':
      return cloneBlock(value, loadFields, identity);
    case 'rich_text':
      return cloneModularContent(value, loadFields, identity);
    case 'structured_text':
      return cloneStructuredText(value, loadFields, identity);
    default:
      return cloneFieldValue(value);
  }
}

function comparableObjects(
  a: unknown,
  b: unknown,
): a is Record<string, unknown> {
  return (
    !!a &&
    !!b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    Array.isArray(a) === Array.isArray(b)
  );
}

/** Iterative comparison avoids serialized copies and preserves the significance of JSON IDs. */
export function valuesEqual(left: unknown, right: unknown): boolean {
  const pending: Array<[unknown, unknown]> = [[left, right]];
  while (pending.length > 0) {
    const pair = pending.pop();
    if (!pair) continue;
    const [a, b] = pair;
    if (a === b) continue;
    if (!comparableObjects(a, b)) return false;
    const bObject = b as Record<string, unknown>;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(bObject).length) return false;
    for (const key of keys) {
      if (!hasOwn(bObject, key)) return false;
      pending.push([a[key], bObject[key]]);
    }
  }
  return true;
}

async function fieldValuesEqual(
  a: unknown,
  b: unknown,
  fieldType: string,
  loadFields: LoadFields,
) {
  if (valuesEqual(a, b)) return true;
  if (!BLOCK_FIELDS.has(fieldType) || b === undefined) return false;
  const canonicalA = await cloneCmaFieldValue(a, fieldType, loadFields, 'omit');
  const canonicalB = await cloneCmaFieldValue(b, fieldType, loadFields, 'omit');
  return valuesEqual(canonicalA, canonicalB);
}

export async function buildLocaleUpdates(
  source: Item,
  current: Item,
  fields: FieldSchema[],
  sourceLocale: string,
  targetLocale: string,
  loadFields: LoadFields,
): Promise<Record<string, unknown>> {
  const updates: Record<string, unknown> = {};
  const localizedFields = fields.filter((field) => field.localized);
  const addingLocale = localizedFields.some(
    (field) => !hasOwn(objectValue(current[field.api_key]), targetLocale),
  );
  for (const field of localizedFields) {
    const original = objectValue(current[field.api_key]);
    const sourceValues = objectValue(source[field.api_key]);
    const hasSource = hasOwn(sourceValues, sourceLocale);
    if (!hasSource && !addingLocale) continue;
    const target = hasSource
      ? sourceValues[sourceLocale]
      : (original[targetLocale] ?? null);
    // biome-ignore lint/performance/noAwaitInLoops: Compare only the current record's localized fields before writing it.
    const equals = await fieldValuesEqual(
      target,
      original[targetLocale],
      field.field_type,
      loadFields,
    );
    if (!addingLocale && equals) continue;
    const clone = await cloneCmaFieldValue(
      target,
      field.field_type,
      loadFields,
    );
    updates[field.api_key] = { ...original, [targetLocale]: clone };
  }
  return updates;
}

/** Match exact newly assigned block IDs, while omitting only schema-defined block transport metadata. */
export async function containsUpdates(
  current: Item,
  updates: Record<string, unknown>,
  fields: FieldSchema[],
  loadFields: LoadFields,
): Promise<boolean> {
  for (const field of fields) {
    if (!hasOwn(updates, field.api_key)) continue;
    // biome-ignore lint/performance/noAwaitInLoops: This independent read-back only runs after an uncertain write.
    const actual = await cloneLocalizedValue(
      current[field.api_key],
      field.field_type,
      loadFields,
      'keep',
    );
    const expected = await cloneLocalizedValue(
      updates[field.api_key],
      field.field_type,
      loadFields,
      'keep',
    );
    if (!valuesEqual(actual, expected)) return false;
  }
  return true;
}
