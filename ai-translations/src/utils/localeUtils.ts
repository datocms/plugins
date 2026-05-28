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
 * Canonical plain-text locale label used by every user-facing string in the
 * plugin (dropdown labels, alerts, toasts, progress messages, modal header,
 * sidebar select options).
 *
 * Format: `"<Friendly Name> [<locale-code>]"`, e.g. `"English [en]"`,
 * `"Spanish (Spain) [es-ES]"`, `"Portuguese (Brazil) [pt-BR]"`.
 *
 * Backed by `formatLocaleLabel` (Intl.DisplayNames) so the friendly part
 * matches what the bulk page's locale chips show next to their code badges.
 *
 * @param localeCode - BCP 47 locale tag.
 * @returns Formatted string with name and code.
 */
export function formatLocaleWithCode(localeCode: string): string {
  const name = formatLocaleLabel(localeCode);
  return `${name} [${localeCode}]`;
}

/**
 * Resolves a BCP 47 locale tag to a friendly English label using only the
 * `Intl.DisplayNames` API. Plain string, no markup — render the locale code
 * separately if you want it styled.
 *
 * - `"en"` → `"English"`
 * - `"es-ES"` → `"Spanish (Spain)"`
 * - `"pt-BR"` → `"Portuguese (Brazil)"`
 *
 * Falls back to the input on environments without `Intl.DisplayNames` or
 * for malformed tags, so it's safe to call on arbitrary user data.
 *
 * @param localeCode - BCP 47 locale tag.
 * @returns A friendly English label for the locale.
 */
export function formatLocaleLabel(localeCode: string): string {
  try {
    const [lang, region] = localeCode.split('-');
    if (!lang) return localeCode;

    const languageName = new Intl.DisplayNames(['en'], {
      type: 'language',
    }).of(lang);
    if (!languageName) return localeCode;

    if (region) {
      const regionName = new Intl.DisplayNames(['en'], { type: 'region' }).of(
        region.toUpperCase(),
      );
      if (regionName) return `${languageName} (${regionName})`;
    }

    return languageName;
  } catch {
    return localeCode;
  }
}
