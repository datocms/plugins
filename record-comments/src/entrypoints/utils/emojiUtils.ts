/**
 * Regex pattern to match emoji at the start of a string.
 * Matches both emoji presentation characters and emoji with variation selectors.
 * Examples: "Home", "Notes", "Featured"
 */
const LEADING_EMOJI_PATTERN = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u;

/**
 * Result of extracting a leading emoji from text.
 */
export type LeadingEmojiResult = {
  /** The extracted emoji, or null if no leading emoji was found */
  emoji: string | null;
  /** The remaining text after removing the leading emoji and whitespace */
  textWithoutEmoji: string;
};

/**
 * Extracts a leading emoji from a string if present.
 * Useful for separating emoji prefixes from model/record names.
 *
 * @param text - The text to extract emoji from
 * @returns Object with emoji (or null) and the remaining text without the emoji
 *
 * @example
 * extractLeadingEmoji("Blog Post") // { emoji: "icon", textWithoutEmoji: "Blog Post" }
 * extractLeadingEmoji("No emoji here") // { emoji: null, textWithoutEmoji: "No emoji here" }
 */
export function extractLeadingEmoji(text: string): LeadingEmojiResult {
  const emojiMatch = text.match(LEADING_EMOJI_PATTERN);
  if (!emojiMatch) {
    return { emoji: null, textWithoutEmoji: text };
  }
  const emoji = emojiMatch[0].trim();
  const textWithoutEmoji = text.slice(emojiMatch[0].length);
  return { emoji, textWithoutEmoji };
}
