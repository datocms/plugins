import ISO6391 from 'iso-639-1';
import * as countryList from 'country-list';

/**
 * Get a human-readable label for a locale code.
 * Handles language codes (e.g., 'en') and language-country codes (e.g., 'en-US')
 * 
 * @param locale - The locale code to get a label for
 * @returns A formatted, human-readable label for the locale
 * 
 * @example
 * getLocaleLabel('en') // returns 'English'
 * getLocaleLabel('en-US') // returns 'English (United States)'
 * getLocaleLabel('pt-BR') // returns 'Portuguese (Brazil)'
 */
export function getLocaleLabel(locale: string): string {
  if (!locale) return '';

  // Parse the locale code (handle both 'en' and 'en-US' formats)
  const parts = locale.split(/[-_]/);
  const languageCode = parts[0];
  const countryCode = parts[1];

  // Get the language name
  const languageName = ISO6391.getName(languageCode) || languageCode.toUpperCase();

  // If there's a country code, append the country name
  if (countryCode) {
    const countryName = countryList.getName(countryCode.toUpperCase()) || countryCode.toUpperCase();
    return `${languageName} (${countryName})`;
  }

  // If there's only a language code, check if it's uppercase (like 'DE' instead of 'de')
  // This handles cases where a country code is used as a language code
  if (languageCode.length === 2 && languageCode === languageCode.toUpperCase()) {
    const countryName = countryList.getName(languageCode);
    if (countryName) {
      return countryName;
    }
  }

  return languageName;
}