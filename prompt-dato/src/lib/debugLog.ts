/**
 * Tiny debug-logging helper for Prompt Dato.
 *
 * `dlog` only fires when the user has flipped the "Debug logging" switch in
 * the plugin's config screen. `derror` always fires (errors are useful).
 * Every payload is emitted as one compact JSON object.
 *
 * Sensitive keys (tokens, API keys, OAuth codes, etc.) are redacted by
 * `redactForLog` before stringification, so debug output is safe to share.
 */

let debugEnabled = false;

export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = Boolean(enabled);
}

export function isDebugEnabled(): boolean {
  return debugEnabled;
}

const LABEL_PREFIX = 'Prompt Dato';

/** Gated event log — only prints when debug mode is on. */
export function dlog(
  category: string,
  event: string,
  payload?: unknown,
): void {
  if (!debugEnabled) return;
  emit('log', category, event, payload);
}

/** Always-on error log. Stack traces are included only when debug mode is on. */
export function derror(
  category: string,
  event: string,
  error: unknown,
  extra?: unknown,
): void {
  const errorPayload = describeError(error, { includeStack: debugEnabled });
  const payload =
    extra === undefined
      ? errorPayload
      : { error: errorPayload, ...toPlainObject(extra) };
  emit('error', category, event, payload);
}

function emit(
  level: 'log' | 'error',
  category: string,
  event: string,
  payload: unknown,
): void {
  const label = `[${LABEL_PREFIX} | ${category} | ${event}]`;
  if (payload === undefined) {
    if (level === 'error') console.error(label);
    else console.log(label);
    return;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(redactForLog(payload));
  } catch (stringifyError) {
    serialized = `<<unserializable: ${describeError(stringifyError).message}>>`;
  }
  if (level === 'error') console.error(`${label} ${serialized}`);
  else console.log(`${label} ${serialized}`);
}

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /api[_-]?key/i,
  /access[_-]?token/i,
  /^token$/i,
  /^bearer$/i,
  /^authorization$/i,
  /^code$/i,
  /code[_-]?verifier/i,
  /client[_-]?secret/i,
  /datoaccesstoken/i,
  /openaiapikey/i,
];

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /^sk-[A-Za-z0-9_-]{6,}$/i, // OpenAI keys
  /^Bearer\s/i, // Authorization: Bearer ...
];

/**
 * Recursively walks any value and returns a JSON-safe clone with secrets
 * replaced by `<redacted, len=N>`. Long opaque-looking strings (typically
 * tokens or codes) get the same treatment based on common formats.
 *
 * Idempotent: applying twice does no harm.
 */
export function redactForLog(value: unknown): unknown {
  return walk(value, /* depth */ 0);
}

const MAX_DEPTH = 8;

function walk(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '<max depth reached>';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactStringIfSensitive(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `<function ${value.name || 'anon'}>`;
  if (typeof value === 'symbol') return value.toString();
  if (value instanceof Error) return walk(describeError(value), depth + 1);
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, raw] of entries) {
      if (isSensitiveKey(key)) {
        out[key] = redactValueByLength(raw);
      } else {
        out[key] = walk(raw, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((rx) => rx.test(key));
}

function redactValueByLength(value: unknown): string {
  if (value === null || value === undefined) return '<missing>';
  if (typeof value === 'string') return `<redacted, len=${value.length}>`;
  return `<redacted, type=${typeof value}>`;
}

function redactStringIfSensitive(value: string): string {
  let redacted = value
    .replace(/sk-[A-Za-z0-9_-]{6,}/gi, (match) =>
      redactMatchedString(match),
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, (match) =>
      redactMatchedString(match),
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|datoaccesstoken|openaiapikey|authorization|code[_-]?verifier|client[_-]?secret|code)=)([^&\s"']+)/gi,
      (_match, prefix: string, secret: string) =>
        `${prefix}<redacted, len=${secret.length}>`,
    )
    .replace(
      /("(?:api[_-]?key|access[_-]?token|datoaccesstoken|openaiapikey|authorization|code[_-]?verifier|client[_-]?secret|code)"\s*:\s*")([^"]+)(")/gi,
      (_match, prefix: string, secret: string, suffix: string) =>
        `${prefix}<redacted, len=${secret.length}>${suffix}`,
    );
  for (const rx of SENSITIVE_VALUE_PATTERNS) {
    if (rx.test(redacted)) return `<redacted, len=${redacted.length}>`;
  }
  return redacted;
}

function redactMatchedString(value: string): string {
  return `<redacted, len=${value.length}>`;
}

function describeError(
  error: unknown,
  options?: { includeStack?: boolean },
): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(options?.includeStack && error.stack ? { stack: error.stack } : {}),
    };
  }
  if (typeof error === 'string') {
    return { name: 'string', message: error };
  }
  try {
    return { name: 'unknown', message: JSON.stringify(error) };
  } catch {
    return { name: 'unknown', message: String(error) };
  }
}

function toPlainObject(extra: unknown): Record<string, unknown> {
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    return extra as Record<string, unknown>;
  }
  return { extra };
}

/** Convenience: build a short prefix/suffix from a long opaque string. */
export function shortPrefix(value: string | null | undefined, len = 6): string {
  if (!value) return '';
  return value.slice(0, len);
}
