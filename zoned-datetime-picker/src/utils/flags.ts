/**
 * Country flag utilities.
 */

/**
 * Convert an ISO 3166-1 alpha-2 country code (e.g., `IT`) into a Unicode flag.
 * Returns an empty string if input is invalid.
 *
 * How it works
 * - Unicode defines 26 "Regional Indicator Symbols" from U+1F1E6 (A) to U+1F1FF (Z).
 * - A country flag is represented by a pair of these symbols: the first and
 *   second letters of the uppercased country code mapped to their respective
 *   regional indicator symbols.
 * - Example: `US` -> `U` (85) and `S` (83). ASCII 'A' is 65, so their code points are:
 *   U+1F1E6 + (85 - 65) = U+1F1FA and U+1F1E6 + (83 - 65) = U+1F1F8. Rendering
 *   them together yields the 🇺🇸 grapheme on most platforms.
 * - Some platforms that lack a composed flag glyph will display the two regional
 *   letters side-by-side instead of a single flag emoji.
 *
 * @param countryCode - Two-letter country code
 * @returns Unicode flag emoji or empty string
 * @example
 * ```ts
 * toFlagEmoji('US'); // '🇺🇸'
 * ```
 */
export function toFlagEmoji(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return "";
  const cc = countryCode.toUpperCase();
  // Base code point for Unicode Regional Indicator Symbols: 'A' = U+1F1E6.
  // This is the magic offset that anchors the A–Z block.
  const REGIONAL_INDICATOR_A = 0x1f1e6;
  // ASCII code for uppercase 'A' to compute 0-based offset within A–Z.
  const ASCII_UPPERCASE_A = 65;
  const regionalIndicatorFor = (ch: string) =>
    REGIONAL_INDICATOR_A + (ch.charCodeAt(0) - ASCII_UPPERCASE_A);
  return String.fromCodePoint(
    regionalIndicatorFor(cc[0]),
    regionalIndicatorFor(cc[1])
  );
}
