/**
 * Maps DatoCMS locale tags to DeepL language codes.
 */

/**
 * Ordered list of [prefix, DeepL code] mappings.
 * Entries are checked in order; the first prefix match wins.
 */
const DEEPL_PREFIX_MAP: Array<[string, string]> = [
  ['zh', 'ZH'],
  ['pt-br', 'PT-BR'],
  ['pt-pt', 'PT-PT'],
  ['pt', 'PT-PT'],
  ['en-us', 'EN-US'],
  ['en-gb', 'EN-GB'],
  ['en', 'EN'],
  ['es', 'ES'],
  ['fr', 'FR'],
  ['it', 'IT'],
  ['de', 'DE'],
  ['nl', 'NL'],
  ['pl', 'PL'],
  ['ja', 'JA'],
  ['ru', 'RU'],
];

/**
 * Converts a DatoCMS locale tag (e.g. "pt-BR", "en-US") to a DeepL language
 * code, normalizing common variants and falling back to the base language.
 *
 * @param locale - DatoCMS locale tag.
 * @param _mode - Unused direction flag kept for future parity.
 * @returns DeepL language code (e.g. "PT-BR", "EN").
 */
export function mapDatoToDeepL(
  locale: string,
  _mode: 'source' | 'target',
): string {
  if (!locale) return 'EN';
  const lc = locale.toLowerCase();

  for (const [prefix, code] of DEEPL_PREFIX_MAP) {
    if (lc.startsWith(prefix) || lc === prefix) return code;
  }

  // Fallback: uppercase first two letters of base language
  const baseLang = lc.split('-')[0].toUpperCase();
  return baseLang.length === 2 ? baseLang : 'EN';
}
