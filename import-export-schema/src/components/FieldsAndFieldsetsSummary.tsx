import type { SchemaTypes } from '@datocms/cma-client';
import { Button } from 'datocms-react-ui';
import { useState } from 'react';

type Props = {
  fields: SchemaTypes.Field[];
  fieldsets: SchemaTypes.Fieldset[];
  initialFields?: number;
  initialFieldsets?: number;
};

export default function FieldsAndFieldsetsSummary({
  fields,
  fieldsets,
  initialFields = 10,
  initialFieldsets = 6,
}: Props) {
  const [fieldLimit, setFieldLimit] = useState(initialFields);
  const [fieldsetLimit, setFieldsetLimit] = useState(initialFieldsets);

  return (
    <div>
      <div className="box__meta" style={{ marginBottom: 6 }}>
        {fields.length} fields • {fieldsets.length} fieldsets
      </div>
      {fields.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Fields</div>
          <ul className="list--plain list--slim" style={{ margin: 0 }}>
            {fields.slice(0, fieldLimit).map((f) => {
              const label = f.attributes.label || f.attributes.api_key;
              return (
                <li key={f.id}>
                  <span
                    style={{
                      minWidth: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'inline-block',
                      maxWidth: '100%',
                    }}
                  >
                    {label}{' '}
                    <span style={{ color: '#666' }}>
                      (<code>{f.attributes.api_key}</code>)
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {fields.length > initialFields && (
            <div style={{ marginTop: 6 }}>
              <Button
                buttonSize="s"
                onClick={() =>
                  setFieldLimit(
                    fieldLimit >= fields.length ? initialFields : fields.length,
                  )
                }
              >
                {fieldLimit >= fields.length
                  ? `Show first ${initialFields}`
                  : `Show all ${fields.length}`}
              </Button>
            </div>
          )}
        </div>
      )}

      {fieldsets.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Fieldsets</div>
          <ul className="list--plain list--slim" style={{ margin: 0 }}>
            {fieldsets.slice(0, fieldsetLimit).map((fs) => (
              <li key={fs.id}>
                <span
                  style={{
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'inline-block',
                    maxWidth: '100%',
                  }}
                >
                  {fs.attributes.title}
                </span>
              </li>
            ))}
          </ul>
          {fieldsets.length > initialFieldsets && (
            <div style={{ marginTop: 6 }}>
              <Button
                buttonSize="s"
                onClick={() =>
                  setFieldsetLimit(
                    fieldsetLimit >= fieldsets.length
                      ? initialFieldsets
                      : fieldsets.length,
                  )
                }
              >
                {fieldsetLimit >= fieldsets.length
                  ? `Show first ${initialFieldsets}`
                  : `Show all ${fieldsets.length}`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
