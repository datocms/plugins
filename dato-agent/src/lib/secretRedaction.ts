/** Replacement marker shared by every redaction surface in the plugin. */
export const REDACTED_MARKER = '[redacted]';

const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const PROVIDER_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
// The key may sit inside quotes, including JSON-escaped quotes (`\"api_key\"`)
// from double-encoded payloads. The separator allows any whitespace except a
// line break (NBSP and ideographic spaces included).
const SECRET_KEY_PATTERN =
  /(?:\\?["'])?(api[_-]?key|access[_-]?token|authorization|client[_-]?secret|password|secret|token)(?:\\?["'])?[^\S\r\n]*[:=][^\S\r\n]*/gi;
const AUTHORIZATION_SCHEME_PATTERN =
  /^(?:Basic|Bearer|Digest|DPoP|Negotiate|NTLM|Token|ApiKey|AWS4-HMAC-SHA256)[^\S\r\n]+/i;
// `&` ends a bare value so URL query siblings survive.
const BARE_VALUE_PATTERN = /^[^"',\s}\]&]+/;

const BRACKET_MEMO_KEY = '{[';

/** Where a secret value starts and ends, and what replaces it. */
interface ValueSpan {
  end: number;
  replacement: string;
}

/**
 * Finds the closing JSON-escaped quote (`\"`) of a double-encoded value.
 * Decoding once turns each raw `\\` pair into one backslash, so a candidate
 * closes the value only when the raw backslash run before it has a length
 * divisible by four. A run of two (`\\\"`) is an escaped quote inside it.
 *
 * @returns The index of the closing delimiter, or -1 when the input has none.
 */
const findClosingEscapedQuote = (
  text: string,
  from: number,
  delimiter: string,
): number => {
  for (
    let index = text.indexOf(delimiter, from);
    index !== -1;
    index = text.indexOf(delimiter, index + 1)
  ) {
    let precedingBackslashes = 0;
    while (
      index - precedingBackslashes - 1 >= from &&
      text[index - precedingBackslashes - 1] === '\\'
    ) {
      precedingBackslashes += 1;
    }
    if (precedingBackslashes % 4 === 0) {
      return index;
    }
  }
  return -1;
};

/**
 * Finds the closing quote of a quoted value, honouring backslash escapes and
 * allowing newlines (PEM keys in YAML/JS strings span lines).
 *
 * @returns The index of the closing quote, or -1 when the input has none.
 */
const findClosingQuote = (
  text: string,
  from: number,
  quote: string,
): number => {
  for (let index = from; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      index += 1;
    } else if (character === quote) {
      return index;
    }
  }
  return -1;
};

/** Returns the index of the next line break at or after `from`, or the input length. */
type LineEndFinder = (from: number) => number;

/**
 * Builds a line-end lookup that caches the last break found, so scanning many
 * values on one long line stays linear-time.
 *
 * @param text - Whole input.
 */
const createLineEndFinder = (text: string): LineEndFinder => {
  let cachedFrom = -1;
  let cachedEnd = -1;
  return (from) => {
    if (from < cachedFrom || from > cachedEnd) {
      const pattern = /[\r\n]/g;
      pattern.lastIndex = from;
      cachedEnd = pattern.exec(text)?.index ?? text.length;
    }
    cachedFrom = from;
    return cachedEnd;
  };
};

/**
 * Redacts the inside of a quoted or line-delimited value. Authorization
 * values keep a known scheme name, e.g. `Digest [redacted]`.
 */
const redactContent = (content: string, isAuthorization: boolean): string => {
  const scheme = isAuthorization
    ? AUTHORIZATION_SCHEME_PATTERN.exec(content)?.[0]
    : undefined;
  return `${scheme ?? ''}${REDACTED_MARKER}`;
};

/** The opening quote of a value: `"`, `'`, or a JSON-escaped `\"` / `\'`. */
const openingDelimiter = (text: string, start: number): string | undefined => {
  const head = text.slice(start, start + 2);
  if (head === '\\"' || head === "\\'") {
    return head;
  }
  return head.startsWith('"') || head.startsWith("'") ? head[0] : undefined;
};

/**
 * Spans a quoted value through its closing delimiter, or through the end of
 * the line when truncation cut the closer off.
 *
 * @param missingCloser - Per-call memo of delimiters with no closer left, so
 *   repeated unterminated quotes stay linear-time.
 */
const quotedValueSpan = (
  text: string,
  start: number,
  delimiter: string,
  isAuthorization: boolean,
  missingCloser: Map<string, number>,
  lineEnd: LineEndFinder,
): ValueSpan => {
  const contentStart = start + delimiter.length;
  const knownMissing = missingCloser.get(delimiter);
  let closer = -1;
  if (knownMissing === undefined || contentStart < knownMissing) {
    closer =
      delimiter.length === 2
        ? findClosingEscapedQuote(text, contentStart, delimiter)
        : findClosingQuote(text, contentStart, delimiter);
    if (closer === -1) {
      missingCloser.set(delimiter, contentStart);
    }
  }

  const isTerminated = closer !== -1;
  const contentEnd = isTerminated ? closer : lineEnd(contentStart);
  const content = redactContent(
    text.slice(contentStart, contentEnd),
    isAuthorization,
  );
  return {
    end: isTerminated ? closer + delimiter.length : contentEnd,
    replacement: `${delimiter}${content}${isTerminated ? delimiter : ''}`,
  };
};

const BRACKET_DEPTH: Readonly<Record<string, number>> = {
  '{': 1,
  '[': 1,
  '}': -1,
  ']': -1,
};

/**
 * Finds the end of the bracket group opening at `start`, skipping quoted
 * strings and escaped characters.
 *
 * @returns The index after the balancing bracket, or -1 when unbalanced.
 */
const findBalancedBracketEnd = (text: string, start: number): number => {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' || character === "'") {
      index = findClosingQuote(text, index + 1, character);
      if (index === -1) {
        return -1;
      }
    } else if (character === '\\') {
      index += 1;
    } else {
      depth += BRACKET_DEPTH[character] ?? 0;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
};

/**
 * Spans a `{…}` / `[…]` value through its balanced closing bracket, skipping
 * brackets inside quoted strings. Unbalanced input falls back to the end of
 * the line.
 *
 * @param missingCloser - Shared memo; once a scan from some index finds no
 *   balance, later starts skip straight to the fallback (keeps linear time).
 */
const bracketValueSpan = (
  text: string,
  start: number,
  missingCloser: Map<string, number>,
  lineEnd: LineEndFinder,
): ValueSpan => {
  const knownMissing = missingCloser.get(BRACKET_MEMO_KEY);
  if (knownMissing === undefined || start < knownMissing) {
    const end = findBalancedBracketEnd(text, start);
    if (end !== -1) {
      return { end, replacement: REDACTED_MARKER };
    }
    missingCloser.set(BRACKET_MEMO_KEY, start);
  }
  return { end: lineEnd(start), replacement: REDACTED_MARKER };
};

/**
 * Spans an unquoted value. Authorization keeps a known scheme and redacts
 * the credential; an unknown scheme redacts the rest of the line, since the
 * credential can follow a space.
 *
 * @returns `undefined` when the value is empty or already redacted.
 */
const bareValueSpan = (
  text: string,
  start: number,
  isAuthorization: boolean,
  lineEnd: LineEndFinder,
): ValueSpan | undefined => {
  const tail = text.slice(start, lineEnd(start));
  const scheme = isAuthorization
    ? (AUTHORIZATION_SCHEME_PATTERN.exec(tail)?.[0] ?? '')
    : '';
  const credential = tail.slice(scheme.length);
  if (!credential || credential.startsWith(REDACTED_MARKER)) {
    return undefined;
  }

  const length =
    isAuthorization && !scheme
      ? credential.length
      : BARE_VALUE_PATTERN.exec(credential)?.[0].length;
  return length
    ? {
        end: start + scheme.length + length,
        replacement: `${scheme}${REDACTED_MARKER}`,
      }
    : undefined;
};

/**
 * Redacts `key: value` / `key=value` secrets in one left-to-right pass.
 *
 * @param text - Input already stripped of credential tokens.
 * @returns The input with each secret value replaced.
 */
const redactKeyValueSecrets = (text: string): string => {
  const pattern = new RegExp(SECRET_KEY_PATTERN);
  const missingCloser = new Map<string, number>();
  const lineEnd = createLineEndFinder(text);
  let output = '';
  let copiedUntil = 0;

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const valueStart = match.index + match[0].length;
    const isAuthorization = match[1].toLowerCase() === 'authorization';
    const delimiter = openingDelimiter(text, valueStart);
    const isBracketed =
      /[{[]/.test(text.charAt(valueStart)) &&
      !text.startsWith(REDACTED_MARKER, valueStart);
    const span = delimiter
      ? quotedValueSpan(
          text,
          valueStart,
          delimiter,
          isAuthorization,
          missingCloser,
          lineEnd,
        )
      : isBracketed
        ? bracketValueSpan(text, valueStart, missingCloser, lineEnd)
        : bareValueSpan(text, valueStart, isAuthorization, lineEnd);
    if (span) {
      output += text.slice(copiedUntil, valueStart) + span.replacement;
      copiedUntil = span.end;
      pattern.lastIndex = span.end;
    }
  }

  return output + text.slice(copiedUntil);
};

/**
 * Redacts self-identifying credentials (`Bearer …` tokens and `sk-…` provider
 * keys) without touching surrounding structure. Safe for model-bound tool
 * output, where ordinary `token: value` content must survive.
 *
 * @param value - Text that can contain credentials.
 * @returns The text with credential tokens replaced by {@link REDACTED_MARKER}.
 */
export const redactCredentialTokens = (value: string): string =>
  value
    .replace(BEARER_PATTERN, `$1${REDACTED_MARKER}`)
    .replace(PROVIDER_KEY_PATTERN, REDACTED_MARKER);

/**
 * Redacts credential tokens plus `key=value` / `key: value` secrets, such as
 * `?access_token=…` in URLs or `"api_key": "…"` in serialized JSON. Use for
 * text that leaves the runtime: persisted conversations and diagnostics.
 *
 * @param value - Text that can contain credentials.
 * @returns The text with every recognized secret replaced by {@link REDACTED_MARKER}.
 */
export const redactSecrets = (value: string): string =>
  redactKeyValueSecrets(redactCredentialTokens(value));
