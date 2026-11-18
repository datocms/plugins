import type { FilterInput, FilterValue } from './types';

/** The editor of the value of an operator, in the filter builder */
export type ValueKind =
  | 'boolean'
  | 'enum'
  | 'locale'
  | 'creator'
  | 'matches'
  | 'near'
  | 'date'
  | 'date_time'
  | 'number'
  | 'text';

export function valueKind(input: FilterInput): ValueKind {
  if (input.type === 'object') {
    if ('pattern' in input.arguments) return 'matches';
    if ('latitude' in input.arguments) return 'near';
    return 'creator';
  }
  switch (input.inputType) {
    case 'boolean':
    case 'enum':
    case 'locale':
    case 'date':
    case 'date_time':
      return input.inputType;
    case 'integer':
    case 'float':
      return 'number';
    default:
      return 'text';
  }
}

/** The parts of the point of a "near" filter, in the order of the tile */
export const NEAR_PARTS = ['latitude', 'longitude', 'radius'] as const;

type NearPart = (typeof NEAR_PARTS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === null ? [] : [value];
}

function stringsOf(value: unknown): string[] {
  return listOf(value).map((entry) => String(entry));
}

/** The keys of the creators of a creator filter ("user:123") */
export function creatorKeys(value: unknown): string[] {
  const keys: string[] = [];
  for (const entry of listOf(value)) {
    if (isRecord(entry) && 'type' in entry && 'id' in entry) {
      keys.push(`${String(entry.type)}:${String(entry.id)}`);
    }
  }
  return keys;
}

/** A creator of the CMA, from its key ("user:123") */
export function creatorOfKey(key: string): FilterValue {
  const separator = key.indexOf(':');
  return { type: key.slice(0, separator), id: key.slice(separator + 1) };
}

function textValue(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function nearPart(point: Record<string, unknown>, part: NearPart) {
  const value = point[part];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// One value, or a list of them with `array`; none is null
function oneOrMany(
  values: readonly FilterValue[],
  multiple: boolean,
): FilterValue | null {
  if (values.length === 0) return null;
  return multiple ? values : (values[0] ?? null);
}

function keysOf(value: unknown): string[] {
  return listOf(value).filter(
    (entry): entry is string => typeof entry === 'string' && entry !== '',
  );
}

/**
 * How the value of each kind of operator goes between the URL (and the CMA)
 * and the editor of its tile
 */
type Codec = {
  toEditor: (value: FilterValue | null, input: FilterInput) => unknown;
  toFilter: (value: unknown, input: FilterInput) => FilterValue | null;
};

const CHOICE: Codec = {
  toEditor: (value, input) =>
    input.array ? stringsOf(value) : typeof value === 'string' ? value : null,
  toFilter: (value, input) => oneOrMany(keysOf(value), Boolean(input.array)),
};

const DAY: Codec = {
  toEditor: (value) => (typeof value === 'string' ? value : null),
  toFilter: textValue,
};

const CODECS: Readonly<Record<ValueKind, Codec>> = {
  // The yes/no select has the options "true" and "false"
  boolean: {
    toEditor: (value) => (typeof value === 'boolean' ? String(value) : null),
    toFilter: (value) =>
      value === 'true' ? true : value === 'false' ? false : null,
  },
  enum: CHOICE,
  locale: CHOICE,
  // The select of the creators picks their keys ("user:123")
  creator: {
    toEditor: (value, input) =>
      input.array ? creatorKeys(value) : (creatorKeys(value)[0] ?? null),
    toFilter: (value, input) =>
      oneOrMany(keysOf(value).map(creatorOfKey), Boolean(input.array)),
  },
  // The tile edits the pattern
  matches: {
    toEditor: (value) =>
      isRecord(value) && 'pattern' in value ? String(value.pattern) : '',
    toFilter: (value) => {
      const pattern = textValue(value);
      return pattern ? { pattern } : null;
    },
  },
  // One number for each part, complete or not
  near: {
    toEditor: (value) => {
      const point = isRecord(value) ? value : {};
      return Object.fromEntries(
        NEAR_PARTS.map((part) => [part, nearPart(point, part)]),
      );
    },
    toFilter: (value) => {
      const point = isRecord(value) ? value : {};
      const [latitude, longitude, radius] = NEAR_PARTS.map((part) =>
        nearPart(point, part),
      );
      return latitude == null || longitude == null || radius == null
        ? null
        : { latitude, longitude, radius };
    },
  },
  date: DAY,
  // The picker gives the offset of the project: the CMA gets the instant in
  // UTC, as before the picker
  date_time: {
    toEditor: DAY.toEditor,
    toFilter: (value) => {
      const text = textValue(value);
      const date = text ? new Date(text) : null;
      return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    },
  },
  number: {
    toEditor: (value) => (typeof value === 'number' ? value : null),
    toFilter: (value, input) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      const integer = input.type === 'scalar' && input.inputType === 'integer';
      return integer && !Number.isInteger(value) ? null : value;
    },
  },
  // A text, or a list of texts that the user separates with commas
  text: {
    toEditor: (value, input) => {
      if (input.array) return stringsOf(value);
      return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : '';
    },
    toFilter: (value, input) => {
      if (!input.array) return textValue(value);
      const values = listOf(value)
        .map(textValue)
        .filter((entry): entry is string => entry !== null);
      return values.length > 0 ? values : null;
    },
  },
};

/**
 * The value of a filter in the URL and in the CMA, as the editor of its tile
 * takes it: "true" in the yes/no select, a text, the keys of the creators, a
 * point with one number for each part.
 */
export function editorValueOf(
  value: FilterValue | null,
  input: FilterInput,
): unknown {
  return CODECS[valueKind(input)].toEditor(value, input);
}

/**
 * The value of a filter for the URL and the CMA, from the value of its
 * editor, or `null` while it is not complete: the tile shows, and the list
 * does not use it yet
 */
export function filterValueOf(
  value: unknown,
  input: FilterInput,
): FilterValue | null {
  return CODECS[valueKind(input)].toFilter(value, input);
}
