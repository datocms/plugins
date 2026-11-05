import type { SchemaTypes } from '@datocms/cma-client';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import RowList from 'datocms-react-ui/RowList';
import sortBy from 'lodash-es/sortBy';
import { Field } from './Field';
import s from './graph.module.css';

type Props = {
  fields: SchemaTypes.Field[];
  fieldsets: SchemaTypes.Fieldset[];
};

/**
 * The fields and fieldsets of a model or block, in the order of their
 * positions. The fields out of a fieldset that follow each other share one
 * list of rows, and a fieldset lists its own fields under its title.
 */
export function FieldList({ fields, fieldsets }: Props) {
  if (fields.length + fieldsets.length === 0) {
    return <EmptySlot message="No fields" />;
  }

  const entries: Array<SchemaTypes.Field | SchemaTypes.Fieldset> = sortBy(
    [...fields.filter((f) => !f.relationships.fieldset.data), ...fieldsets],
    'attributes.position',
  );

  const groups: Array<SchemaTypes.Field[] | SchemaTypes.Fieldset> = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (entry.type === 'fieldset') {
      groups.push(entry);
    } else if (Array.isArray(last)) {
      last.push(entry);
    } else {
      groups.push([entry]);
    }
  }

  return (
    <div className={s.fieldList}>
      {groups.map((group) =>
        Array.isArray(group) ? (
          <FieldRows key={group[0].id} fields={group} />
        ) : (
          <div key={group.id} className={s.fieldset}>
            <span className={s.fieldsetTitle}>{group.attributes.title}</span>
            <FieldRows
              fields={sortBy(
                fields.filter(
                  (f) => f.relationships.fieldset.data?.id === group.id,
                ),
                'attributes.position',
              )}
            />
          </div>
        ),
      )}
    </div>
  );
}

/**
 * Fields as inset rows that only show their content. The text of the rows
 * stays on the edge of the column around them.
 */
export function FieldRows({ fields }: { fields: SchemaTypes.Field[] }) {
  if (fields.length === 0) {
    return null;
  }

  return (
    <div className={s.fieldRows}>
      <RowList>
        {fields.map((field) => (
          <RowList.Item key={field.id}>
            <Field field={field} />
          </RowList.Item>
        ))}
      </RowList>
    </div>
  );
}
