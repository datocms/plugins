import type { Mention, MentionMapKey } from '@ctypes/mentions';

export const BLOCK_INDEX_PATTERN = /::(\d+)(?=::|$)/g;

export const COMMON_LOCALES = [
  'en',
  'it',
  'de',
  'fr',
  'es',
  'pt',
  'nl',
  'ja',
  'zh',
  'ko',
  'ru',
  'ar',
  'pl',
  'tr',
  'sv',
  'da',
  'no',
  'fi',
];

export const LOCALE_CODE_PATTERN = /^[a-z]{2}(-[a-z]{2})?$/i;

/**
 * Internal format uses dots (blocks.0.heading), serialized uses :: to avoid
 * conflicts with API keys containing dots. Single source of truth.
 */
export function encodeFieldPath(fieldPath: string) {
  return fieldPath.replace(/\./g, '::');
}

export function decodeFieldPath(encodedPath: string) {
  return encodedPath.replace(BLOCK_INDEX_PATTERN, '.$1');
}

/**
 * Cannot distinguish field named "en" vs locale suffix "en" (both use ::).
 * Mitigated by: rarity of 2-letter field names, multiple lookup strategies,
 * precise matching when projectLocales provided.
 */
export function looksLikeLocaleCode(value: string, projectLocales?: string[]) {
  if (projectLocales && projectLocales.length > 0) {
    return projectLocales.includes(value) || projectLocales.includes(value.toLowerCase());
  }

  const matchesLocalePattern = LOCALE_CODE_PATTERN.test(value);
  const isKnownLocale = COMMON_LOCALES.includes(value.toLowerCase());
  return matchesLocalePattern || isKnownLocale;
}

/** Tries exact encoded path, decoded dot notation (legacy), then locale-suffix extraction. */
export function findFieldMention(
  encodedPath: string,
  mentionsMap: Map<MentionMapKey, Mention>
): Mention | undefined {
  const exactKey: MentionMapKey = `field:${encodedPath}`;
  const exactMatch = mentionsMap.get(exactKey);
  if (exactMatch) return exactMatch;

  const decodedPath = decodeFieldPath(encodedPath);
  const decodedKey: MentionMapKey = `field:${decodedPath}`;
  const decodedMatch = mentionsMap.get(decodedKey);
  if (decodedMatch) return decodedMatch;

  const lastDelimiterIndex = encodedPath.lastIndexOf('::');
  if (lastDelimiterIndex <= 0) return undefined;

  const possibleLocale = encodedPath.slice(lastDelimiterIndex + 2);
  if (!looksLikeLocaleCode(possibleLocale)) return undefined;

  const pathWithoutLocale = encodedPath.slice(0, lastDelimiterIndex);

  const encodedWithLocaleKey: MentionMapKey = `field:${pathWithoutLocale}::${possibleLocale}`;
  const encodedWithLocaleMatch = mentionsMap.get(encodedWithLocaleKey);
  if (encodedWithLocaleMatch) return encodedWithLocaleMatch;

  const decodedPathWithoutLocale = decodeFieldPath(pathWithoutLocale);
  const decodedWithLocaleKey: MentionMapKey = `field:${decodedPathWithoutLocale}.${possibleLocale}`;
  const decodedWithLocaleMatch = mentionsMap.get(decodedWithLocaleKey);
  if (decodedWithLocaleMatch) return decodedWithLocaleMatch;

  return undefined;
}
