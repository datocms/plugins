import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import type {
  ContentField,
  ContentModel,
  ContentSchema,
  RecordInput,
} from '../types';
import { buildCmaClient, toRecordInput } from './records';

export type FormReadContext = Pick<
  RenderItemFormSidebarPanelCtx,
  | 'formValues'
  | 'formValuesToItem'
  | 'itemToFormValues'
  | 'item'
  | 'itemType'
  | 'locale'
  | 'currentUserAccessToken'
  | 'environment'
  | 'cmaBaseUrl'
>;

export type FormRecordResult = { record: RecordInput; warnings: string[] };
type ObjectValue = Record<string, unknown>;
type MissingValue = {
  field: ContentField;
  locale?: string;
  raw: unknown;
};

function objectValue(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}

// Match the standard editors supported by link extraction. Other fields are
// deliberately outside the scan's scope, so their absence is not a warning.
function supported(field: ContentField): boolean {
  switch (field.type) {
    case 'string':
      return !field.editor || field.editor === 'single_line';
    case 'text':
      return ['', 'textarea', 'markdown', 'wysiwyg'].includes(field.editor);
    case 'rich_text':
    case 'structured_text':
      return !field.editor || field.editor === field.type;
    case 'single_block':
      return ['', 'framed_single_block', 'frameless_single_block'].includes(
        field.editor,
      );
    default:
      return false;
  }
}

function fieldSlots(model: ContentModel, locales: readonly string[]) {
  return model.fields.filter(supported).flatMap((field) =>
    (field.localized ? locales : [undefined]).map((locale) => ({
      field,
      locale,
    })),
  );
}

function fieldValue(
  attributes: ObjectValue,
  field: ContentField,
  locale?: string,
): unknown {
  const value = attributes[field.apiKey];
  return locale === undefined ? value : objectValue(value)?.[locale];
}

function setFieldValue(
  attributes: ObjectValue,
  field: ContentField,
  locale: string | undefined,
  value: unknown,
): void {
  attributes[field.apiKey] =
    locale === undefined
      ? value
      : { ...objectValue(attributes[field.apiKey]), [locale]: value };
}

function sameValue(left: unknown, right: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index], depth + 1))
    );
  }
  const a = objectValue(left);
  const b = objectValue(right);
  return Boolean(
    a &&
      b &&
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every(
        (key) =>
          Object.keys(b).includes(key) && sameValue(a[key], b[key], depth + 1),
      ),
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('The scan was cancelled.', 'AbortError');
}

function cancellable<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new DOMException('The scan was cancelled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    request
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

/** Checks fields as well as containers: an omitted nested field is not empty. */
function auditCoverage(
  attributes: ObjectValue,
  model: ContentModel,
  schema: ContentSchema,
  locales: readonly string[],
  warn: (path: string) => void,
): void {
  const active = new WeakSet<object>();

  const visitBlock = (raw: unknown, path: string, depth: number) => {
    const wrapper = objectValue(raw);
    const item = objectValue(wrapper?.data) ?? wrapper;
    const relationships = objectValue(item?.relationships);
    const relationship = objectValue(relationships?.item_type);
    const linkedModel = objectValue(relationship?.data);
    const flatModel = objectValue(item?.item_type);
    const modelId = linkedModel?.id ?? flatModel?.id ?? item?.item_type;
    const blockModel =
      typeof modelId === 'string' ? schema.get(modelId) : undefined;
    if (!item || !blockModel?.isBlock) {
      warn(path);
      return;
    }
    visitModel(
      objectValue(item.attributes) ?? item,
      blockModel,
      `${path} › ${blockModel.name}`,
      depth + 1,
    );
  };

  const visitNode = (raw: unknown, path: string, depth: number) => {
    const node = objectValue(raw);
    if (!node || depth > 64 || active.has(node)) {
      warn(path);
      return;
    }
    active.add(node);
    if (node.type === 'block' || node.type === 'inlineBlock') {
      visitBlock(node.item, path, depth + 1);
    } else if (Array.isArray(node.children)) {
      for (const child of node.children) visitNode(child, path, depth + 1);
    }
    active.delete(node);
  };

  const visitStructuredText = (value: unknown, path: string, depth: number) => {
    const wrapper = objectValue(value);
    const document = objectValue(wrapper?.document);
    if (
      wrapper?.schema !== 'dast' ||
      document?.type !== 'root' ||
      !Array.isArray(document.children)
    ) {
      warn(path);
      return;
    }
    visitNode(document, path, depth + 1);
  };

  const visitValue = (
    value: unknown,
    field: ContentField,
    path: string,
    depth: number,
  ) => {
    if (value === undefined) {
      warn(path);
      return;
    }
    if (value === null) return;
    switch (field.type) {
      case 'string':
      case 'text':
        if (typeof value !== 'string') warn(path);
        return;
      case 'rich_text':
        if (!Array.isArray(value)) warn(path);
        else
          value.forEach((block, index) => {
            visitBlock(block, `${path} ${index + 1}`, depth + 1);
          });
        return;
      case 'single_block':
        visitBlock(value, path, depth + 1);
        return;
      case 'structured_text':
        visitStructuredText(value, path, depth);
    }
  };

  const visitModel = (
    values: ObjectValue,
    currentModel: ContentModel,
    path: string,
    depth: number,
  ) => {
    if (depth > 64 || active.has(values)) {
      warn(path);
      return;
    }
    active.add(values);
    for (const { field, locale } of fieldSlots(currentModel, locales)) {
      const fieldPath = path ? `${path} › ${field.label}` : field.label;
      visitValue(
        fieldValue(values, field, locale),
        field,
        locale === undefined ? fieldPath : `${fieldPath} (${locale})`,
        depth + 1,
      );
    }
    active.delete(values);
  };

  visitModel(attributes, model, '', 0);
}

function safeFormValue(field: ContentField, raw: unknown) {
  if (
    raw === null ||
    ((field.type === 'string' || field.type === 'text') &&
      typeof raw === 'string')
  ) {
    return { value: raw };
  }
  if (
    (field.type === 'rich_text' || field.type === 'structured_text') &&
    Array.isArray(raw) &&
    raw.length === 0
  ) {
    return { value: field.type === 'rich_text' ? [] : null };
  }
  return undefined;
}

function restoreFormValues(
  attributes: ObjectValue,
  formValues: ObjectValue,
  model: ContentModel,
  locales: readonly string[],
): MissingValue[] {
  const missing: MissingValue[] = [];
  for (const { field, locale } of fieldSlots(model, locales)) {
    if (fieldValue(attributes, field, locale) !== undefined) continue;
    const raw = fieldValue(formValues, field, locale);
    const safe = safeFormValue(field, raw);
    if (safe) setFieldValue(attributes, field, locale, safe.value);
    else if (raw !== undefined) missing.push({ field, locale, raw });
  }
  return missing;
}

async function restoreSavedContainers(
  ctx: FormReadContext,
  attributes: ObjectValue,
  missing: MissingValue[],
  signal?: AbortSignal,
) {
  if (!missing.length || !ctx.item?.id || !ctx.currentUserAccessToken) return;
  try {
    throwIfAborted(signal);
    const saved = await cancellable(
      buildCmaClient(ctx).items.rawFind(ctx.item.id, {
        nested: true,
        version: 'current',
      }),
      signal,
    );
    throwIfAborted(signal);
    const savedForm = await cancellable(
      ctx.itemToFormValues(saved.data),
      signal,
    );
    throwIfAborted(signal);
    for (const { field, locale, raw } of missing) {
      const savedValue = fieldValue(saved.data.attributes, field, locale);
      if (
        savedValue !== undefined &&
        sameValue(raw, fieldValue(savedForm, field, locale))
      ) {
        setFieldValue(attributes, field, locale, savedValue);
      }
    }
  } catch {
    throwIfAborted(signal);
    // The coverage audit below reports every field that could not be read.
  }
}

/**
 * The SDK serializes an update payload, so it may omit readable fields/locales
 * that the user cannot edit. Recover scalar values from the current form. A
 * saved container is safe only if converting it back yields the same form value;
 * otherwise leave it out and explicitly report incomplete coverage.
 */
export async function readFormRecord(
  ctx: FormReadContext,
  schema: ContentSchema,
  locales: readonly string[],
  signal?: AbortSignal,
): Promise<FormRecordResult> {
  throwIfAborted(signal);
  const model = schema.get(ctx.itemType.id);
  if (!model) throw new Error('The record model is unavailable.');
  const converted = await cancellable(
    ctx.formValuesToItem(ctx.formValues, false),
    signal,
  );
  throwIfAborted(signal);
  if (!converted) {
    throw new Error(
      'Content is still loading; some links could not be checked. Wait for the record to load and scan again.',
    );
  }
  const attributes = { ...converted.attributes };
  const result = () =>
    toRecordInput({ id: ctx.item?.id, attributes }, model, ctx.locale);

  const presentLocales = Array.isArray(ctx.formValues.internalLocales)
    ? ctx.formValues.internalLocales.filter(
        (locale): locale is string => typeof locale === 'string',
      )
    : locales;
  const selectedLocales = [...new Set(locales)].filter((locale) =>
    presentLocales.includes(locale),
  );
  const missing = restoreFormValues(
    attributes,
    ctx.formValues,
    model,
    selectedLocales,
  );
  await restoreSavedContainers(ctx, attributes, missing, signal);

  const warnings = new Set<string>();
  auditCoverage(attributes, model, schema, selectedLocales, (path) => {
    warnings.add(
      `${path}: Current content could not be fully read; some links could not be checked.`,
    );
  });
  return { record: result(), warnings: [...warnings] };
}
