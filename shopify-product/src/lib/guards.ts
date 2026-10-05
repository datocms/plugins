export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every(
      // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is unavailable with the ES2020 target.
      (key) => Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

export function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
