/**
 * Locale Handling Utilities
 *
 * Utilities for working with localized field values in DatoCMS.
 * Handles wrapping, unwrapping, and preserving source locale coverage
 * for field values during migration operations.
 *
 * @module utils/locale
 */

// =============================================================================
// Types
// =============================================================================

/** A localized field value - object with locale codes as keys */
export type LocalizedValue<T = unknown> = Record<string, T>;

// =============================================================================
// Locale Value Wrapping
// =============================================================================

/**
 * Wraps non-localized field values in a localized hash.
 * Duplicates the value across all specified locales.
 *
 * This is used when a model was created with localized fields but the
 * source data is non-localized (e.g., converting a block from a
 * non-localized context to a model with localized fields).
 *
 * @param data - The non-localized field data to wrap
 * @param availableLocales - List of all locales to include
 * @param sanitizeFn - Optional function to sanitize values before wrapping
 * @returns Object with field keys mapping to localized value hashes
 *
 * @example
 * const wrapped = wrapFieldsInLocalizedHash(
 *   { title: 'Hello', count: 5 },
 *   ['en', 'es', 'fr']
 * );
 * // Result: { title: { en: 'Hello', es: 'Hello', fr: 'Hello' }, count: { en: 5, es: 5, fr: 5 } }
 */
export function wrapFieldsInLocalizedHash(
  data: Record<string, unknown>,
  availableLocales: string[],
  sanitizeFn?: (value: unknown) => unknown,
): Record<string, LocalizedValue> {
  const result: Record<string, LocalizedValue> = {};

  for (const [fieldKey, value] of Object.entries(data)) {
    // Create a localized hash with the same value for all locales
    const localizedValue: LocalizedValue = {};

    for (const locale of availableLocales) {
      // Deep clone arrays and objects to avoid reference issues
      if (Array.isArray(value)) {
        localizedValue[locale] = value.map((item) => {
          if (item && typeof item === 'object') {
            return sanitizeFn ? sanitizeFn({ ...item }) : { ...item };
          }
          return item;
        });
      } else if (value && typeof value === 'object') {
        localizedValue[locale] = sanitizeFn
          ? sanitizeFn({ ...value })
          : { ...value };
      } else {
        localizedValue[locale] = value;
      }
    }

    result[fieldKey] = localizedValue;
  }

  return result;
}

// =============================================================================
// Locale Completeness
// =============================================================================

/**
 * Ensures all locales are present in an update object for a localized field.
 * Uses original values for locales that weren't updated.
 *
 * @param newValue - The new localized value (may have missing locales)
 * @param originalValue - The original localized value to fall back to
 * @param availableLocales - List of all locales that should be present
 * @returns Complete localized value suitable for API update
 */
export function completeLocalizedUpdate<T>(
  newValue: LocalizedValue<T>,
  originalValue: LocalizedValue<T> | undefined,
  availableLocales: string[],
): LocalizedValue<T | null> {
  const result: LocalizedValue<T | null> = {};

  for (const locale of availableLocales) {
    if (locale in newValue) {
      result[locale] = newValue[locale];
    } else if (originalValue && locale in originalValue) {
      result[locale] = originalValue[locale];
    } else {
      result[locale] = null;
    }
  }

  return result;
}

// =============================================================================
// Locale Data Merging
// =============================================================================

/**
 * Merges locale data from multiple sources into a single localized value.
 * Only locales represented by source blocks are materialized. If the source
 * block was non-localized, its value is assigned to the project's main locale.
 *
 * @param localeData - Object mapping locale codes to field data
 * @param fieldKeys - Set of all field keys to include
 * @param availableLocales - Project locales, with the main locale first
 * @returns Merged localized field data
 */
function sourceLocalesForGroup(
  localeData: Record<string, Record<string, unknown>>,
  availableLocales: string[],
): string[] {
  const sourceLocaleSet = new Set(
    Object.keys(localeData).filter((locale) => locale !== '__default__'),
  );

  if (sourceLocaleSet.size === 0 && localeData.__default__) {
    return availableLocales.length > 0 ? [availableLocales[0]] : [];
  }

  const orderedLocales = availableLocales.filter((locale) =>
    sourceLocaleSet.delete(locale),
  );

  // Preserve unexpected-but-present locale keys instead of dropping content.
  for (const locale of sourceLocaleSet) {
    orderedLocales.push(locale);
  }

  return orderedLocales;
}

export function mergeLocaleData(
  localeData: Record<string, Record<string, unknown>>,
  fieldKeys: Set<string>,
  availableLocales: string[],
): Record<string, LocalizedValue> {
  const result: Record<string, LocalizedValue> = {};
  const defaultData = localeData.__default__ ?? null;
  const sourceLocales = sourceLocalesForGroup(localeData, availableLocales);
  const usesNonLocalizedSource =
    defaultData !== null &&
    Object.keys(localeData).every((locale) => locale === '__default__');

  for (const fieldKey of fieldKeys) {
    const localizedValue: LocalizedValue = {};

    for (const locale of sourceLocales) {
      const sourceData = usesNonLocalizedSource
        ? defaultData
        : (localeData[locale] ?? null);
      localizedValue[locale] =
        sourceData && sourceData[fieldKey] !== undefined
          ? sourceData[fieldKey]
          : null;
    }

    result[fieldKey] = localizedValue;
  }

  return result;
}
