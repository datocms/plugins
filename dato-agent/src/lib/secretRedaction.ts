/** Replacement marker shared by every redaction surface in the plugin. */
export const REDACTED_MARKER = '[redacted]';

const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const PROVIDER_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
// Only the key and separator are matched; quotes around the key (at any JSON
// encoding depth) need no leading match. The separator allows any whitespace
// except a line break (NBSP and ideographic spaces included).
const SECRET_KEY_PATTERN =
  /(api[_-]?key|access[_-]?token|authorization|client[_-]?secret|password|secret|token)(?:\\*["'])?[^\S\r\n]*[:=][^\S\r\n]*/gi;
const AUTHORIZATION_SCHEME_PATTERN =
  /^(?:Basic|Bearer|Digest|DPoP|Negotiate|NTLM|Token|ApiKey|AWS4-HMAC-SHA256)[^\S\r\n]+/i;
// `&` ends a bare value so URL query siblings survive.
const BARE_VALUE_PATTERN = /^[^"',\s}\]&]+/;
// A quote preceded by any backslash run: `"`, `\"`, `\\\"`, … (one per JSON
// encoding level).
const OPENING_DELIMITER_PATTERN = /\\*["']/y;

/** Where a secret value starts and ends, and what replaces it. */
interface ValueSpan {
  end: number;
  replacement: string;
}

/** Per-input state shared by every value lookup in one redaction pass. */
interface ScanContext {
  text: string;
  /** Index of the next line break at or after `from`, or the input length. */
  lineEnd: (from: number) => number;
  /** Index after the bracket that balances the one at `open`, if any. */
  bracketEnd: (open: number) => number | undefined;
  /** Delimiter → earliest content start known to have no closer after it. */
  missingCloser: Map<string, number>;
}

/**
 * Finds the closing delimiter of a quoted value at any JSON encoding depth.
 * A delimiter of `r` backslashes plus a quote closes the value only when the
 * whole backslash run before that quote has length `T` with
 * `T % (2 * (r + 1)) === r`. Depth 0 (`"`) needs an even run, depth 1 (`\"`)
 * a run of 1, 5, 9…, depth 2 (`\\\"`) a run of 3, 11…; other runs are escaped
 * quotes inside the value. Newlines are allowed (PEM keys span lines).
 *
 * @returns The index where the closing delimiter starts, or -1 when none.
 */
const findClosingDelimiter = (
  text: string,
  from: number,
  delimiter: string,
): number => {
  const quote = delimiter.charAt(delimiter.length - 1);
  const runLength = delimiter.length - 1;
  const modulus = 2 * (runLength + 1);
  for (
    let index = text.indexOf(quote, from);
    index !== -1;
    index = text.indexOf(quote, index + 1)
  ) {
    let backslashes = 0;
    while (
      index - backslashes > from &&
      text[index - backslashes - 1] === '\\'
    ) {
      backslashes += 1;
    }
    if (backslashes % modulus === runLength) {
      return index - runLength;
    }
  }
  return -1;
};

/**
 * Builds a line-end lookup that caches the last break found, so scanning many
 * values on one long line stays linear-time.
 */
const createLineEndFinder = (text: string): ScanContext['lineEnd'] => {
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
 * Updates the quote state for one character: opens on a quote, closes on the
 * matching quote, and resets at a line break.
 */
const nextQuoteState = (
  quote: string | undefined,
  character: string,
): string | undefined => {
  if (character === '\n' || character === '\r') {
    return undefined;
  }
  if (!quote) {
    return character;
  }
  return character === quote ? undefined : quote;
};

/**
 * Matches every bracket in one stack pass. Brackets inside quoted strings are
 * ignored; quote state resets at each line break, so a stray apostrophe or an
 * unterminated quote only affects its own line.
 *
 * @returns A map from each balanced opening bracket to the index after its
 *   closing bracket.
 */
const matchBrackets = (text: string): Map<number, number> => {
  const ends = new Map<number, number>();
  const openings: number[] = [];
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      index += 1;
    } else if (quote || character === '"' || character === "'") {
      quote = nextQuoteState(quote, character);
    } else if (character === '{' || character === '[') {
      openings.push(index);
    } else if (character === '}' || character === ']') {
      const open = openings.pop();
      if (open !== undefined) {
        ends.set(open, index + 1);
      }
    }
  }
  return ends;
};

/** Creates the per-input scan state; the bracket table is built on demand. */
const createScanContext = (text: string): ScanContext => {
  let brackets: Map<number, number> | undefined;
  return {
    text,
    lineEnd: createLineEndFinder(text),
    bracketEnd: (open) => {
      brackets ??= matchBrackets(text);
      return brackets.get(open);
    },
    missingCloser: new Map(),
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

/** The opening delimiter of a value: a quote after any backslash run. */
const openingDelimiter = (text: string, start: number): string | undefined => {
  OPENING_DELIMITER_PATTERN.lastIndex = start;
  return OPENING_DELIMITER_PATTERN.exec(text)?.[0];
};

/**
 * Spans a quoted value through its closing delimiter, or through the end of
 * the line when truncation cut the closer off.
 */
const quotedValueSpan = (
  context: ScanContext,
  start: number,
  delimiter: string,
  isAuthorization: boolean,
): ValueSpan => {
  const { text, missingCloser } = context;
  const contentStart = start + delimiter.length;
  const knownMissing = missingCloser.get(delimiter);
  let closer = -1;
  // An unterminated delimiter stays unterminated for every later start.
  if (knownMissing === undefined || contentStart < knownMissing) {
    closer = findClosingDelimiter(text, contentStart, delimiter);
    if (closer === -1) {
      missingCloser.set(delimiter, contentStart);
    }
  }

  const isTerminated = closer !== -1;
  const contentEnd = isTerminated ? closer : context.lineEnd(contentStart);
  const content = redactContent(
    text.slice(contentStart, contentEnd),
    isAuthorization,
  );
  return {
    end: isTerminated ? closer + delimiter.length : contentEnd,
    replacement: `${delimiter}${content}${isTerminated ? delimiter : ''}`,
  };
};

/**
 * Spans a `{…}` / `[…]` value through its balancing bracket. Unbalanced
 * input falls back to the end of the line.
 */
const bracketValueSpan = (context: ScanContext, start: number): ValueSpan => ({
  end: context.bracketEnd(start) ?? context.lineEnd(start),
  replacement: REDACTED_MARKER,
});

/**
 * Spans an unquoted value. Authorization keeps a known scheme and redacts
 * the credential; an unknown scheme redacts the rest of the line, since the
 * credential can follow a space.
 *
 * @returns `undefined` when the value is empty or already redacted.
 */
const bareValueSpan = (
  context: ScanContext,
  start: number,
  isAuthorization: boolean,
): ValueSpan | undefined => {
  const tail = context.text.slice(start, context.lineEnd(start));
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

/** Picks the span strategy for the value starting at `start`. */
const valueSpan = (
  context: ScanContext,
  start: number,
  isAuthorization: boolean,
): ValueSpan | undefined => {
  const delimiter = openingDelimiter(context.text, start);
  if (delimiter) {
    return quotedValueSpan(context, start, delimiter, isAuthorization);
  }
  const isBracketed =
    /[{[]/.test(context.text.charAt(start)) &&
    !context.text.startsWith(REDACTED_MARKER, start);
  return isBracketed
    ? bracketValueSpan(context, start)
    : bareValueSpan(context, start, isAuthorization);
};

/**
 * Redacts `key: value` / `key=value` secrets in one left-to-right pass.
 *
 * @param text - Input already stripped of credential tokens.
 * @returns The input with each secret value replaced.
 */
const redactKeyValueSecrets = (text: string): string => {
  const pattern = new RegExp(SECRET_KEY_PATTERN);
  const context = createScanContext(text);
  let output = '';
  let copiedUntil = 0;

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const valueStart = match.index + match[0].length;
    const span = valueSpan(
      context,
      valueStart,
      match[1].toLowerCase() === 'authorization',
    );
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
