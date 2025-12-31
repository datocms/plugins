import { describe, it, expect } from 'vitest';
import { getTruncatedFilename, formatFieldType } from '@utils/mentionFormatters';

describe('getTruncatedFilename', () => {
  // UI.MENTION_CHIP_MAX_NAME_LENGTH is 8

  describe('filenames within limit', () => {
    it('returns short filename unchanged', () => {
      const result = getTruncatedFilename('abc.jpg');

      expect(result).toBe('abc.jpg');
    });

    it('returns exactly max length filename unchanged', () => {
      const result = getTruncatedFilename('abcdefgh.jpg');

      expect(result).toBe('abcdefgh.jpg');
    });

    it('returns short filename without extension unchanged', () => {
      const result = getTruncatedFilename('short');

      expect(result).toBe('short');
    });
  });

  describe('filenames exceeding limit', () => {
    it('truncates long filename and adds ellipsis', () => {
      const result = getTruncatedFilename('verylongfilename.jpg');

      expect(result).toBe('verylong….jpg');
    });

    it('preserves extension after truncation', () => {
      const result = getTruncatedFilename('superlongfilename.png');

      expect(result).toBe('superlon….png');
    });

    it('truncates filename without extension', () => {
      const result = getTruncatedFilename('verylongfilenamewithoutextension');

      expect(result).toBe('verylong…');
    });
  });

  describe('extensions', () => {
    it('handles long extensions', () => {
      const result = getTruncatedFilename('filename.jpeg');

      expect(result).toBe('filename.jpeg');
    });

    it('handles multiple dots in filename', () => {
      const result = getTruncatedFilename('my.file.name.jpg');

      // nameWithoutExtension is 'my.file.name' (12 chars), truncated to 8 chars = 'my.file.'
      expect(result).toBe('my.file.….jpg');
    });

    it('handles dotfile without extension', () => {
      const result = getTruncatedFilename('.gitignore');

      // lastIndexOf('.') is 0, so nameWithoutExtension is '' (empty)
      // 0 <= 8, so returns unchanged
      expect(result).toBe('.gitignore');
    });
  });

  describe('edge cases', () => {
    it('handles empty filename', () => {
      const result = getTruncatedFilename('');

      expect(result).toBe('');
    });

    it('handles filename with only extension', () => {
      const result = getTruncatedFilename('.jpg');

      // Dot at position 0 means no extension
      expect(result).toBe('.jpg');
    });

    it('handles very short extension', () => {
      const result = getTruncatedFilename('toolongname.a');

      expect(result).toBe('toolongn….a');
    });
  });
});

describe('formatFieldType', () => {
  describe('basic formatting', () => {
    it('converts snake_case to sentence case', () => {
      const result = formatFieldType('single_line');

      expect(result).toBe('Single line');
    });

    it('capitalizes first letter', () => {
      const result = formatFieldType('string');

      expect(result).toBe('String');
    });

    it('handles multiple underscores', () => {
      const result = formatFieldType('structured_text_blocks');

      expect(result).toBe('Structured text blocks');
    });
  });

  describe('common field types', () => {
    it('formats modular_content', () => {
      expect(formatFieldType('modular_content')).toBe('Modular content');
    });

    it('formats structured_text', () => {
      expect(formatFieldType('structured_text')).toBe('Structured text');
    });

    it('formats single_block', () => {
      expect(formatFieldType('single_block')).toBe('Single block');
    });

    it('formats rich_text', () => {
      expect(formatFieldType('rich_text')).toBe('Rich text');
    });

    it('formats single_line', () => {
      expect(formatFieldType('single_line')).toBe('Single line');
    });

    it('formats multi_line', () => {
      expect(formatFieldType('multi_line')).toBe('Multi line');
    });
  });

  describe('null/undefined handling', () => {
    it('returns null for undefined', () => {
      const result = formatFieldType(undefined);

      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = formatFieldType('');

      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles already capitalized types', () => {
      const result = formatFieldType('String');

      expect(result).toBe('String');
    });

    it('handles single character', () => {
      const result = formatFieldType('a');

      expect(result).toBe('A');
    });

    it('handles type without underscores', () => {
      const result = formatFieldType('boolean');

      expect(result).toBe('Boolean');
    });
  });
});
