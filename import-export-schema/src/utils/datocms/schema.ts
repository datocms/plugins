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
import type { SchemaTypes } from '@datocms/cma-client';
import type { FieldAttributes } from '@datocms/cma-client/dist/types/generated/SchemaTypes';
import { get } from 'lodash-es';
import { isHardcodedEditor } from './fieldTypeInfo';

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
  types: FieldAttributes['field_type'][];
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

export const fieldGroupColors: Record<
  string,
  {
    IconComponent: SvgComponent;
    fgColor: string;
    bgColor: string;
  }
> = {
  boolean: {
    IconComponent: boolean,
    fgColor: '#c82b1d',
    bgColor: '#fde5e3',
  },
  color: {
    IconComponent: color,
    fgColor: '#b02857',
    bgColor: '#fce2eb',
  },
  datetime: {
    IconComponent: datetime,
    fgColor: '#d76f0e',
    bgColor: '#fef0e2',
  },
  json: {
    IconComponent: json,
    fgColor: '#80a617',
    bgColor: '#f5fdde',
  },
  location: {
    IconComponent: location,
    fgColor: '#1d9f2f',
    bgColor: '#defce2',
  },
  media: {
    IconComponent: media,
    fgColor: '#38ada3',
    bgColor: '#e5fbf9',
  },
  number: {
    IconComponent: number,
    fgColor: '#008499',
    bgColor: '#d7faff',
  },
  reference: {
    IconComponent: reference,
    fgColor: '#1b5899',
    bgColor: '#ddecfc',
  },
  rich_text: {
    IconComponent: richText,
    fgColor: '#38388d',
    bgColor: '#e2e2fa',
  },
  seo: {
    IconComponent: seo,
    fgColor: '#7e2e86',
    bgColor: '#f8dffa',
  },
  text: {
    IconComponent: structuredText,
    fgColor: '#998100',
    bgColor: '#FFF8D6',
  },
};

export const fieldTypeDescriptions: Record<
  FieldAttributes['field_type'],
  string
> = {
  boolean: 'Boolean',
  color: 'Color',
  date: 'Date',
  date_time: 'DateTime',
  file: 'Single Asset',
  float: 'Floating-point Number',
  gallery: 'Asset Gallery',
  integer: 'Integer Number',
  json: 'JSON',
  lat_lon: 'Geolocation',
  link: 'Single Link',
  links: 'Multiple Links',
  seo: 'SEO and Social',
  single_block: 'Modular Content (Single block)',
  rich_text: 'Modular Content (Multiple blocks)',
  slug: 'Slug',
  string: 'Single-line String',
  structured_text: 'Structured Text',
  text: 'Multiple-paragraph Text',
  video: 'External Video',
};

export const validatorsContainingLinks: Array<{
  field_type: FieldAttributes['field_type'];
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
  field_type: FieldAttributes['field_type'];
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
    for (const id of get(field.attributes.validators, validator, []) as string[]) {
      fieldLinkedItemTypeIds.add(id);
    }
  }

  return fieldLinkedItemTypeIds;
}

export async function findLinkedPluginIds(field: SchemaTypes.Field) {
  const fieldLinkedPluginIds = new Set<string>();

  if (!(await isHardcodedEditor(field.attributes.appearance.editor))) {
    fieldLinkedPluginIds.add(field.attributes.appearance.editor);
  }

  for (const addon of field.attributes.appearance.addons) {
    fieldLinkedPluginIds.add(addon.id);
  }

  return fieldLinkedPluginIds;
}
