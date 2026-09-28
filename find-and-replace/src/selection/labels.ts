import {
  embeddedBlockCandidates,
  ownerAttributes,
  readItemId,
  readItemModelId,
} from './traversal';
import type {
  BlockAncestryEntry,
  FieldValueRef,
  SchemaIndex,
  TextFragment,
  ValuePath,
} from './types';

type UnknownRecord = Record<string, unknown>;

/** Attributes tried, in order, after the model's own title field. */
const TITLE_FALLBACK_API_KEYS = ['title', 'name', 'heading', 'label', 'slug'];

const SEO_SUBFIELD_LABELS: Readonly<Record<string, string>> = {
  title: 'Title',
  description: 'Description',
};

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function valueAtPath(value: unknown, path: ValuePath): unknown {
  let current = value;
  for (const part of path) {
    if (typeof part === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[part];
      continue;
    }
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[part];
  }
  return current;
}

function fieldLabel(
  schema: SchemaIndex,
  fieldId: string,
  fallbackApiKey: string,
): string {
  return schema.fieldsById.get(fieldId)?.label || fallbackApiKey;
}

function blockModelName(schema: SchemaIndex, blockModelId: string): string {
  const model = schema.modelsById.get(blockModelId);
  return model?.name || model?.apiKey || 'Block';
}

/**
 * The value of the field that holds the block at `ancestry[index]`: read from
 * the root record for the outermost block, else from the enclosing block.
 */
function parentFieldValue(
  record: object,
  ancestry: ReadonlyArray<BlockAncestryEntry>,
  index: number,
): unknown {
  const entry = ancestry[index];
  const enclosingBlock = ancestry[index - 1];
  const owner = asRecord(
    enclosingBlock ? valueAtPath(record, enclosingBlock.valuePath) : record,
  );
  if (!entry || !owner) return undefined;

  const { attributes } = ownerAttributes(owner, []);
  const value = attributes[entry.parentFieldApiKey];
  return entry.locale === null ? value : asRecord(value)?.[entry.locale];
}

/**
 * 1-based position of the block among the blocks of the same block model in
 * its parent field value, or null when that field holds only one of them.
 * Single Blocks never get a position.
 */
function blockOrdinal(
  record: object,
  ancestry: ReadonlyArray<BlockAncestryEntry>,
  index: number,
): number | null {
  const entry = ancestry[index];
  if (!entry || entry.kind === 'single_block') return null;

  const siblings = embeddedBlockCandidates(
    entry.kind === 'modular_content' ? 'rich_text' : 'structured_text',
    parentFieldValue(record, ancestry, index),
  ).filter(
    (candidate) => readItemModelId(candidate.block) === entry.blockModelId,
  );
  if (siblings.length < 2) return null;

  const position = siblings.findIndex(
    (candidate) => readItemId(candidate.block) === entry.blockId,
  );
  return position < 0 ? null : position + 1;
}

/** "Title" or "Description" for a match inside an SEO field value. */
export function seoSubfieldLabel(
  fragments: ReadonlyArray<TextFragment> | undefined,
): string | null {
  const key = fragments?.[0]?.path[0];
  return typeof key === 'string' ? (SEO_SUBFIELD_LABELS[key] ?? null) : null;
}

/**
 * Human path of a field value, schema labels only, outermost first. For each
 * enclosing block: the parent field's label (skipped when it repeats the
 * previous segment), then the block model's name, with a 1-based ordinal when
 * the parent field holds 2+ blocks of that model ("Quote 2"). Then the field's
 * own label. A match in an SEO field adds "Title" or "Description" from its
 * fragments.
 *
 * `record` is the root record the field value was traversed from (as fetched,
 * nested), used to count sibling blocks.
 *
 * ['Title'], ['Content', 'Quote 2', 'Text'], ['SEO', 'Description'].
 */
export function fieldPathSegments({
  fieldValue,
  schema,
  record,
  fragments,
}: {
  fieldValue: FieldValueRef;
  schema: SchemaIndex;
  record: object;
  fragments?: ReadonlyArray<TextFragment>;
}): string[] {
  const segments: string[] = [];

  for (const [index, entry] of fieldValue.blockAncestry.entries()) {
    const parentLabel = fieldLabel(
      schema,
      entry.parentFieldId,
      entry.parentFieldApiKey,
    );
    if (segments[segments.length - 1] !== parentLabel) {
      segments.push(parentLabel);
    }

    const name = blockModelName(schema, entry.blockModelId);
    const ordinal = blockOrdinal(record, fieldValue.blockAncestry, index);
    segments.push(ordinal === null ? name : `${name} ${ordinal}`);
  }

  segments.push(fieldLabel(schema, fieldValue.fieldId, fieldValue.fieldApiKey));

  const seoLabel =
    fieldValue.fieldType === 'seo' ? seoSubfieldLabel(fragments) : null;
  if (seoLabel) segments.push(seoLabel);
  return segments;
}

/**
 * API key of the field that titles a model's records: the model's
 * `presentation_title_field`, else its `title_field`.
 */
export function titleFieldApiKey(
  schema: SchemaIndex,
  modelId: string,
): string | undefined {
  const raw = schema.modelsById.get(modelId)?.raw;
  for (const fieldId of [
    raw?.presentation_title_field?.id,
    raw?.title_field?.id,
  ]) {
    const apiKey = fieldId ? schema.fieldsById.get(fieldId)?.apiKey : undefined;
    if (apiKey) return apiKey;
  }
  return undefined;
}

function textLabel(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : null;
}

/**
 * A plain value, or a localized one: the first of `locales` with a value.
 * Without site locales, any key of the localized object is tried.
 */
function attributeLabel(
  value: unknown,
  locales: ReadonlyArray<string>,
): string | null {
  const direct = textLabel(value);
  if (direct) return direct;

  const localized = asRecord(value);
  if (!localized) return null;
  for (const locale of locales.length > 0 ? locales : Object.keys(localized)) {
    const label = textLabel(localized[locale]);
    if (label) return label;
  }
  return null;
}

/**
 * Title of a record: `preferredApiKey` (see `titleFieldApiKey`), then the
 * usual title-like attributes, in the first site locale with a value. Accepts
 * raw API records (fields under `attributes`) and simple ones (fields at the
 * top level, as `items.update` returns them). Null when nothing fits; the UI
 * then shows "Record #{id}".
 */
export function recordTitle(
  record: object,
  locales: ReadonlyArray<string> = [],
  preferredApiKey?: string,
): string | null {
  const { attributes } = ownerAttributes(record as UnknownRecord, []);
  const keys = preferredApiKey
    ? [preferredApiKey, ...TITLE_FALLBACK_API_KEYS]
    : TITLE_FALLBACK_API_KEYS;

  for (const key of keys) {
    const label = attributeLabel(attributes[key], locales);
    if (label) return label;
  }
  return null;
}

/** `recordTitle` using the record's model title field from the schema. */
export function modelRecordTitle(
  schema: SchemaIndex,
  modelId: string,
  record: object,
  locales: ReadonlyArray<string>,
): string | null {
  return recordTitle(record, locales, titleFieldApiKey(schema, modelId));
}
