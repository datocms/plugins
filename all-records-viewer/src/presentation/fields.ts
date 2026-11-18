import type { RawApiTypes } from '@datocms/cma-client-browser';
import type { RawItemType } from '../types';

export type RawField = RawApiTypes.Field;

function fieldById(
  fields: readonly RawField[],
  id: string | undefined,
): RawField | undefined {
  return id ? fields.find((field) => field.id === id) : undefined;
}

function earliestField(
  fields: readonly RawField[],
  matches: (field: RawField) => boolean,
): RawField | undefined {
  let earliest: RawField | undefined;
  for (const field of fields) {
    if (!matches(field)) continue;
    if (
      !earliest ||
      field.attributes.position < earliest.attributes.position ||
      (field.attributes.position === earliest.attributes.position &&
        field.attributes.api_key.localeCompare(earliest.attributes.api_key) < 0)
    ) {
      earliest = field;
    }
  }
  return earliest;
}

/**
 * The field that gives the title of the records of a model, as DatoCMS picks
 * it: the list sorts by it for the Title column
 */
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

  const heading = earliestField(
    fields,
    ({ attributes }) =>
      attributes.field_type === 'string' &&
      attributes.appearance.editor === 'single_line' &&
      Boolean(attributes.appearance.parameters.heading),
  );

  return (
    heading ??
    earliestField(
      fields,
      ({ attributes }) => attributes.field_type === 'string',
    ) ??
    earliestField(fields, ({ attributes }) =>
      ['text', 'structured_text'].includes(attributes.field_type),
    )
  );
}
