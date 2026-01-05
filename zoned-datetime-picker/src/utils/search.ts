/**
 * Robust search normalization: remove accents, punctuation, lowercase.
 */

/**
 * Normalize a string for forgiving search: remove accents, collapse
 * non-alphanumerics to spaces, lowercase and trim.
 *
 * @param s - Input string
 * @returns Normalized string for search
 * @example
 * ```ts
 * normalizeForSearch('São-Paulo / GMT+03'); // 'sao paulo gmt 03'
 * ```
 */
export function normalizeForSearch(s: string): string {
  try {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  } catch {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
}

/**
 * Build a normalized haystack string from multiple parts.
 *
 * @param parts - One or more strings to merge and normalize
 * @returns Searchable haystack
 * @example
 * ```ts
 * makeSearchHaystack('Europe/Rome', 'UTC+2, Central European Summer Time');
 * ```
 */
export function makeSearchHaystack(...parts: string[]): string {
  return normalizeForSearch(parts.filter(Boolean).join(' '));
}
