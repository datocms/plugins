import groups, { groupThemes } from '@/utils/fieldTypeGroups';
import { fieldTypeDescription } from '@/utils/types';
import type { SchemaTypes } from '@datocms/cma-client';

export function Field({ field }: { field: SchemaTypes.Field }) {
  const group = groups.find((g) =>
    g.types.includes(field.attributes.field_type),
  )!;
  const { IconComponent, bgColor, fgColor } = groupThemes[group.name]!;

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
          {fieldTypeDescription[field.attributes.field_type]}
        </div>
      </div>
    </div>
  );
}
