import type { FilterInput, FilterValue } from './types';

/** The control that edits the value of an operator */
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

/**
 * The value of a new tile: "true" for a yes/no operator ("is not null", "is
 * blank"), as the dashboard does, and nothing for the others
 */
export function defaultValue(input: FilterInput): FilterValue | null {
  return input.type === 'scalar' &&
    input.inputType === 'boolean' &&
    !input.array
    ? true
    : null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// A date and time of the CMA, as the value of a datetime-local input, in the
// time zone of the browser
function localDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function scalarText(value: FilterValue, input: FilterInput): string {
  if (input.type === 'scalar' && input.inputType === 'date_time') {
    return typeof value === 'string' ? localDateTime(value) : '';
  }
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

/** The text of a value in its input: a list is comma-separated */
export function textOf(value: FilterValue | null, input: FilterInput): string {
  if (value === null) return '';
  if (valueKind(input) === 'matches') {
    return typeof value === 'object' &&
      !Array.isArray(value) &&
      'pattern' in value
      ? String(value.pattern)
      : '';
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scalarText(entry, input)).join(', ');
  }
  return scalarText(value as FilterValue, input);
}

function scalarValue(text: string, input: FilterInput): FilterValue | null {
  const trimmed = text.trim();
  if (!trimmed || input.type !== 'scalar') return null;
  switch (input.inputType) {
    case 'integer': {
      const number = Number(trimmed);
      return Number.isInteger(number) ? number : null;
    }
    case 'float': {
      const number = Number(trimmed);
      return Number.isFinite(number) ? number : null;
    }
    case 'date_time': {
      const date = new Date(trimmed);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    default:
      return trimmed;
  }
}

/** The value of the text of an input, or `null` while it is not complete */
export function valueOfText(
  text: string,
  input: FilterInput,
): FilterValue | null {
  if (valueKind(input) === 'matches') {
    const pattern = text.trim();
    return pattern ? { pattern } : null;
  }
  if (input.array) {
    const values: FilterValue[] = [];
    for (const part of text.split(',')) {
      const value = scalarValue(part, input);
      if (value === null) {
        if (part.trim()) return null;
        continue;
      }
      values.push(value);
    }
    return values.length > 0 ? values : null;
  }
  return scalarValue(text, input);
}

/** The point of a "near" tile: latitude, longitude and radius in meters */
export function nearValue(
  latitude: string,
  longitude: string,
  radius: string,
): FilterValue | null {
  const numbers = [latitude, longitude, radius].map((text) =>
    text.trim() ? Number(text) : Number.NaN,
  );
  if (numbers.some((number) => !Number.isFinite(number))) return null;
  const [lat, lon, rad] = numbers;
  return { latitude: lat, longitude: lon, radius: rad };
}

/** The keys of the creators of a creator tile ("user:123") */
export function creatorKeys(value: FilterValue | null): string[] {
  const entries = Array.isArray(value) ? value : value === null ? [] : [value];
  const keys: string[] = [];
  for (const entry of entries) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      !Array.isArray(entry) &&
      'type' in entry &&
      'id' in entry
    ) {
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
