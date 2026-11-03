import { isValidId } from '@datocms/cma-client-browser';

/** A value in the diagnostics that looks like a credential the plugin doesn't know about. */
export type SecretCandidate = {
  value: string;
  /** Safe to show: the last 4 characters and the length, never the value itself. */
  preview: string;
  /** Where it first appears in the payload, e.g. `turn.events[4].output`. */
  path: string;
  occurrences: number;
};

const MIN_TOKEN_LENGTH = 20;
/** Bits per character. English words and file paths sit well below; keys and tokens above. */
const MIN_ENTROPY = 3.5;
/** Characters that can belong to a token. Anything else (spaces, quotes, `/`, `.`, `:`) splits it. */
const TOKEN_CHARACTERS = new Set(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_~+'.split(
    '',
  ),
);

const HEX_DIGITS = new Set('0123456789abcdefABCDEF'.split(''));

function tokens(text: string): string[] {
  const found: string[] = [];
  let current = '';
  for (let index = 0; index < text.length; index++) {
    const character = text[index] ?? '';
    if (TOKEN_CHARACTERS.has(character)) {
      current += character;
      continue;
    }
    if (current.length >= MIN_TOKEN_LENGTH) found.push(current);
    current = '';
    // A URL escape such as %3A is a separator too, so `id%3A<uuid>` yields the UUID alone.
    if (
      character === '%' &&
      HEX_DIGITS.has(text[index + 1] ?? '') &&
      HEX_DIGITS.has(text[index + 2] ?? '')
    )
      index += 2;
  }
  if (current.length >= MIN_TOKEN_LENGTH) found.push(current);
  return found;
}

function shannonEntropy(text: string): number {
  const counts = new Map<string, number>();
  for (const character of text)
    counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / text.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isRandomLooking(token: string): boolean {
  let hasLetter = false;
  let hasDigit = false;
  for (const character of token) {
    if (character >= '0' && character <= '9') hasDigit = true;
    else if (
      (character >= 'a' && character <= 'z') ||
      (character >= 'A' && character <= 'Z')
    )
      hasLetter = true;
  }
  return hasLetter && hasDigit && shannonEntropy(token) >= MIN_ENTROPY;
}

/** Canonical 8-4-4-4-12 hex UUIDs (conversation, request and response IDs), checked by position. */
function isUuid(token: string): boolean {
  if (token.length !== 36) return false;
  for (let index = 0; index < token.length; index++) {
    const isDashPosition =
      index === 8 || index === 13 || index === 18 || index === 23;
    if (
      isDashPosition
        ? token[index] !== '-'
        : !HEX_DIGITS.has(token[index] ?? '')
    )
      return false;
  }
  return true;
}

/** `id`, `siteId`, `itemIds`, `item_ids`, `ID`…: record and entity identifiers, not secrets. */
function isIdentifierKey(key: string | undefined): boolean {
  if (key === undefined) return false;
  if (['id', 'ids', 'ID', 'IDs'].includes(key)) return true;
  return ['Id', 'Ids', 'ID', 'IDs', '_id', '_ids'].some((suffix) =>
    key.endsWith(suffix),
  );
}

function collectCandidates(
  text: string,
  path: string,
  candidates: Map<string, SecretCandidate>,
): void {
  for (const token of tokens(text)) {
    if (isValidId(token) || isUuid(token) || !isRandomLooking(token)) continue;
    const existing = candidates.get(token);
    if (existing) {
      existing.occurrences += 1;
      continue;
    }
    candidates.set(token, {
      value: token,
      preview: `…${token.slice(-4)} · ${token.length} chars`,
      path,
      occurrences: 1,
    });
  }
}

function visitValue(
  value: unknown,
  path: string,
  key: string | undefined,
  candidates: Map<string, SecretCandidate>,
): void {
  if (typeof value === 'string') {
    if (!isIdentifierKey(key)) collectCandidates(value, path, candidates);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries())
      visitValue(entry, `${path}[${index}]`, key, candidates);
    return;
  }
  if (value && typeof value === 'object')
    for (const [childKey, child] of Object.entries(value))
      visitValue(
        child,
        path ? `${path}.${childKey}` : childKey,
        childKey,
        candidates,
      );
}

/**
 * Finds values in serialized diagnostics that look like secrets the plugin doesn't hold, such as
 * a key a user pasted into chat, so the user can choose to redact them before copying. Detection is
 * deliberately generic (long, mixed, high-entropy tokens) because the user reviews every hit.
 * DatoCMS IDs (`isValidId`), UUIDs and values under identifier keys are skipped.
 */
export function findSecretCandidates(serialized: string): SecretCandidate[] {
  const candidates = new Map<string, SecretCandidate>();
  visitValue(JSON.parse(serialized), '', undefined, candidates);
  return [...candidates.values()];
}

/** Replaces every occurrence of the chosen values with the diagnostics' redaction marker. */
export function redactValues(
  serialized: string,
  values: readonly string[],
): string {
  return [...values]
    .sort((left, right) => right.length - left.length)
    .reduce(
      (current, value) => current.replaceAll(value, '[redacted]'),
      serialized,
    );
}
