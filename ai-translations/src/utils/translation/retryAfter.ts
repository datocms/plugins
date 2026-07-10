/**
 * Parses an HTTP `Retry-After` value into milliseconds to wait.
 *
 * The header is either delta-seconds (`"120"`) or an HTTP-date. Past dates
 * clamp to `0`. Anything unparseable yields `undefined`, which callers must
 * treat as "no hint" and fall back to exponential backoff — cross-origin
 * responses frequently hide this header entirely.
 *
 * @param raw - The raw header value, if any.
 * @param nowMs - Current epoch milliseconds, injected for testability.
 * @returns Milliseconds to wait, or `undefined` when no usable hint exists.
 */
export const parseRetryAfter = (
  raw: string | null | undefined,
  nowMs: number,
): number | undefined => {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  // A bare (optionally signed) integer is delta-seconds. Handle the sign here
  // rather than letting a negative fall through to `Date.parse`, which accepts
  // strings like "-5" as a year in some engines.
  if (/^[+-]?\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds >= 0 ? seconds * 1000 : undefined;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  return Math.max(0, parsed - nowMs);
};

/** Reads `retry-after` from a `Headers`, a plain record, or anything else. */
const readHeader = (headers: unknown): string | undefined => {
  if (headers instanceof Headers) return headers.get('retry-after') ?? undefined;
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === 'retry-after' && typeof value === 'string') return value;
    }
  }
  return undefined;
};

/**
 * Extracts a `Retry-After` wait from a provider response's headers, tolerating
 * every shape our four adapters produce (`Headers`, SDK plain records, absent).
 *
 * @param headers - Whatever the adapter has on hand.
 * @param nowMs - Current epoch milliseconds.
 * @returns Milliseconds to wait, or `undefined`.
 */
export const retryAfterFromHeaders = (
  headers: unknown,
  nowMs: number,
): number | undefined => parseRetryAfter(readHeader(headers), nowMs);
