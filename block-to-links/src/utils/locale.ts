/**
 * Locale Handling Utilities
 * 
 * Utilities for working with localized field values in DatoCMS.
 * Handles wrapping, unwrapping, and ensuring complete locale coverage
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
  sanitizeFn?: (value: unknown) => unknown
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
        localizedValue[locale] = sanitizeFn ? sanitizeFn({ ...value }) : { ...value };
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
  availableLocales: string[]
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
 * Used when combining block data from different locales into one record.
 * 
 * @param localeData - Object mapping locale codes to field data
 * @param fieldKeys - Set of all field keys to include
 * @param availableLocales - List of all locales to include
 * @param fallbackLocale - Locale to use as fallback for missing data
 * @returns Merged localized field data
 */
export function mergeLocaleData(
  localeData: Record<string, Record<string, unknown>>,
  fieldKeys: Set<string>,
  availableLocales: string[],
  fallbackLocale?: string
): Record<string, LocalizedValue> {
  const result: Record<string, LocalizedValue> = {};
  
  // Determine fallback locale
  const localesWithData = Object.keys(localeData).filter(k => k !== '__default__');
  const effectiveFallback = fallbackLocale || 
    (localesWithData.includes('en') ? 'en' : localesWithData[0]);
  const fallbackData = effectiveFallback ? localeData[effectiveFallback] : null;
  
  // Check for __default__ data (non-localized context marked as localized)
  const defaultData = localeData['__default__'] || null;
  
  for (const fieldKey of fieldKeys) {
    const localizedValue: LocalizedValue = {};
    
    for (const locale of availableLocales) {
      // Try to get value from this locale's data
      let localeBlockData = localeData[locale];
      
      // If no locale-specific data, fall back to __default__ data
      if (!localeBlockData && defaultData) {
        localeBlockData = defaultData;
      }
      
      if (localeBlockData && localeBlockData[fieldKey] !== undefined) {
        localizedValue[locale] = localeBlockData[fieldKey];
      } else if (fallbackData && fallbackData[fieldKey] !== undefined) {
        // For missing locales, use the fallback locale's value
        // This prevents 422 errors when fields have required validators
        localizedValue[locale] = fallbackData[fieldKey];
      } else {
        // Last resort: set to null
        localizedValue[locale] = null;
      }
    }
    
    result[fieldKey] = localizedValue;
  }
  
  return result;
}
