import type { RawApiTypes } from '@datocms/cma-client-browser';
import type { RawItem, RawItemType } from '../types';

export type RawField = RawApiTypes.Field;

function fieldById(
  fields: readonly RawField[],
  id: string | undefined,
): RawField | undefined {
  return id ? fields.find((field) => field.id === id) : undefined;
}

function sortedFields(fields: readonly RawField[]): RawField[] {
  return [...fields].sort(
    (left, right) =>
      left.attributes.position - right.attributes.position ||
      left.attributes.api_key.localeCompare(right.attributes.api_key),
  );
}

export function getPresentationTitleField(
  itemType: RawItemType,
  fields: readonly RawField[],
): RawField | undefined {
  const configured = fieldById(
    fields,
    itemType.relationships.presentation_title_field.data?.id,
  );

  if (configured) {
    return configured;
  }

  const ordered = sortedFields(fields);
  const heading = ordered.find(
    ({ attributes }) =>
      attributes.field_type === 'string' &&
      attributes.appearance.editor === 'single_line' &&
      Boolean(attributes.appearance.parameters.heading),
  );

  return (
    heading ??
    ordered.find(({ attributes }) => attributes.field_type === 'string') ??
    ordered.find(({ attributes }) =>
      ['text', 'structured_text'].includes(attributes.field_type),
    )
  );
}

export function getPresentationImageField(
  itemType: RawItemType,
  fields: readonly RawField[],
): RawField | undefined {
  const configured = fieldById(
    fields,
    itemType.relationships.presentation_image_field.data?.id,
  );

  if (configured) {
    return configured;
  }

  return sortedFields(fields).find(({ attributes }) =>
    ['file', 'gallery'].includes(attributes.field_type),
  );
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') {
    return false;
  }

  return !Array.isArray(value) || value.length > 0;
}

export function getFieldValue(
  item: RawItem,
  field: RawField,
  locales: readonly string[],
  preferredLocale?: string,
): unknown {
  const value = item.attributes[field.attributes.api_key];

  if (!field.attributes.localized) {
    return value ?? null;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const localizedValue = value as Record<string, unknown>;

  if (preferredLocale && hasValue(localizedValue[preferredLocale])) {
    return localizedValue[preferredLocale];
  }

  for (const locale of locales) {
    if (hasValue(localizedValue[locale])) {
      return localizedValue[locale];
    }
  }

  return null;
}

export function linkedItemIdFromValue(value: unknown): string | null {
  if (typeof value === 'string' && value) {
    return value;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const objectValue = value as Record<string, unknown>;
  const itemId = objectValue.itemId ?? objectValue.item_id ?? objectValue.id;
  return typeof itemId === 'string' && itemId ? itemId : null;
}
