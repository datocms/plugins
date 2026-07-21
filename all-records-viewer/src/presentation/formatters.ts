import type { RawField } from './fields';

export type RgbaColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

export type LatLonValue = {
  latitude: number;
  longitude: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function truncate(value: string, maxLength = 200): string {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 1))}…`
    : value;
}

function decodeBasicEntities(value: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&apos;': "'",
    '&#39;': "'",
    '&gt;': '>',
    '&lt;': '<',
    '&nbsp;': ' ',
    '&quot;': '"',
  };

  return value.replace(
    /&(amp|apos|#39|gt|lt|nbsp|quot);/gi,
    (entity) => entities[entity.toLowerCase()] ?? entity,
  );
}

function textFromHtml(value: string): string {
  return decodeBasicEntities(
    value
      .replace(/<\s*br\s*\/?>/gi, ' ')
      .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function textFromMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-+*])\s+/gm, '')
    .replace(/(`{1,3}|\*{1,3}|_{1,3}|~~)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function structuredTextStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const child of value) {
      structuredTextStrings(child, output);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (typeof value.value === 'string') {
    output.push(value.value);
  }

  if ('document' in value) {
    structuredTextStrings(value.document, output);
  }

  if ('children' in value) {
    structuredTextStrings(value.children, output);
  }
}

export function extractStructuredText(value: unknown): string {
  const strings: string[] = [];
  structuredTextStrings(value, strings);
  return strings.join(' ').replace(/\s+/g, ' ').trim();
}

export function isRgbaColor(value: unknown): value is RgbaColor {
  if (!isRecord(value)) {
    return false;
  }

  return ['red', 'green', 'blue', 'alpha'].every(
    (key) => typeof value[key] === 'number',
  );
}

export function formatColor(value: RgbaColor): string {
  const hex = [value.red, value.green, value.blue]
    .map((component) =>
      Math.max(0, Math.min(255, component)).toString(16).padStart(2, '0'),
    )
    .join('');
  const alpha = Math.round(
    (Math.max(0, Math.min(255, value.alpha)) / 255) * 100,
  );

  return `#${hex}${value.alpha === 255 ? '' : ` ${alpha}%`}`.toUpperCase();
}

export function isLatLonValue(value: unknown): value is LatLonValue {
  return (
    isRecord(value) &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number'
  );
}

export function formatCoordinates(value: LatLonValue): string {
  return `Lat: ${value.latitude.toFixed(4)} Lon: ${value.longitude.toFixed(4)}`;
}

function dateFromValue(value: string, dateOnly: boolean): Date | null {
  const parsed = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export function formatDate(
  value: string,
  options: {
    dateOnly: boolean;
    locales?: readonly string[];
    timeZone?: string;
  },
): string | null {
  const date = dateFromValue(value, options.dateOnly);
  if (!date) {
    return null;
  }

  const locale = options.locales?.[0];
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(options.dateOnly
      ? { timeZone: 'UTC' }
      : options.timeZone
        ? { timeZone: options.timeZone, timeStyle: 'short' }
        : { timeStyle: 'short' }),
  });

  return formatter.format(date);
}

type FieldTitleOptions = {
  maxLength?: number;
  locales?: readonly string[];
  timeZone?: string;
};

type FieldTitleContext = {
  value: unknown;
  field: RawField;
  maxLength: number;
  options: FieldTitleOptions;
};

type FieldTitleFormatter = (context: FieldTitleContext) => string | null;

const formatTextTitle: FieldTitleFormatter = ({ value, field, maxLength }) => {
  if (typeof value !== 'string') return null;

  const editor = field.attributes.appearance.editor;
  const text =
    editor === 'wysiwyg'
      ? textFromHtml(value)
      : editor === 'markdown'
        ? textFromMarkdown(value)
        : value;
  return truncate(text, maxLength);
};

const formatStructuredTextTitle: FieldTitleFormatter = ({
  value,
  maxLength,
}) => {
  const text = extractStructuredText(value);
  return text ? truncate(text, maxLength) : null;
};

const formatVideoTitle: FieldTitleFormatter = ({ value, maxLength }) =>
  isRecord(value) && typeof value.title === 'string'
    ? truncate(value.title, maxLength)
    : null;

const formatDateTitle: FieldTitleFormatter = ({ value, field, options }) =>
  typeof value === 'string'
    ? formatDate(value, {
        dateOnly: field.attributes.field_type === 'date',
        locales: options.locales,
        timeZone: options.timeZone,
      })
    : null;

const formatColorTitle: FieldTitleFormatter = ({ value }) =>
  isRgbaColor(value) ? formatColor(value) : null;

const formatCoordinatesTitle: FieldTitleFormatter = ({ value }) =>
  isLatLonValue(value) ? formatCoordinates(value) : null;

const formatNumberTitle: FieldTitleFormatter = ({ value }) =>
  typeof value === 'number' ? String(value) : null;

const FIELD_TITLE_FORMATTERS: Partial<
  Record<RawField['attributes']['field_type'], FieldTitleFormatter>
> = {
  text: formatTextTitle,
  structured_text: formatStructuredTextTitle,
  video: formatVideoTitle,
  date: formatDateTitle,
  date_time: formatDateTitle,
  color: formatColorTitle,
  lat_lon: formatCoordinatesTitle,
  integer: formatNumberTitle,
  float: formatNumberTitle,
};

export function formatFieldTitle(
  value: unknown,
  field: RawField,
  options: FieldTitleOptions = {},
): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const maxLength = options.maxLength ?? 200;
  const formatter = FIELD_TITLE_FORMATTERS[field.attributes.field_type];

  return formatter
    ? formatter({ value, field, maxLength, options })
    : typeof value === 'string'
      ? truncate(value, maxLength)
      : null;
}
