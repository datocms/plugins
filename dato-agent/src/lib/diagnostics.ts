export const DIAGNOSTICS_SCHEMA_VERSION = 1;

type JsonSafeValue =
  | null
  | boolean
  | number
  | string
  | JsonSafeValue[]
  | { [key: string]: JsonSafeValue };

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    return String(error);
  } catch {
    return 'Unknown serialization error';
  }
}

function describeFunction(value: { readonly name?: string }): string {
  try {
    return value.name ? `[Function ${value.name}]` : '[Function]';
  } catch {
    return '[Function]';
  }
}

function describeSymbol(value: symbol): string {
  try {
    return value.description === undefined
      ? '[Symbol]'
      : `[Symbol(${value.description})]`;
  } catch {
    return '[Symbol]';
  }
}

// Same marker as the plugin's other redactors (conversations, MCP client, script outcomes).
const REDACTED = '[redacted]';

const SENSITIVE_EXACT_KEYS = new Set([
  'authorization',
  'bearer',
  'codeverifier',
  'cookie',
  'credentials',
  'idtoken',
  'jwt',
  'session',
  'sessionid',
  'token',
]);

const SENSITIVE_KEY_SUFFIXES = [
  'accesstoken',
  'apikey',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return (
    SENSITIVE_EXACT_KEYS.has(normalized) ||
    SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

/** Shorter values would mask ordinary words; real keys and tokens are far longer. */
const MIN_SECRET_LENGTH = 8;

/**
 * Builds a masker for the plugin's own secret values (provider API keys, OAuth tokens). Replacing
 * exact values catches them wherever they end up, e.g. echoed inside an error message, whatever
 * their format. Longest first, so a secret that contains another is masked whole.
 */
function knownSecretMasker(
  secrets: readonly (string | null | undefined)[],
): (text: string) => string {
  const values = [
    ...new Set(
      secrets.filter(
        (secret): secret is string =>
          typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH,
      ),
    ),
  ].sort((left, right) => right.length - left.length);
  return (text) =>
    values.reduce(
      (current, secret) => current.replaceAll(secret, REDACTED),
      text,
    );
}

function propertyPath(parentPath: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${parentPath}.${key}`
    : `${parentPath}[${JSON.stringify(key)}]`;
}

function normalizeDiagnostics(
  value: unknown,
  maskSecrets: (text: string) => string,
): JsonSafeValue {
  const seen = new WeakMap<object, string>();

  const normalizeProperty = (
    key: string,
    propertyValue: unknown,
    path: string,
  ): JsonSafeValue =>
    typeof propertyValue === 'string' &&
    propertyValue !== '' &&
    isSensitiveKey(key)
      ? REDACTED
      : normalize(propertyValue, propertyPath(path, key));

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Diagnostics must safely normalize every JavaScript value shape in one recursive traversal.
  const normalize = (current: unknown, path: string): JsonSafeValue => {
    try {
      if (current === null) {
        return null;
      }

      switch (typeof current) {
        case 'string':
          return maskSecrets(current);
        case 'boolean':
          return current;
        case 'number':
          if (Number.isNaN(current)) {
            return '[NaN]';
          }
          if (current === Number.POSITIVE_INFINITY) {
            return '[Infinity]';
          }
          if (current === Number.NEGATIVE_INFINITY) {
            return '[-Infinity]';
          }
          return current;
        case 'bigint':
          return `${current.toString()}n`;
        case 'undefined':
          return '[undefined]';
        case 'function':
          return describeFunction(current);
        case 'symbol':
          return describeSymbol(current);
      }

      const objectValue = current as object;
      const previousPath = seen.get(objectValue);
      if (previousPath) {
        return `[Circular ${previousPath}]`;
      }
      seen.set(objectValue, path);

      if (current instanceof Date) {
        const timestamp = current.getTime();
        return Number.isNaN(timestamp)
          ? '[Invalid Date]'
          : current.toISOString();
      }

      if (current instanceof RegExp) {
        return current.toString();
      }

      if (current instanceof Error) {
        // Error messages and stacks can echo request headers or keys.
        const normalizedError: Record<string, JsonSafeValue> = {
          $type: 'Error',
          name: current.name,
          message: maskSecrets(current.message),
        };

        if (current.stack !== undefined) {
          normalizedError.stack = maskSecrets(current.stack);
        }

        if ('cause' in current) {
          try {
            normalizedError.cause = normalize(
              current.cause,
              propertyPath(path, 'cause'),
            );
          } catch (error) {
            normalizedError.cause = `[Unserializable: ${errorMessage(error)}]`;
          }
        }

        for (const key of Object.keys(current).sort(compareStrings)) {
          if (
            key === 'cause' ||
            key === 'message' ||
            key === 'name' ||
            key === 'stack'
          ) {
            continue;
          }

          try {
            normalizedError[key] = normalizeProperty(
              key,
              (current as unknown as Record<string, unknown>)[key],
              path,
            );
          } catch (error) {
            normalizedError[key] = `[Unserializable: ${errorMessage(error)}]`;
          }
        }

        return normalizedError;
      }

      if (current instanceof Map) {
        return {
          $type: 'Map',
          entries: Array.from(current.entries(), ([key, entryValue], index) => [
            normalize(key, `${path}.entries[${index}][0]`),
            typeof key === 'string'
              ? normalizeProperty(key, entryValue, `${path}.entries[${index}]`)
              : normalize(entryValue, `${path}.entries[${index}][1]`),
          ]),
        };
      }

      if (current instanceof Set) {
        return {
          $type: 'Set',
          values: Array.from(current.values(), (entryValue, index) =>
            normalize(entryValue, `${path}.values[${index}]`),
          ),
        };
      }

      if (Array.isArray(current)) {
        return current.map((entryValue, index) =>
          normalize(entryValue, `${path}[${index}]`),
        );
      }

      const normalizedObject: Record<string, JsonSafeValue> = {};
      for (const key of Object.keys(current).sort(compareStrings)) {
        try {
          normalizedObject[key] = normalizeProperty(
            key,
            (current as Record<string, unknown>)[key],
            path,
          );
        } catch (error) {
          normalizedObject[key] = `[Unserializable: ${errorMessage(error)}]`;
        }
      }

      for (const symbolKey of Object.getOwnPropertySymbols(current).sort(
        (left, right) =>
          compareStrings(describeSymbol(left), describeSymbol(right)),
      )) {
        const key = describeSymbol(symbolKey);
        try {
          normalizedObject[key] = normalize(
            (current as Record<symbol, unknown>)[symbolKey],
            propertyPath(path, key),
          );
        } catch (error) {
          normalizedObject[key] = `[Unserializable: ${errorMessage(error)}]`;
        }
      }

      return normalizedObject;
    } catch (error) {
      return `[Unserializable: ${errorMessage(error)}]`;
    }
  };

  return normalize(value, '$');
}

export type DiagnosticsOptions = {
  /** The plugin's live secret values; every exact occurrence is replaced in the output. */
  secrets?: readonly (string | null | undefined)[];
};

/**
 * Serializes failure diagnostics for the clipboard. Callers pass an allowlisted payload plus the
 * secrets they hold; values under credential-like keys are also replaced as a structural backstop.
 */
export function serializeDiagnostics(
  value: unknown,
  { secrets = [] }: DiagnosticsOptions = {},
): string {
  return JSON.stringify(
    normalizeDiagnostics(value, knownSecretMasker(secrets)),
    null,
    2,
  );
}

function restoreFocus(element: Element | null): void {
  if (element && 'focus' in element && typeof element.focus === 'function') {
    try {
      element.focus();
    } catch {
      // Restoring focus is best-effort after the copy attempt.
    }
  }
}

async function copyWithClipboardApi(text: string): Promise<boolean> {
  const writeText = globalThis.navigator?.clipboard?.writeText;
  if (typeof writeText !== 'function') {
    return false;
  }

  await writeText.call(globalThis.navigator.clipboard, text);
  return true;
}

function copyWithTextarea(text: string): void {
  if (
    typeof document === 'undefined' ||
    !document.body ||
    typeof document.execCommand !== 'function'
  ) {
    throw new Error('Clipboard fallback is unavailable');
  }

  const previouslyFocused = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  Object.assign(textarea.style, {
    position: 'fixed',
    inset: '0 auto auto -9999px',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  });

  document.body.append(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    if (!document.execCommand('copy')) {
      throw new Error('Clipboard fallback was rejected');
    }
  } finally {
    textarea.remove();
    restoreFocus(previouslyFocused);
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  let clipboardApiError: unknown;

  try {
    if (await copyWithClipboardApi(text)) {
      return;
    }
  } catch (error) {
    clipboardApiError = error;
  }

  try {
    copyWithTextarea(text);
  } catch (fallbackError) {
    throw new AggregateError(
      [clipboardApiError, fallbackError].filter(
        (error): error is NonNullable<unknown> => error != null,
      ),
      'Could not copy diagnostics to the clipboard',
    );
  }
}
