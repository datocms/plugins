import type { SchemaTypes } from '@datocms/cma-client';
import get from 'lodash-es/get';
/**
 * Shared lookups and helper utilities for interpreting DatoCMS field metadata.
 */
import boolean from '@/icons/fieldgroup-boolean.svg?react';
import color from '@/icons/fieldgroup-color.svg?react';
import datetime from '@/icons/fieldgroup-datetime.svg?react';
import json from '@/icons/fieldgroup-json.svg?react';
import location from '@/icons/fieldgroup-location.svg?react';
import media from '@/icons/fieldgroup-media.svg?react';
import number from '@/icons/fieldgroup-number.svg?react';
import reference from '@/icons/fieldgroup-reference.svg?react';
import richText from '@/icons/fieldgroup-rich_text.svg?react';
import seo from '@/icons/fieldgroup-seo.svg?react';
import structuredText from '@/icons/fieldgroup-structured_text.svg?react';

// Note: Avoid network requests when resolving plugin dependencies.
// Call sites should pass the set of installed plugin IDs to determine
// whether an editor/addon refers to a plugin.

type SvgComponent = React.FunctionComponent<
  React.ComponentProps<'svg'> & {
    title?: string;
    titleId?: string;
    desc?: string;
    descId?: string;
  }
>;

export const fieldTypeGroups: Array<{
  name: string;
  types: SchemaTypes.Field['attributes']['field_type'][];
}> = [
  {
    name: 'text',
    types: ['string', 'text', 'structured_text'],
  },
  {
    name: 'rich_text',
    types: ['single_block', 'rich_text'],
  },
  {
    name: 'media',
    types: ['file', 'gallery', 'video'],
  },
  {
    name: 'datetime',
    types: ['date', 'date_time'],
  },
  {
    name: 'number',
    types: ['integer', 'float'],
  },
  {
    name: 'boolean',
    types: ['boolean'],
  },
  {
    name: 'location',
    types: ['lat_lon'],
  },
  {
    name: 'color',
    types: ['color'],
  },
  {
    name: 'seo',
    types: ['slug', 'seo'],
  },
  {
    name: 'reference',
    types: ['link', 'links'],
  },
  {
    name: 'json',
    types: ['json'],
  },
];

/**
 * The color pair of a field group, as the slug of its tokens:
 * `--color--field-group-<slug>--surface` and `--color--field-group-<slug>--ink`.
 */
export type FieldGroupToken =
  | 'boolean'
  | 'color'
  | 'datetime'
  | 'json'
  | 'location'
  | 'media'
  | 'number'
  | 'reference'
  | 'rich-text'
  | 'seo'
  | 'text';

export const fieldGroupColors: Record<
  string,
  {
    IconComponent: SvgComponent;
    tokenSlug: FieldGroupToken;
  }
> = {
  boolean: { IconComponent: boolean, tokenSlug: 'boolean' },
  color: { IconComponent: color, tokenSlug: 'color' },
  datetime: { IconComponent: datetime, tokenSlug: 'datetime' },
  json: { IconComponent: json, tokenSlug: 'json' },
  location: { IconComponent: location, tokenSlug: 'location' },
  media: { IconComponent: media, tokenSlug: 'media' },
  number: { IconComponent: number, tokenSlug: 'number' },
  reference: { IconComponent: reference, tokenSlug: 'reference' },
  rich_text: { IconComponent: richText, tokenSlug: 'rich-text' },
  seo: { IconComponent: seo, tokenSlug: 'seo' },
  text: { IconComponent: structuredText, tokenSlug: 'text' },
};

export const fieldTypeDescriptions: Record<
  SchemaTypes.Field['attributes']['field_type'],
  string
> = {
  boolean: 'Boolean',
  color: 'Color',
  date: 'Date',
  date_time: 'Date and time',
  file: 'Single asset',
  float: 'Floating-point number',
  gallery: 'Asset gallery',
  integer: 'Integer number',
  json: 'JSON',
  lat_lon: 'Geolocation',
  link: 'Single link',
  links: 'Multiple links',
  seo: 'SEO and social',
  single_block: 'Modular content (single block)',
  rich_text: 'Modular content (multiple blocks)',
  slug: 'Slug',
  string: 'Single-line string',
  structured_text: 'Structured text',
  text: 'Multiple-paragraph text',
  video: 'External video',
};

export const validatorsContainingLinks: Array<{
  field_type: SchemaTypes.Field['attributes']['field_type'];
  validator: string;
}> = [
  { field_type: 'link', validator: 'item_item_type.item_types' },
  { field_type: 'links', validator: 'items_item_type.item_types' },
  {
    field_type: 'structured_text',
    validator: 'structured_text_links.item_types',
  },
];

export const validatorsContainingBlocks: Array<{
  field_type: SchemaTypes.Field['attributes']['field_type'];
  validator: string;
}> = [
  { field_type: 'rich_text', validator: 'rich_text_blocks.item_types' },
  { field_type: 'single_block', validator: 'single_block_blocks.item_types' },
  {
    field_type: 'structured_text',
    validator: 'structured_text_blocks.item_types',
  },
  {
    field_type: 'structured_text',
    validator: 'structured_text_inline_blocks.item_types',
  },
];

// Collect all item type IDs referenced by validators for the given field.
export function findLinkedItemTypeIds(field: SchemaTypes.Field) {
  const fieldLinkedItemTypeIds = new Set<string>();

  const validators = [
    ...validatorsContainingLinks.filter(
      (i) => i.field_type === field.attributes.field_type,
    ),
    ...validatorsContainingBlocks.filter(
      (i) => i.field_type === field.attributes.field_type,
    ),
  ].map((i) => i.validator);

  for (const validator of validators) {
    for (const id of get(
      field.attributes.validators,
      validator,
      [],
    ) as string[]) {
      fieldLinkedItemTypeIds.add(id);
    }
  }

  return fieldLinkedItemTypeIds;
}

// Collect plugin IDs referenced via appearance editors/addons, filtering by installed list when available.
export function findLinkedPluginIds(
  field: SchemaTypes.Field,
  installedPluginIds?: Set<string>,
) {
  const fieldLinkedPluginIds = new Set<string>();
  // Some fields may have no appearance set (older exports or defaults)
  const editorId = field.attributes.appearance?.editor;
  const hasInstalledList = installedPluginIds !== undefined;

  // If we have a list of installed plugins, only collect editors that match.
  // If not, skip editor to avoid false-positives for built-in editors.
  if (editorId && hasInstalledList && installedPluginIds?.has(editorId)) {
    fieldLinkedPluginIds.add(editorId);
  }

  for (const addon of field.attributes.appearance?.addons ?? []) {
    // If we don't have the installed list yet, include addons optimistically;
    // otherwise include only if installed.
    if (!hasInstalledList || installedPluginIds?.has(addon.id)) {
      fieldLinkedPluginIds.add(addon.id);
    }
  }

  return fieldLinkedPluginIds;
}
