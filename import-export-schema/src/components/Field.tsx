import type { SchemaTypes } from '@datocms/cma-client';
import ApiKey from 'datocms-react-ui/ApiKey';
import EntityRow from 'datocms-react-ui/EntityRow';
import IconAvatar from 'datocms-react-ui/IconAvatar';
import {
  fieldGroupColors,
  fieldTypeDescriptions,
  fieldTypeGroups,
} from '@/utils/datocms/schema';

/**
 * One field: the icon of its group on the color pair of the group, its
 * label, its API key and its type
 */
export function Field({ field }: { field: SchemaTypes.Field }) {
  const group = fieldTypeGroups.find((g) =>
    g.types.includes(field.attributes.field_type),
  );

  const { IconComponent, tokenSlug } =
    fieldGroupColors[group ? group.name : 'json'];

  return (
    <EntityRow
      layout="row"
      image={
        <IconAvatar
          icon={IconComponent}
          size={32}
          surface={{
            color: `var(--color--field-group-${tokenSlug}--surface)`,
            ink: `var(--color--field-group-${tokenSlug}--ink)`,
          }}
        />
      }
      title={field.attributes.label}
      aside={<ApiKey>{field.attributes.api_key}</ApiKey>}
    >
      {fieldTypeDescriptions[field.attributes.field_type] ||
        field.attributes.field_type}
    </EntityRow>
  );
}
