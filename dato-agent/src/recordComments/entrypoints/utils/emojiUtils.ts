const LEADING_EMOJI_PATTERN = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u;

export type LeadingEmojiResult = {
  emoji: string | null;
  textWithoutEmoji: string;
};

export function extractLeadingEmoji(text: string): LeadingEmojiResult {
  const emojiMatch = text.match(LEADING_EMOJI_PATTERN);
  if (!emojiMatch) {
    return { emoji: null, textWithoutEmoji: text };
  }
  const emoji = emojiMatch[0].trim();
  const textWithoutEmoji = text.slice(emojiMatch[0].length);
  return { emoji, textWithoutEmoji };
}
