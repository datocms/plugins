import {
  encodedTextEncoder,
  jsonTextEncoder,
  storesMarkup,
} from '../selection/encodedText';
import { stableSerialize } from '../selection/identity';
import { matchesForTraversedField, parseNumber } from '../selection/matcher';
import { isExactMatchCompatibleFieldType } from '../selection/schemaIndex';
import type {
  ExactMatchRef,
  MatcherSpec,
  TraversedFieldValue,
  ValuePath,
} from '../selection/types';

type UnknownRecord = Record<string, unknown>;

type TextEdit = {
  start: number;
  end: number;
  replacement: string;
};

/**
 * The text inserted for each match: the same string for every match, or one
 * computed per match (a regex template expanded with that match's captures,
 * see `templateReplacer`).
 */
export type MatchReplacement = string | ((match: ExactMatchRef) => string);

export type FieldReplacementResult = {
  supported: boolean;
  changed: boolean;
  value: unknown;
  replacementCount: number;
  preview?: {
    beforeContext: string;
    beforeTruncated: boolean;
    matchedText: string;
    replacementText: string;
    afterContext: string;
    afterTruncated: boolean;
  };
};

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, cloneValue(entry)]),
  );
}

function valueAtPath(value: unknown, path: ValuePath): unknown {
  let current = value;

  for (const part of path) {
    if (typeof part === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[part];
      continue;
    }

    const record = asRecord(current);
    if (!record) return undefined;
    current = record[part];
  }

  return current;
}

function setValueAtPath(
  value: unknown,
  path: ValuePath,
  nextValue: unknown,
): unknown {
  if (path.length === 0) return nextValue;
  const result = cloneValue(value);
  let current = result;

  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index];
    if (typeof part === 'number') {
      if (!Array.isArray(current)) {
        throw new Error('The selected text location is no longer available.');
      }
      current = current[part];
      continue;
    }

    const record = asRecord(current);
    if (!record) {
      throw new Error('The selected text location is no longer available.');
    }
    current = record[part];
  }

  const finalPart = path[path.length - 1];
  if (typeof finalPart === 'number') {
    if (!Array.isArray(current)) {
      throw new Error('The selected text location is no longer available.');
    }
    current[finalPart] = nextValue;
  } else {
    const record = asRecord(current);
    if (!record) {
      throw new Error('The selected text location is no longer available.');
    }
    record[finalPart] = nextValue;
  }

  return result;
}

function pathKey(path: ValuePath): string {
  return stableSerialize(path);
}

function applyTextEdits(text: string, edits: ReadonlyArray<TextEdit>): string {
  const ordered = [...edits].sort(
    (left, right) => right.start - left.start || right.end - left.end,
  );
  let result = text;
  let nextStart = text.length;

  for (const edit of ordered) {
    if (
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > text.length ||
      edit.end > nextStart
    ) {
      throw new Error(
        'The selected text ranges overlap or are no longer valid.',
      );
    }
    result =
      result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    nextStart = edit.start;
  }

  return result;
}

function replacementFor(
  replacement: MatchReplacement,
  match: ExactMatchRef,
): string {
  return typeof replacement === 'string' ? replacement : replacement(match);
}

type Encode = (text: string) => string;

const AS_TYPED: Encode = (text) => text;

/** How the inserted text is written into the stored value. */
function encoderFor(fieldValue: TraversedFieldValue): Encode {
  const { value, field } = fieldValue;
  if (typeof value !== 'string') return AS_TYPED;
  switch (field.fieldType) {
    case 'text':
      return encodedTextEncoder(value, storesMarkup(field));
    case 'json':
      return jsonTextEncoder(value);
    default:
      return AS_TYPED;
  }
}

/**
 * Groups the edits by text location. The first fragment of a match receives
 * its whole replacement (keeping that span's marks); later fragments of a
 * match spanning several Structured Text spans (or HTML tags) are emptied.
 */
function fragmentEdits(
  matches: ReadonlyArray<ExactMatchRef>,
  replacement: MatchReplacement,
  encode: Encode,
): Map<string, { path: ValuePath; edits: TextEdit[] }> {
  const groups = new Map<string, { path: ValuePath; edits: TextEdit[] }>();

  for (const match of matches) {
    const inserted = encode(replacementFor(replacement, match));
    for (const [index, fragment] of match.fragments.entries()) {
      const key = pathKey(fragment.path);
      const group = groups.get(key) ?? {
        path: fragment.path,
        edits: [],
      };
      group.edits.push({
        start: fragment.start,
        end: fragment.end,
        replacement: index === 0 ? inserted : '',
      });
      groups.set(key, group);
    }
  }

  return groups;
}

function applyFragmentMatches(
  fieldValue: TraversedFieldValue,
  matches: ReadonlyArray<ExactMatchRef>,
  replacement: MatchReplacement,
): unknown {
  let result = cloneValue(fieldValue.value);
  const groups = fragmentEdits(matches, replacement, encoderFor(fieldValue));

  for (const { path, edits } of groups.values()) {
    const text = valueAtPath(result, path);
    if (typeof text !== 'string') {
      throw new Error('The selected text location is no longer available.');
    }
    result = setValueAtPath(result, path, applyTextEdits(text, edits));
  }

  return result;
}

function previewFor(
  match: ExactMatchRef | undefined,
  replacement: MatchReplacement,
): Pick<FieldReplacementResult, 'preview'> {
  if (!match) return {};
  return {
    preview: {
      beforeContext: match.context.before,
      beforeTruncated: match.context.beforeTruncated,
      matchedText: match.matchedText,
      replacementText: replacementFor(replacement, match),
      afterContext: match.context.after,
      afterTruncated: match.context.afterTruncated,
    },
  };
}

export function isReplaceableFieldType(fieldType: string): boolean {
  return isExactMatchCompatibleFieldType(
    fieldType as TraversedFieldValue['field']['fieldType'],
  );
}

function isNumberFieldType(fieldType: string): boolean {
  return fieldType === 'float' || fieldType === 'integer';
}

/**
 * The value a number field gets: the number typed, or null when the new text
 * is empty. Text that isn't a number is kept as typed, so the write fails
 * with `invalidNumberValue` instead of saving something else.
 */
function numberValue(text: string): number | string | null {
  if (text.trim().length === 0) return null;
  return parseNumber(text) ?? text;
}

/** A number field value that isn't a number (or a whole number) the field takes. */
export function invalidNumberValue(
  fieldValue: TraversedFieldValue,
  value: unknown,
): boolean {
  const { fieldType } = fieldValue.field;
  if (!isNumberFieldType(fieldType) || value === null) return false;
  if (typeof value !== 'number' || !Number.isFinite(value)) return true;
  return fieldType === 'integer' && !Number.isInteger(value);
}

/** New text for a number field that the field won't take. */
export function rejectsNumberText(
  fieldType: 'float' | 'integer',
  text: string,
): boolean {
  const value = numberValue(text);
  if (value === null) return false;
  if (typeof value !== 'number') return true;
  return fieldType === 'integer' && !Number.isInteger(value);
}

export function replaceExactMatches(
  fieldValue: TraversedFieldValue,
  matches: ReadonlyArray<ExactMatchRef>,
  replacement: MatchReplacement,
): FieldReplacementResult {
  if (!isReplaceableFieldType(fieldValue.field.fieldType)) {
    return {
      supported: false,
      changed: false,
      value: fieldValue.value,
      replacementCount: 0,
    };
  }

  if (matches.length === 0) {
    return {
      supported: true,
      changed: false,
      value: fieldValue.value,
      replacementCount: 0,
    };
  }

  if (isNumberFieldType(fieldValue.field.fieldType)) {
    const [match] = matches;
    const value = numberValue(replacementFor(replacement, match));
    return {
      supported: true,
      changed: value !== fieldValue.value,
      value,
      replacementCount: 1,
      ...previewFor(match, replacement),
    };
  }

  const value = applyFragmentMatches(fieldValue, matches, replacement);
  return {
    supported: true,
    changed: stableSerialize(value) !== stableSerialize(fieldValue.value),
    value,
    replacementCount: matches.length,
    ...previewFor(matches[0], replacement),
  };
}

export function replaceMatchingText(
  fieldValue: TraversedFieldValue,
  matcher: MatcherSpec,
  replacement: MatchReplacement,
): FieldReplacementResult {
  if (!isReplaceableFieldType(fieldValue.field.fieldType)) {
    return {
      supported: false,
      changed: false,
      value: fieldValue.value,
      replacementCount: 0,
    };
  }

  return replaceExactMatches(
    fieldValue,
    matchesForTraversedField(fieldValue, matcher),
    replacement,
  );
}
