import type { RawApiTypes } from '@datocms/cma-client-browser';
import { formatFieldTitle, truncate } from './formatters';

type Field = RawApiTypes.Field;
type ItemType = RawApiTypes.ItemType;

export const TITLE_MAX_LENGTH = 200;

function fieldById(fields: readonly Field[], id: string | null | undefined) {
  return id ? fields.find((field) => field.id === id) : undefined;
}

/** The field with the lowest position among those that match. */
function firstField(
  fields: readonly Field[],
  matches: (field: Field) => boolean,
): Field | undefined {
  let first: Field | undefined;
  for (const field of fields) {
    if (!matches(field)) continue;
    if (!first || field.attributes.position < first.attributes.position) {
      first = field;
    }
  }
  return first;
}

const TEXTUAL_TYPES = new Set(['text', 'structured_text']);

/**
 * The field the dashboard shows as a record's title: the model's presentation
 * title field, then its title field, then the first heading, string, or text.
 */
export function getTitleField(
  itemType: ItemType,
  fields: readonly Field[],
): Field | undefined {
  const { presentation_title_field, title_field } = itemType.relationships;
  return (
    fieldById(fields, presentation_title_field.data?.id) ??
    fieldById(fields, title_field.data?.id) ??
    firstField(
      fields,
      ({ attributes }) =>
        attributes.field_type === 'string' &&
        Boolean(
          (attributes.appearance.parameters as Record<string, unknown>).heading,
        ),
    ) ??
    firstField(
      fields,
      ({ attributes }) => attributes.field_type === 'string',
    ) ??
    firstField(fields, ({ attributes }) =>
      TEXTUAL_TYPES.has(attributes.field_type),
    )
  );
}

/** The model's presentation image field, then its first file or gallery. */
export function getImageField(
  itemType: ItemType,
  fields: readonly Field[],
): Field | undefined {
  const { presentation_image_field, image_preview_field } =
    itemType.relationships;
  return (
    fieldById(fields, presentation_image_field.data?.id) ??
    fieldById(fields, image_preview_field.data?.id) ??
    firstField(fields, ({ attributes }) =>
      ['file', 'gallery'].includes(attributes.field_type),
    )
  );
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

/** A field's value, taking the first locale that has one for localized fields. */
export function readFieldValue(
  attributes: Record<string, unknown>,
  field: Field,
  locales: readonly string[],
): unknown {
  const value = attributes[field.attributes.api_key];
  if (!field.attributes.localized) return value ?? null;
  if (typeof value !== 'object' || value === null) return null;

  const byLocale = value as Record<string, unknown>;
  for (const locale of locales) {
    if (hasValue(byLocale[locale])) return byLocale[locale];
  }
  return null;
}

export type TitleOptions = {
  locales: readonly string[];
  timeZone?: string;
};

/** Link and single-block titles show the linked record's own title. */
export function isLinkField(field: Field): boolean {
  return ['link', 'single_block'].includes(field.attributes.field_type);
}

/** The record ID a link or single-block value points at. */
export function linkedItemIdFromValue(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = record.itemId ?? record.item_id ?? record.id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * A title field's value as one plain line (dates, colors, coordinates and
 * rich text formatted as the all-records-viewer does), or null when empty.
 */
export function formatTitle(
  value: unknown,
  field: Field,
  options: TitleOptions,
): string | null {
  if (isLinkField(field)) return null;
  try {
    // Collapse whitespace before cutting, so line breaks don't eat the length.
    const title = formatFieldTitle(value, field, {
      maxLength: Number.POSITIVE_INFINITY,
      locales: options.locales,
      timeZone: options.timeZone,
    })
      ?.replace(/\s+/g, ' ')
      .trim();
    return title ? truncate(title, TITLE_MAX_LENGTH) : null;
  } catch {
    // One odd value shouldn't fail the page: show "Record #id" instead.
    return null;
  }
}

/** The upload ID behind a file or gallery value (a gallery shows its first image). */
export function uploadIdFromValue(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== 'object' || first === null) return null;
  const uploadId = (first as Record<string, unknown>).upload_id;
  return typeof uploadId === 'string' && uploadId ? uploadId : null;
}
