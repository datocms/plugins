import type { Field } from 'datocms-plugin-sdk';
import type { IconAvatarSurface } from 'datocms-react-ui/IconAvatar';
import {
  Blocks,
  Braces,
  Calendar,
  Globe,
  Hash,
  Image,
  Link,
  type LucideIcon,
  MapPin,
  Palette,
  ToggleLeft,
  Type,
} from 'lucide-react';

type FieldType = Field['attributes']['field_type'];

/**
 * The group of a field type, as DatoCMS shows it when a field is added: its
 * icon, and the slug of its color tokens (`--color--field-group-<slug>--*`)
 */
type FieldGroup = { icon: LucideIcon; tokenSlug: string };

const groups = {
  text: { icon: Type, tokenSlug: 'text' },
  richText: { icon: Blocks, tokenSlug: 'rich-text' },
  media: { icon: Image, tokenSlug: 'media' },
  datetime: { icon: Calendar, tokenSlug: 'datetime' },
  number: { icon: Hash, tokenSlug: 'number' },
  boolean: { icon: ToggleLeft, tokenSlug: 'boolean' },
  location: { icon: MapPin, tokenSlug: 'location' },
  color: { icon: Palette, tokenSlug: 'color' },
  seo: { icon: Globe, tokenSlug: 'seo' },
  reference: { icon: Link, tokenSlug: 'reference' },
  json: { icon: Braces, tokenSlug: 'json' },
} satisfies Record<string, FieldGroup>;

const groupOfType: Record<FieldType, FieldGroup> = {
  string: groups.text,
  text: groups.text,
  structured_text: groups.text,
  single_block: groups.richText,
  rich_text: groups.richText,
  file: groups.media,
  gallery: groups.media,
  video: groups.media,
  date: groups.datetime,
  date_time: groups.datetime,
  integer: groups.number,
  float: groups.number,
  boolean: groups.boolean,
  lat_lon: groups.location,
  color: groups.color,
  slug: groups.seo,
  seo: groups.seo,
  link: groups.reference,
  links: groups.reference,
  json: groups.json,
};

/** The icon of a field's type, and the colors of its group */
export function fieldTypeIcon(field: Field): {
  icon: LucideIcon;
  surface: IconAvatarSurface;
} {
  const group = groupOfType[field.attributes.field_type] ?? groups.json;
  return {
    icon: group.icon,
    surface: {
      color: `var(--color--field-group-${group.tokenSlug}--surface)`,
      ink: `var(--color--field-group-${group.tokenSlug}--ink)`,
    },
  };
}
