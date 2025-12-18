/**
 * localeUtils.ts
 * Shared utilities for locale name formatting and display.
 */

import locale from 'locale-codes';

/**
 * Shorthand reference to locale-codes getByTag function.
 * Returns locale metadata by its BCP 47 tag.
 */
export const localeSelect = locale.getByTag;

/**
 * Returns a human-friendly display name for a locale code.
 * Attempts to use locale-codes library first, then falls back to Intl.DisplayNames.
 *
 * @param localeCode - BCP 47 locale tag (e.g., "en", "pt-BR", "zh-Hans").
 * @returns A display-friendly locale name.
 */
export function getLocaleName(localeCode: string): string {
  try {
    // First try locale-codes library
    const tag = locale.getByTag(localeCode);
    if (tag?.name) return tag.name;

    // Fall back to Intl.DisplayNames
    const [lang, region] = localeCode.split('-');
    const mapper = new Intl.DisplayNames(['en'], { type: 'language' });
    const languageName = mapper.of(lang);

    if (region) {
      return `${languageName} (${region})`;
    }

    return languageName || localeCode;
  } catch {
    return localeCode;
  }
}

/**
 * Formats a locale code for display, including both the language name
 * and the locale code in brackets. E.g., "English [en]" or "Portuguese [pt-BR]".
 *
 * @param localeCode - BCP 47 locale tag.
 * @returns Formatted string with name and code.
 */
export function formatLocaleWithCode(localeCode: string): string {
  const name = getLocaleName(localeCode);
  return `${name} [${localeCode}]`;
}

