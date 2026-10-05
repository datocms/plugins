import type { RawApiTypes } from '@datocms/cma-client-browser';

type RawField = RawApiTypes.Field;

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

// Intl.Segmenter isn't in this project's ES2020 type library; every current
// browser has it, and older ones fall back to code points.
type GraphemeSegmenter = new (
  locales: undefined,
  options: { granularity: 'grapheme' },
) => { segment(value: string): Iterable<{ segment: string }> };

const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter })
  .Segmenter;
const segmenter = Segmenter
  ? new Segmenter(undefined, { granularity: 'grapheme' })
  : null;

function* segmentsOf(value: string): Generator<string> {
  if (!segmenter) {
    yield* value;
    return;
  }
  for (const { segment } of segmenter.segment(value)) yield segment;
}

/**
 * The first `count` characters as people see them (joined flags and emoji
 * included), reading no further into the string than needed.
 */
function firstGraphemes(value: string, count: number): string[] {
  const result: string[] = [];
  for (const character of segmentsOf(value)) {
    result.push(character);
    if (result.length >= count) break;
  }
  return result;
}

/** Cuts between visible characters, never inside an emoji, flag, or accent. */
export function truncate(value: string, maxLength = 200): string {
  if (value.length <= maxLength) return value;
  const head = firstGraphemes(value, maxLength + 1);
  return head.length > maxLength
    ? `${head.slice(0, Math.max(0, maxLength - 1)).join('')}…`
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

/** Nodes whose children flow inline, so their text joins without spaces. */
const INLINE_CONTAINERS = new Set(['paragraph', 'heading', 'link', 'itemLink']);

/**
 * The plain text of a Structured Text value: spans within one paragraph or
 * heading join as written, and separate blocks are separated by a space.
 */
function structuredTextOf(node: unknown, visited: WeakSet<object>): string {
  if (Array.isArray(node)) {
    return node.map((child) => structuredTextOf(child, visited)).join(' ');
  }
  if (!isRecord(node) || visited.has(node)) return '';
  visited.add(node);
  if (typeof node.value === 'string') return node.value;
  if (node.type === 'code' && typeof node.code === 'string') return node.code;
  if (node.document !== undefined) {
    return structuredTextOf(node.document, visited);
  }
  const children = Array.isArray(node.children) ? node.children : [];
  const separator = INLINE_CONTAINERS.has(String(node.type)) ? '' : ' ';
  return children
    .map((child) => structuredTextOf(child, visited))
    .join(separator);
}

export function extractStructuredText(
  value: unknown,
  maxLength = Number.POSITIVE_INFINITY,
): string {
  const text = structuredTextOf(value, new WeakSet())
    .replace(/\s+/g, ' ')
    .trim();
  // Keep one extra character so truncate() can tell the title was cut.
  return Number.isFinite(maxLength)
    ? Array.from(text)
        .slice(0, maxLength + 1)
        .join('')
    : text;
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
  const style: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    ...(options.dateOnly
      ? { timeZone: 'UTC' }
      : options.timeZone
        ? { timeZone: options.timeZone, timeStyle: 'short' }
        : { timeStyle: 'short' }),
  };

  try {
    return new Intl.DateTimeFormat(locale, style).format(date);
  } catch {
    // The browser doesn't know the locale or the project's timezone: fall
    // back to its own, rather than failing the whole page.
    try {
      const { timeZone: _timeZone, ...withoutTimeZone } = style;
      return new Intl.DateTimeFormat(undefined, {
        ...withoutTimeZone,
        ...(options.dateOnly ? { timeZone: 'UTC' } : {}),
      }).format(date);
    } catch {
      return null;
    }
  }
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
  const text = extractStructuredText(value, maxLength);
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
