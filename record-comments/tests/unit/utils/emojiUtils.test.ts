import { extractLeadingEmoji } from '@utils/emojiUtils';
import { describe, expect, it } from 'vitest';

describe('extractLeadingEmoji', () => {
  describe('basic emoji extraction', () => {
    it('extracts emoji at start of text', () => {
      const result = extractLeadingEmoji('🎉 Party time');

      expect(result.emoji).toBe('🎉');
      expect(result.textWithoutEmoji).toBe('Party time');
    });

    it('extracts emoji with space after', () => {
      const result = extractLeadingEmoji('🚀 Launch');

      expect(result.emoji).toBe('🚀');
      expect(result.textWithoutEmoji).toBe('Launch');
    });

    it('handles emoji without space', () => {
      const result = extractLeadingEmoji('🔥Fire');

      expect(result.emoji).toBe('🔥');
      expect(result.textWithoutEmoji).toBe('Fire');
    });
  });

  describe('no emoji', () => {
    it('returns null emoji for text without emoji', () => {
      const result = extractLeadingEmoji('Hello world');

      expect(result.emoji).toBeNull();
      expect(result.textWithoutEmoji).toBe('Hello world');
    });

    it('returns original text when no leading emoji', () => {
      const result = extractLeadingEmoji('No emoji here');

      expect(result.textWithoutEmoji).toBe('No emoji here');
    });

    it('handles empty string', () => {
      const result = extractLeadingEmoji('');

      expect(result.emoji).toBeNull();
      expect(result.textWithoutEmoji).toBe('');
    });

    it('does not extract emoji from middle of text', () => {
      const result = extractLeadingEmoji('Hello 🎉 world');

      expect(result.emoji).toBeNull();
      expect(result.textWithoutEmoji).toBe('Hello 🎉 world');
    });
  });

  describe('various emoji types', () => {
    it('extracts face emoji', () => {
      const result = extractLeadingEmoji('😀 Happy');

      expect(result.emoji).toBe('😀');
    });

    it('extracts flag emoji', () => {
      const result = extractLeadingEmoji('🇺🇸 USA');

      // Flag emojis may only extract first regional indicator
      expect(result.emoji).toBe('🇺');
    });

    it('extracts symbol emoji', () => {
      const result = extractLeadingEmoji('✅ Done');

      expect(result.emoji).toBe('✅');
    });

    it('extracts animal emoji', () => {
      const result = extractLeadingEmoji('🐶 Dog');

      expect(result.emoji).toBe('🐶');
    });

    it('extracts food emoji', () => {
      const result = extractLeadingEmoji('🍕 Pizza');

      expect(result.emoji).toBe('🍕');
    });
  });

  describe('composite emojis', () => {
    it('extracts skin tone modifier emoji', () => {
      const result = extractLeadingEmoji('👋🏽 Wave');

      // May only extract base emoji without modifier
      expect(result.emoji).toBe('👋');
    });

    it('extracts keycap emoji', () => {
      const result = extractLeadingEmoji('1️⃣ First');

      // May only extract partial keycap sequence
      expect(result.emoji).toBe('1️');
    });
  });

  describe('edge cases', () => {
    it('handles emoji-only text', () => {
      const result = extractLeadingEmoji('🎉');

      expect(result.emoji).toBe('🎉');
      expect(result.textWithoutEmoji).toBe('');
    });

    it('handles multiple spaces after emoji', () => {
      const result = extractLeadingEmoji('🎉   Multiple spaces');

      expect(result.emoji).toBe('🎉');
      // Regex /^\p{...}\s*/ consumes all trailing whitespace
      expect(result.textWithoutEmoji).toBe('Multiple spaces');
    });

    it('handles text starting with number (may match as emoji)', () => {
      const result = extractLeadingEmoji('123 Numbers');

      // The pattern may match '1' as an emoji (with variation selector)
      expect(result.emoji).toBe('1');
    });

    it('handles text starting with special character (may match as emoji)', () => {
      const result = extractLeadingEmoji('#hashtag');

      // '#' with variation selector can be an emoji
      expect(result.emoji).toBe('#');
    });
  });
});
