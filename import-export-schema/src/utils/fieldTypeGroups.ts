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
import type { FieldAttributes } from '@datocms/cma-client/dist/types/generated/SchemaTypes';

type SvgComponent = React.FunctionComponent<
  React.ComponentProps<'svg'> & {
    title?: string;
    titleId?: string;
    desc?: string;
    descId?: string;
  }
>;

const groups: Array<{ name: string; types: FieldAttributes['field_type'][] }> =
  [
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

export default groups;

export const groupThemes: Record<
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
