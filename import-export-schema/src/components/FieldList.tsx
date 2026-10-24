import type { SchemaTypes } from '@datocms/cma-client';
import sortBy from 'lodash-es/sortBy';
import { Field } from './Field';
import s from './graph.module.css';

type Props = {
  fields: SchemaTypes.Field[];
  fieldsets: SchemaTypes.Fieldset[];
};

/**
 * The fields and fieldsets of a model or block, in the order of their
 * positions. A fieldset lists its own fields under its title.
 */
export function FieldList({ fields, fieldsets }: Props) {
  if (fields.length + fieldsets.length === 0) {
    return <p className={s.fieldListEmpty}>No fields</p>;
  }

  const entries: Array<SchemaTypes.Field | SchemaTypes.Fieldset> = sortBy(
    [...fields.filter((f) => !f.relationships.fieldset.data), ...fieldsets],
    'attributes.position',
  );

  return (
    <ul className={s.fieldList}>
      {entries.map((entry) =>
        entry.type === 'field' ? (
          <li key={entry.id}>
            <Field field={entry} />
          </li>
        ) : (
          <li key={entry.id} className={s.fieldset}>
            <span className={s.fieldsetTitle}>{entry.attributes.title}</span>
            <FieldsetFields fieldset={entry} allFields={fields} />
          </li>
        ),
      )}
    </ul>
  );
}

function FieldsetFields({
  fieldset,
  allFields,
}: {
  fieldset: SchemaTypes.Fieldset;
  allFields: SchemaTypes.Field[];
}) {
  const fields: SchemaTypes.Field[] = sortBy(
    allFields.filter((f) => f.relationships.fieldset.data?.id === fieldset.id),
    'attributes.position',
  );

  if (fields.length === 0) {
    return null;
  }

  return (
    <ul className={s.fieldsetFields}>
      {fields.map((field) => (
        <li key={field.id}>
          <Field field={field} />
        </li>
      ))}
    </ul>
  );
}
