import type { SchemaTypes } from '@datocms/cma-client';
import {
  fieldGroupColors,
  fieldTypeDescriptions,
  fieldTypeGroups,
} from '@/utils/datocms/schema';

/**
 * Displays a field summary with consistent iconography and type information.
 */
export function Field({ field }: { field: SchemaTypes.Field }) {
  const group = fieldTypeGroups.find((g) =>
    g.types.includes(field.attributes.field_type),
  );

  // Fallback to the generic JSON icon/color when the field type has no group match.
  const { IconComponent, bgColor, fgColor } =
    fieldGroupColors[group ? group.name : 'json'];

  return (
    <div className="field">
      <div className="field__icon" style={{ backgroundColor: bgColor }}>
        <IconComponent style={{ fill: fgColor }} />
      </div>
      <div className="field__body">
        <div>
          <span className="field__label">{field.attributes.label}</span>{' '}
          <code>{field.attributes.api_key}</code>
        </div>
        <div className="field__type">
          {fieldTypeDescriptions[field.attributes.field_type] ||
            field.attributes.field_type}
        </div>
      </div>
    </div>
  );
}
