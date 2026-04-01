const isDevelopment = import.meta.env.MODE === 'development';
let debugLoggingEnabled = false;

const SENSITIVE_KEYS = new Set([
  'token',
  'apiToken',
  'cdaToken',
  'currentUserAccessToken',
  'authorization',
  'content',
  'newContent',
  'commentLog',
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

function sanitizeValue(
  value: unknown,
  key?: string,
  seen = new WeakSet<object>(),
): unknown {
  if (key && isSensitiveKey(key)) {
    return '[redacted]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, undefined, seen));
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[circular]';
    }

    seen.add(value);

    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryValue, entryKey, seen),
      ]),
    );
  }

  return value;
}

function normalizeError(error: Error): Record<string, unknown> {
  const normalizedError: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if (error.stack) {
    normalizedError.stack = error.stack;
  }

  if ('cause' in error && error.cause !== undefined) {
    normalizedError.cause = error.cause;
  }

  for (const [key, value] of Object.entries(error)) {
    if (!(key in normalizedError)) {
      normalizedError[key] = value;
    }
  }

  return normalizedError;
}

function stringifyLogValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue =
    value instanceof Error
      ? sanitizeValue(normalizeError(value))
      : sanitizeValue(value);

  if (typeof normalizedValue === 'string') {
    return normalizedValue;
  }

  if (
    normalizedValue === null ||
    typeof normalizedValue === 'number' ||
    typeof normalizedValue === 'boolean'
  ) {
    return String(normalizedValue);
  }

  try {
    return JSON.stringify(normalizedValue, null, 2);
  } catch {
    return String(normalizedValue);
  }
}

function buildLogMessage(
  level: 'error' | 'warn' | 'debug',
  message: string,
  details: Record<string, unknown>,
): string {
  const lines = [`[RecordComments][${level}] ${message}`];

  for (const [label, value] of Object.entries(details)) {
    const serializedValue = stringifyLogValue(value);

    if (serializedValue !== undefined) {
      lines.push(`${label}: ${serializedValue}`);
    }
  }

  return lines.join('\n');
}

function isVerboseLoggingEnabled(): boolean {
  return isDevelopment || debugLoggingEnabled;
}

export function setDebugLoggingEnabled(enabled: boolean) {
  debugLoggingEnabled = enabled;
}

export function logError(
  message: string,
  error?: unknown,
  context?: Record<string, unknown>,
) {
  console.error(buildLogMessage('error', message, { error, context }));
}

/** Logs warnings when verbose logging is enabled. */
export function logWarn(message: string, context?: Record<string, unknown>) {
  if (isVerboseLoggingEnabled()) {
    console.warn(buildLogMessage('warn', message, { context }));
  }
}

/** Logs detailed diagnostics when verbose logging is enabled. */
export function logDebug(message: string, context?: Record<string, unknown>) {
  if (isVerboseLoggingEnabled()) {
    console.info(buildLogMessage('debug', message, { context }));
  }
}
