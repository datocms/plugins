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

function propertyPath(parentPath: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${parentPath}.${key}`
    : `${parentPath}[${JSON.stringify(key)}]`;
}

function normalizeDiagnostics(value: unknown): JsonSafeValue {
  const seen = new WeakMap<object, string>();

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Diagnostics must safely normalize every JavaScript value shape in one recursive traversal.
  const normalize = (current: unknown, path: string): JsonSafeValue => {
    try {
      if (current === null) {
        return null;
      }

      switch (typeof current) {
        case 'string':
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
        const normalizedError: Record<string, JsonSafeValue> = {
          $type: 'Error',
          name: current.name,
          message: current.message,
        };

        if (current.stack !== undefined) {
          normalizedError.stack = current.stack;
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
            normalizedError[key] = normalize(
              (current as unknown as Record<string, unknown>)[key],
              propertyPath(path, key),
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
            normalize(entryValue, `${path}.entries[${index}][1]`),
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
          normalizedObject[key] = normalize(
            (current as Record<string, unknown>)[key],
            propertyPath(path, key),
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

export function serializeDiagnostics(value: unknown): string {
  return JSON.stringify(normalizeDiagnostics(value), null, 2);
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
