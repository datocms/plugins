/** Field value helpers for locale duplication. Editor values remain Slate-shaped. */
import {
  getErrorMessage,
  isLocalizedField,
  type LocalizedField,
} from '../types';

export function isFieldTypeSupported(fieldType: string): boolean {
  return ['string', 'text', 'structured_text', 'json', 'seo', 'slug'].includes(
    fieldType,
  );
}

export function getFieldValue(
  field: LocalizedField | unknown,
  locale: string,
): unknown {
  return isLocalizedField(field) ? field[locale] : undefined;
}

export function setFieldValue(
  field: LocalizedField | unknown,
  locale: string,
  value: unknown,
): LocalizedField {
  return { ...(isLocalizedField(field) ? field : {}), [locale]: value };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface CloneTask {
  source: object;
  target: unknown[] | Record<string, unknown>;
}

function cloneChild(
  value: unknown,
  copies: WeakMap<object, unknown>,
  pending: CloneTask[],
): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (copies.has(value)) return copies.get(value);
  const target: unknown[] | Record<string, unknown> = Array.isArray(value)
    ? []
    : {};
  copies.set(value, target);
  pending.push({ source: value, target });
  return target;
}

function setCloneProperty(
  target: CloneTask['target'],
  key: string,
  value: unknown,
): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return;
  }
  (target as Record<string, unknown>)[key] = value;
}

/** Clone JSON-compatible editor/API values without recursion or shared children. */
export function cloneFieldValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;

  const result: unknown[] | Record<string, unknown> = Array.isArray(value)
    ? []
    : {};
  const copies = new WeakMap<object, unknown>([[value, result]]);
  const pending: CloneTask[] = [{ source: value, target: result }];

  while (pending.length > 0) {
    const pair = pending.pop();
    if (!pair) break;

    for (const [key, original] of Object.entries(
      pair.source as Record<string, unknown>,
    )) {
      // An arbitrary JSON key must not change the clone's prototype.
      setCloneProperty(pair.target, key, cloneChild(original, copies, pending));
    }
  }

  return result as T;
}

export interface FormBlockField {
  apiKey: string;
  fieldType: string;
  localized: boolean;
}

export type FormBlockSchemas = ReadonlyMap<string, readonly FormBlockField[]>;

type FormTask =
  | { kind: 'field'; value: unknown; fieldType: string; localized?: boolean }
  | { kind: 'slate'; value: unknown };

interface FormBlock {
  value: Record<string, unknown>;
  modelId: string;
  slate: boolean;
}

function visitSlateNode(
  value: unknown,
  pending: FormTask[],
): FormBlock | undefined {
  if (!isObject(value)) return;
  if (value.type === 'block' || value.type === 'inlineBlock') {
    if (typeof value.blockModelId !== 'string') {
      throw new Error(
        'Block content is not loaded. Wait for the editor to load it.',
      );
    }
    return { value, modelId: value.blockModelId, slate: true };
  }

  if (Array.isArray(value.children)) {
    for (const child of value.children)
      pending.push({ kind: 'slate', value: child });
  }
}

function visitFormField(
  task: Extract<FormTask, { kind: 'field' }>,
  pending: FormTask[],
): FormBlock | undefined {
  if (task.value === null || task.value === undefined) return;
  if (task.localized && isObject(task.value)) {
    for (const value of Object.values(task.value))
      pending.push({ ...task, value, localized: false });
    return;
  }

  if (task.fieldType === 'single_block') {
    if (!isObject(task.value) || typeof task.value.itemTypeId !== 'string') {
      throw new Error(
        'Block content is not loaded. Wait for the editor to load it.',
      );
    }
    return { value: task.value, modelId: task.value.itemTypeId, slate: false };
  }
  if (!Array.isArray(task.value))
    throw new Error('Editor content is not loaded.');
  for (const value of task.value) {
    pending.push(
      task.fieldType === 'structured_text'
        ? { kind: 'slate', value }
        : { kind: 'field', value, fieldType: 'single_block' },
    );
  }
}

function shouldVisitFormTask(
  task: FormTask,
  visited: WeakSet<object>,
): boolean {
  if (
    task.kind === 'field' &&
    !['rich_text', 'single_block', 'structured_text'].includes(task.fieldType)
  )
    return false;
  if (typeof task.value !== 'object' || task.value === null) return true;
  if (visited.has(task.value)) return false;
  visited.add(task.value);
  return true;
}

function enqueueBlockFields(
  block: FormBlock,
  schemas: FormBlockSchemas,
  pending: FormTask[],
): void {
  const fields = schemas.get(block.modelId);
  if (!fields)
    throw new Error(
      `Could not load the fields of block model ${block.modelId}.`,
    );
  for (const field of fields) {
    pending.push({
      kind: 'field',
      value: block.value[field.apiKey],
      fieldType: field.fieldType,
      localized: field.localized,
    });
  }
}

/** Follow only block-bearing fields in the schema; arbitrary JSON stays opaque. */
function* formBlocks(
  value: unknown,
  fieldType: string,
  schemas: FormBlockSchemas,
): Generator<FormBlock> {
  const pending: FormTask[] = [{ kind: 'field', value, fieldType }];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const task = pending.pop();
    if (!task) break;
    if (!shouldVisitFormTask(task, visited)) continue;

    const block =
      task.kind === 'slate'
        ? visitSlateNode(task.value, pending)
        : visitFormField(task, pending);
    if (!block) continue;

    yield block;
    enqueueBlockFields(block, schemas, pending);
  }
}

/** Load only block models actually present in this field, once per model. */
export async function loadFormBlockSchemas(
  value: unknown,
  fieldType: string,
  loadFields: (modelId: string) => Promise<readonly FormBlockField[]>,
): Promise<FormBlockSchemas> {
  const schemas = new Map<string, readonly FormBlockField[]>();
  for (const block of formBlocks(value, fieldType, schemas)) {
    if (!schemas.has(block.modelId)) {
      // biome-ignore lint/performance/noAwaitInLoops: each schema is needed to find its nested block fields.
      schemas.set(block.modelId, await loadFields(block.modelId));
    }
  }
  return schemas;
}

/** Duplicate editor blocks while preserving linked records, uploads and JSON IDs. */
export function cloneFormFieldValue(
  value: unknown,
  fieldType: string,
  schemas: FormBlockSchemas = new Map(),
): unknown {
  const result = cloneFieldValue(value);
  for (const block of formBlocks(result, fieldType, schemas)) {
    if (block.slate) {
      delete block.value.id;
      block.value.key = globalThis.crypto.randomUUID();
    } else {
      delete block.value.itemId;
    }
  }
  return result;
}

/** Keep one editor write in flight and finish remaining locales after partial failure. */
export async function copyFormValueToLocales(
  value: unknown,
  fieldType: string,
  schemas: FormBlockSchemas,
  locales: readonly string[],
  writeValue: (locale: string, value: unknown) => Promise<void>,
): Promise<{ copied: number; failures: string[] }> {
  let copied = 0;
  const failures: string[] = [];
  for (const locale of locales) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: keep one cloned value and one editor write in flight.
      await writeValue(locale, cloneFormFieldValue(value, fieldType, schemas));
      copied += 1;
    } catch (error) {
      failures.push(`${locale}: ${getErrorMessage(error)}`);
    }
  }
  return { copied, failures };
}

/** SDK paths use dot-separated field names, locales and block indexes. */
export function getValueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (
      current === null ||
      typeof current !== 'object' ||
      Object.getOwnPropertyDescriptor(current, part) === undefined
    )
      return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Replace only the field's locale, preserving localized parent-block paths. */
export function getLocalizedFieldPath(
  fieldPath: string,
  currentLocale: string,
  targetLocale: string,
): string | undefined {
  const suffix = `.${currentLocale}`;
  if (!currentLocale || !targetLocale || !fieldPath.endsWith(suffix)) return;
  return `${fieldPath.slice(0, -suffix.length)}.${targetLocale}`;
}

export function isValidLocale(locale: string): boolean {
  return /^[a-z]{2}(-[A-Z]{2})?$/.test(locale);
}

export function getLocalesFromField(field: LocalizedField | unknown): string[] {
  return isLocalizedField(field)
    ? Object.keys(field).filter(isValidLocale)
    : [];
}
