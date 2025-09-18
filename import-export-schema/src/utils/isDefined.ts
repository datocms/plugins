/** Type guard that filters out null/undefined/false values in array helpers. */
export function isDefined<T>(
  value: T | null | undefined | false,
): value is NonNullable<Exclude<T, false>> {
  return value !== null && value !== undefined && value !== false;
}
