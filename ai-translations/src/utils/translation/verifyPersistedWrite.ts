/** A `(field, locale)` pair the run claims it translated and wrote. */
export type WriteClaim = { field: string; locale: string };

/** A claim the CMA response does not corroborate. */
export type Mismatch = {
  field: string;
  locale: string;
  reason: 'absent' | 'null' | 'empty';
};

/**
 * Decides whether a persisted value counts as content.
 *
 * `0` and `false` are legitimate values. An array of bare block IDs is what the
 * CMA returns for block fields when they are not nested, and is a successful
 * write — not an empty one.
 *
 * @param value - The persisted value read back from the CMA response.
 * @returns True when the value is an empty string, array, or object.
 */
const isEmptyValue = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as object).length === 0;
  }
  return false;
};

/**
 * Asserts that every write the run claimed to make is corroborated by the CMA
 * update response.
 *
 * This is belt-and-braces behind the `FieldOutcome` type, which is what makes
 * writing a null for a failed field unrepresentable. It exists to catch the
 * CMA silently dropping a value, and any future reintroduction of the bug.
 *
 * @param response - The record returned by `client.items.update`.
 * @param claims - Every `(field, locale)` marked `translated`.
 * @returns One `Mismatch` per uncorroborated claim; empty when all persisted.
 */
export const verifyPersistedWrite = (
  response: Record<string, unknown>,
  claims: WriteClaim[],
): Mismatch[] =>
  claims.flatMap(({ field, locale }): Mismatch[] => {
    const fieldValue = response[field];
    if (fieldValue === null || typeof fieldValue !== 'object') {
      return [{ field, locale, reason: 'absent' as const }];
    }
    const localized = fieldValue as Record<string, unknown>;
    if (!(locale in localized)) return [{ field, locale, reason: 'absent' as const }];

    const value = localized[locale];
    if (value === null || value === undefined) return [{ field, locale, reason: 'null' as const }];
    if (isEmptyValue(value)) return [{ field, locale, reason: 'empty' as const }];
    return [];
  });
