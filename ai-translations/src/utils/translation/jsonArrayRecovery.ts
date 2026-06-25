/**
 * Last-resort recovery of a JSON array from lightly-malformed chat-model output.
 *
 * Chat vendors (OpenAI/Gemini/Anthropic) are prompted to return a JSON array but
 * occasionally emit a JS/Python-style **single-quoted** array, a **trailing
 * comma**, or wrap the array in markdown fences / prose. Strict `JSON.parse`
 * rejects the first two, which previously failed the whole field translation
 * until the user retried and the model happened to emit clean JSON — the
 * reported "record with single quotes only translated after 3-4 tries" bug.
 *
 * `recoverJsonArray` is the final fallback (after a strict parse and a
 * bracket-extraction parse have both failed). It is intentionally conservative:
 * it only returns an array it can fully parse, and `null` otherwise, so a
 * genuinely broken response still surfaces as an error rather than silently
 * yielding garbage.
 */

/** Parses `s` and returns it only when it is an array; otherwise `null`. */
function tryParseArray(s: string): unknown[] | null {
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Returns the index just past the string opened at `open` (escapes respected). */
function skipString(text: string, open: number, quote: string): number {
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++; // skip the escaped char
      continue;
    }
    if (ch === quote) return i + 1;
  }
  return text.length; // unterminated
}

/**
 * Finds the index of the `]` that closes the `[` at `start`, tracking nesting
 * depth and skipping bracket characters that live inside string literals
 * (single OR double quoted). Returns -1 when unbalanced.
 */
function matchingBracket(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipString(text, i, ch);
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return i;
    i++;
  }
  return -1;
}

/**
 * Yields each balanced `[…]` region in `text`, left to right. Quote-aware, so a
 * prose bracket (`[Europe]`) and a bracket inside a string value (`'Paris
 * [CDG]'`) are handled correctly: the former becomes its own (non-array)
 * candidate that simply fails to parse, the latter never splits the real array.
 */
function arrayRegions(text: string): string[] {
  const regions: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '[') {
      const end = matchingBracket(text, i);
      if (end !== -1) {
        regions.push(text.slice(i, end + 1));
        i = end + 1;
        continue;
      }
    }
    i++;
  }
  return regions;
}

/** Copies a double-quoted string verbatim (escapes respected). */
function copyDoubleString(
  src: string,
  start: number,
): { text: string; next: number } | null {
  let out = '"';
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      out += ch + (src[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (ch === '"') return { text: `${out}"`, next: i + 1 };
    out += ch;
    i++;
  }
  return null; // unterminated
}

/** JSON emission for a `\X` escape inside a single-quoted string. */
function emitSingleQuotedEscape(next: string | undefined): string {
  if (next === "'") return "'"; // \' is just an apostrophe in JSON
  if (next === undefined) return '\\\\';
  return `\\${next}`; // keep \n, \\, \uXXXX, \" …
}

/** JSON-escapes a plain char for a double-quoted string, or `null` if verbatim. */
function emitSingleQuotedChar(ch: string): string | null {
  if (ch === '"') return '\\"'; // a literal double quote must be escaped
  if (ch === '\n') return '\\n';
  if (ch === '\r') return '\\r';
  if (ch === '\t') return '\\t';
  return null;
}

/** Re-escapes a single-quoted string into a valid double-quoted JSON string. */
function convertSingleString(
  src: string,
  start: number,
): { text: string; next: number } | null {
  let out = '"';
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const next = src[i + 1];
      out += emitSingleQuotedEscape(next);
      i += next === undefined ? 1 : 2;
      continue;
    }
    if (ch === "'") return { text: `${out}"`, next: i + 1 };
    out += emitSingleQuotedChar(ch) ?? ch;
    i++;
  }
  return null; // unterminated
}

/** Drops a single trailing comma (and whitespace) from the tail of `out`. */
function stripTrailingComma(out: string): string {
  let end = out.length;
  while (end > 0 && /\s/.test(out[end - 1])) end--;
  if (end > 0 && out[end - 1] === ',') return out.slice(0, end - 1);
  return out;
}

/**
 * Quote-aware normalizer: rewrites single-quoted strings to double-quoted JSON
 * strings and elides trailing commas, never touching string *contents* (so a
 * `,]`, `[`, or `]` inside a value is safe). Returns `null` on an unterminated
 * string.
 */
function normalizeRelaxedJson(src: string): string | null {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      const res = copyDoubleString(src, i);
      if (res === null) return null;
      out += res.text;
      i = res.next;
      continue;
    }
    if (ch === "'") {
      const res = convertSingleString(src, i);
      if (res === null) return null;
      out += res.text;
      i = res.next;
      continue;
    }
    if (ch === ']' || ch === '}') {
      out = stripTrailingComma(out) + ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Attempts to recover a JSON array from lightly-malformed model output.
 *
 * @param text - Raw (or trimmed) provider response text.
 * @returns The parsed array, or `null` when none can be recovered.
 */
export function recoverJsonArray(text: string): unknown[] | null {
  if (typeof text !== 'string') return null;

  // Try each balanced `[…]` candidate; the first that yields an array wins, so a
  // leading prose bracket (`[Europe]`) is skipped in favour of the real array.
  for (const region of arrayRegions(text)) {
    // Fenced/prose-wrapped but otherwise valid JSON parses immediately.
    const direct = tryParseArray(region);
    if (direct) return direct;

    // Single quotes / trailing commas: normalize, then parse.
    const normalized = normalizeRelaxedJson(region);
    if (normalized === null) continue;
    const parsed = tryParseArray(normalized);
    if (parsed) return parsed;
  }
  return null;
}
