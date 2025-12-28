import type { Mention, MentionMapKey } from '@ctypes/mentions';

/**
 * Regex pattern to match block indices in encoded field paths.
 * Matches double colon followed by digits, followed by another double colon or end of string.
 * Examples: "::0::" in "blocks::0::heading", "::12" at end of "sections::12"
 */
export const BLOCK_INDEX_PATTERN = /::(\d+)(?=::|$)/g;

/**
 * Common locale codes used in DatoCMS projects.
 * Used for heuristic detection when parsing field mentions with locale suffixes.
 */
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

/**
 * Regex pattern to detect locale codes.
 * Matches: "en", "pt", "zh-CN", "pt-BR" (2-letter codes, optionally with region)
 */
export const LOCALE_CODE_PATTERN = /^[a-z]{2}(-[a-z]{2})?$/i;

/**
 * ================================================================================
 * FIELD PATH ENCODING/DECODING
 * ================================================================================
 *
 * Field paths use two different formats:
 *
 * 1. INTERNAL FORMAT (dots): "blocks.0.heading", "sections.12.content"
 *    - Used in code, formValues navigation, and internal data structures
 *    - Dots separate path segments
 *
 * 2. SERIALIZED FORMAT (double colons): "blocks::0::heading", "sections::12::content"
 *    - Used in comment text representation and storage
 *    - Double colons (::) prevent conflicts with field API keys that might contain dots
 *
 * These functions provide the SINGLE SOURCE OF TRUTH for encoding/decoding.
 * DO NOT implement encoding/decoding logic elsewhere - import these functions.
 *
 * ================================================================================
 */

/**
 * Encodes a field path from internal dot notation to serialized double-colon format.
 *
 * Example transformations:
 * - "blocks.0.heading" → "blocks::0::heading"
 * - "sections.12.content" → "sections::12::content"
 * - "hero_title" → "hero_title" (unchanged - no dots)
 *
 * @param fieldPath - The internal field path with dots
 * @returns The encoded field path with double colons for serialization
 */
export function encodeFieldPath(fieldPath: string) {
  return fieldPath.replace(/\./g, '::');
}

/**
 * Decodes an encoded field path back to its original internal format.
 * Field paths are encoded with double colons (::) for storage, but nested paths
 * use dots in the original format.
 *
 * Example transformations:
 * - "blocks::0::heading" → "blocks.0.heading"
 * - "sections::12::content" → "sections.12.content"
 * - "hero_title" → "hero_title" (unchanged - no block index)
 *
 * @param encodedPath - The double-colon-encoded field path
 * @returns The decoded field path with dots for nested paths
 */
export function decodeFieldPath(encodedPath: string) {
  // Replace block index patterns: "::0::" or "::0" (at end) becomes ".0." or ".0"
  return encodedPath.replace(BLOCK_INDEX_PATTERN, '.$1');
}

/**
 * ================================================================================
 * CRITICAL ARCHITECTURAL LIMITATION - DO NOT ATTEMPT TO "FIX" THIS
 * ================================================================================
 *
 * This function uses HEURISTIC detection to identify locale codes. It CANNOT
 * be made perfect without breaking changes to the serialization format.
 *
 * THE PROBLEM:
 * ------------
 * When a field mention is serialized, the path might look like:
 *   - "title::en" (field "title" with locale "en")
 *   - "en::it" (field "en" inside block, with locale "it")
 *   - "sections::0::en" (field "en" at index 0 in "sections" block)
 *
 * Without external context, we CANNOT distinguish between:
 *   - A field named "en" (which is a valid field API key)
 *   - A locale suffix "en" (English locale)
 *
 * WHY THIS CANNOT BE FIXED:
 * -------------------------
 * 1. The serialization format uses "::" as a delimiter for BOTH nested paths
 *    AND locale suffixes. There is no structural difference between them.
 *
 * 2. Changing the delimiter format would break ALL existing serialized comments
 *    in the database. Migration would require access to every project's locale
 *    configuration at migration time, which is not feasible.
 *
 * 3. The mention lookup happens in contexts where we may not have access to
 *    the project's actual locale list (e.g., during rendering of cached comments).
 *
 * WHAT MITIGATES THIS:
 * --------------------
 * 1. Fields named with 2-letter codes matching common locales ("en", "it", "de")
 *    are extremely rare in practice.
 *
 * 2. The `findFieldMention` function tries multiple lookup strategies in sequence,
 *    so even if this heuristic fails, other strategies may succeed.
 *
 * 3. When `projectLocales` is provided (when available), precise matching is used.
 *
 * WORKAROUNDS FOR EDGE CASES:
 * ---------------------------
 * If a project has a field named "en" and uses English locale:
 *   - The field mention may fail to resolve correctly
 *   - The workaround is to rename the field to something more descriptive
 *     (e.g., "en_language" or "english_content")
 *
 * FUTURE CONSIDERATION:
 * ---------------------
 * If we ever redesign the serialization format, we should use a distinct
 * separator for locales (e.g., "@en" instead of "::en"). However, this would
 * require a careful migration strategy for existing data.
 *
 * ================================================================================
 *
 * @param value - The string to check
 * @param projectLocales - Optional array of actual project locales for precise validation
 * @returns True if the string matches locale patterns or is a known/project locale
 */
export function looksLikeLocaleCode(value: string, projectLocales?: string[]) {
  // If project locales are provided, use precise matching
  if (projectLocales && projectLocales.length > 0) {
    return projectLocales.includes(value) || projectLocales.includes(value.toLowerCase());
  }

  // Fallback to heuristic detection (may have false positives for fields named "en", "it", etc.)
  const matchesLocalePattern = LOCALE_CODE_PATTERN.test(value);
  const isKnownLocale = COMMON_LOCALES.includes(value.toLowerCase());
  return matchesLocalePattern || isKnownLocale;
}

/**
 * Finds a field mention in the mentions map, trying various key combinations.
 * Handles both current encoded format and legacy dot-notation format.
 *
 * Search strategies (in order):
 * 1. Exact match with encoded path
 * 2. Decoded path (for backwards compatibility with dot notation)
 * 3. Path with locale suffix extracted and tried separately
 *
 * @param encodedPath - The encoded field path (e.g., "blocks::0::heading::en")
 * @param mentionsMap - The map of mention keys to mention objects
 * @returns The found mention, or undefined if not found
 */
export function findFieldMention(
  encodedPath: string,
  mentionsMap: Map<MentionMapKey, Mention>
): Mention | undefined {
  // Strategy 1: Exact match with encoded path (primary - keys are now encoded)
  const exactKey: MentionMapKey = `field:${encodedPath}`;
  const exactMatch = mentionsMap.get(exactKey);
  if (exactMatch) return exactMatch;

  // Strategy 2: Try decoded path (backwards compatibility with old dot notation)
  const decodedPath = decodeFieldPath(encodedPath);
  const decodedKey: MentionMapKey = `field:${decodedPath}`;
  const decodedMatch = mentionsMap.get(decodedKey);
  if (decodedMatch) return decodedMatch;

  // Strategy 3: Try extracting locale suffix
  // Locale suffixes appear after the last "::" (e.g., "title::en", "blocks::0::heading::pt")
  const lastDelimiterIndex = encodedPath.lastIndexOf('::');
  const hasDelimiterSuffix = lastDelimiterIndex > 0;

  if (!hasDelimiterSuffix) {
    return undefined;
  }

  const possibleLocale = encodedPath.slice(lastDelimiterIndex + 2);
  const isLikelyLocale = looksLikeLocaleCode(possibleLocale);

  if (!isLikelyLocale) {
    return undefined;
  }

  const pathWithoutLocale = encodedPath.slice(0, lastDelimiterIndex);

  // Try with encoded path + locale suffix (current format)
  const encodedWithLocaleKey: MentionMapKey = `field:${pathWithoutLocale}::${possibleLocale}`;
  const encodedWithLocaleMatch = mentionsMap.get(encodedWithLocaleKey);
  if (encodedWithLocaleMatch) return encodedWithLocaleMatch;

  // Try with decoded path + locale suffix (backwards compatibility)
  const decodedPathWithoutLocale = decodeFieldPath(pathWithoutLocale);
  const decodedWithLocaleKey: MentionMapKey = `field:${decodedPathWithoutLocale}.${possibleLocale}`;
  const decodedWithLocaleMatch = mentionsMap.get(decodedWithLocaleKey);
  if (decodedWithLocaleMatch) return decodedWithLocaleMatch;

  return undefined;
}
