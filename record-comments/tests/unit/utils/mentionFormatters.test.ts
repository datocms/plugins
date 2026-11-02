import { formatFieldType } from '@utils/mentionFormatters';
import { describe, expect, it } from 'vitest';

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
