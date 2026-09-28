import { stableSerialize } from '../selection/identity';
import { matchesForTraversedField } from '../selection/matcher';
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

const REPLACEABLE_FIELD_TYPES = new Set([
  'string',
  'text',
  'slug',
  'structured_text',
  'seo',
]);

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

/**
 * Groups the edits by text location. The first fragment of a match receives
 * its whole replacement (keeping that span's marks); later fragments of a
 * match spanning several Structured Text spans are emptied.
 */
function fragmentEdits(
  matches: ReadonlyArray<ExactMatchRef>,
  replacement: MatchReplacement,
): Map<string, { path: ValuePath; edits: TextEdit[] }> {
  const groups = new Map<string, { path: ValuePath; edits: TextEdit[] }>();

  for (const match of matches) {
    const inserted = replacementFor(replacement, match);
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
  value: unknown,
  matches: ReadonlyArray<ExactMatchRef>,
  replacement: MatchReplacement,
): unknown {
  let result = cloneValue(value);

  for (const { path, edits } of fragmentEdits(matches, replacement).values()) {
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
  return REPLACEABLE_FIELD_TYPES.has(fieldType);
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

  const value = applyFragmentMatches(fieldValue.value, matches, replacement);
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
