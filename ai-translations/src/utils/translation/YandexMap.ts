/**
 * Locale normalization and resolution helpers for Yandex Translate.
 *
 * Yandex exposes its current language set at runtime, so resolution is based on
 * the codes returned by `/translate/v2/languages` rather than a copied static
 * list. This keeps regional and non-ISO additions working as the API evolves.
 */

/** Legacy and platform-specific locale aliases understood by Yandex. */
const YANDEX_LOCALE_ALIASES: Readonly<Record<string, string>> = {
  fil: 'tl',
  'fil-ph': 'tl',
  in: 'id',
  'in-id': 'id',
  iw: 'he',
  'iw-il': 'he',
  ji: 'yi',
  'kk-latn': 'kazlat',
  'kk-latn-kz': 'kazlat',
  nb: 'no',
  'nb-no': 'no',
  nn: 'no',
  'nn-no': 'no',
  'sr-latn-rs': 'sr-latn',
  'uz-cyrl': 'uzbcyr',
  'uz-cyrl-uz': 'uzbcyr',
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  'zh-hans-cn': 'zh',
  'zh-hans-sg': 'zh',
  'zh-hant': 'zh',
  'zh-hant-hk': 'zh',
  'zh-hant-tw': 'zh',
  'zh-hk': 'zh',
  'zh-sg': 'zh',
  'zh-tw': 'zh',
};

/**
 * Produces the comparison form used for DatoCMS and Yandex locale codes.
 * Underscores are accepted because DatoCMS projects can contain either BCP 47
 * separators or underscore-separated locale identifiers.
 */
export function normalizeYandexLocale(locale: string): string {
  return locale.trim().replaceAll('_', '-').toLowerCase();
}

/**
 * Resolves a DatoCMS locale to one of the language codes returned by Yandex.
 *
 * Resolution order is deliberately conservative:
 * 1. exact match after case and separator normalization;
 * 2. a known legacy/Yandex alias;
 * 3. the base language (for example, `fr-CA` -> `fr`).
 *
 * The canonical casing returned by Yandex is preserved in the result.
 */
export function resolveYandexLocale(
  locale: string,
  supportedLanguageCodes: Iterable<string>,
): string | undefined {
  const supported = new Map<string, string>();
  for (const code of supportedLanguageCodes) {
    const normalized = normalizeYandexLocale(code);
    if (normalized) supported.set(normalized, code);
  }

  const normalizedLocale = normalizeYandexLocale(locale);
  if (!normalizedLocale) return undefined;

  const exact = supported.get(normalizedLocale);
  if (exact) return exact;

  const alias = YANDEX_LOCALE_ALIASES[normalizedLocale];
  if (alias) {
    const aliasMatch = supported.get(alias);
    if (aliasMatch) return aliasMatch;
  }

  const base = normalizedLocale.split('-')[0];
  const baseAlias = YANDEX_LOCALE_ALIASES[base] ?? base;
  return supported.get(baseAlias);
}
