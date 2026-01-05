/**
 * Converts a locale string into a human-readable language name.
 *
 * This function uses the `Intl.DisplayNames` API to get the human-readable name
 * of the given locale. If no readable name is available, it returns the locale string itself.
 *
 * @param locale - The locale string to convert (e.g., "en", "fr", or "es-MX").
 * @returns The human-readable language name if available, otherwise the input locale string.
 *
 * @example
 * ```typescript
 * const readableLocale = humanReadableLocale("en");
 * console.log(readableLocale); // "English" (if supported by `Intl.DisplayNames`)
 *
 * const fallbackLocale = humanReadableLocale("xx");
 * console.log(fallbackLocale); // "xx" (fallback to input locale)
 * ```
 */
export const humanReadableLocale = (locale: string): string => {
  return (
    new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? locale
  );
};
