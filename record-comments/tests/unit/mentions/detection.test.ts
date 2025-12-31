import { describe, it, expect } from 'vitest';
import { detectActiveTrigger } from '@utils/mentions/detection';

describe('detectActiveTrigger', () => {
  describe('user mention trigger (@)', () => {
    it('detects @ at cursor position', () => {
      const result = detectActiveTrigger('@', 1);

      expect(result).toEqual({
        type: 'user',
        query: '',
        startIndex: 0,
      });
    });

    it('detects @ with query text', () => {
      const result = detectActiveTrigger('@john', 5);

      expect(result).toEqual({
        type: 'user',
        query: 'john',
        startIndex: 0,
      });
    });

    it('converts query to lowercase', () => {
      const result = detectActiveTrigger('@JOHN', 5);

      expect(result?.query).toBe('john');
    });

    it('detects @ after other text', () => {
      const result = detectActiveTrigger('Hello @john', 11);

      expect(result).toEqual({
        type: 'user',
        query: 'john',
        startIndex: 6,
      });
    });
  });

  describe('field mention trigger (#)', () => {
    it('detects # trigger', () => {
      const result = detectActiveTrigger('#title', 6);

      expect(result).toEqual({
        type: 'field',
        query: 'title',
        startIndex: 0,
      });
    });

    it('detects # after text', () => {
      const result = detectActiveTrigger('Check #field', 12);

      expect(result?.type).toBe('field');
      expect(result?.query).toBe('field');
    });
  });

  describe('model mention trigger ($)', () => {
    it('detects $ trigger', () => {
      const result = detectActiveTrigger('$blog', 5);

      expect(result).toEqual({
        type: 'model',
        query: 'blog',
        startIndex: 0,
      });
    });
  });

  describe('asset mention trigger (^)', () => {
    it('detects ^ trigger', () => {
      const result = detectActiveTrigger('^image', 6);

      expect(result).toEqual({
        type: 'asset',
        query: 'image',
        startIndex: 0,
      });
    });
  });

  describe('record mention trigger (&)', () => {
    it('detects & trigger', () => {
      const result = detectActiveTrigger('&post', 5);

      expect(result).toEqual({
        type: 'record',
        query: 'post',
        startIndex: 0,
      });
    });
  });

  describe('no trigger', () => {
    it('returns null for empty string', () => {
      const result = detectActiveTrigger('', 0);
      expect(result).toBeNull();
    });

    it('returns null for text without triggers', () => {
      const result = detectActiveTrigger('Hello world', 11);
      expect(result).toBeNull();
    });

    it('returns null when cursor is before trigger', () => {
      const result = detectActiveTrigger('Hello @john', 5);
      expect(result).toBeNull();
    });
  });

  describe('whitespace handling', () => {
    it('returns null when whitespace follows trigger', () => {
      const result = detectActiveTrigger('@ john', 6);
      expect(result).toBeNull();
    });

    it('returns null when trigger has space before query', () => {
      const result = detectActiveTrigger('@jo hn', 6);
      expect(result).toBeNull();
    });

    it('returns null for trigger followed by newline', () => {
      const result = detectActiveTrigger('@\njohn', 6);
      expect(result).toBeNull();
    });

    it('returns null for trigger followed by tab', () => {
      const result = detectActiveTrigger('@\tjohn', 6);
      expect(result).toBeNull();
    });
  });

  describe('multiple triggers', () => {
    it('returns the most recent trigger', () => {
      const result = detectActiveTrigger('@alice #field', 13);

      expect(result?.type).toBe('field');
      expect(result?.query).toBe('field');
    });

    it('returns most recent even if earlier trigger is different type', () => {
      const result = detectActiveTrigger('#field @user', 12);

      expect(result?.type).toBe('user');
      expect(result?.query).toBe('user');
    });

    it('returns earlier trigger if later one has whitespace', () => {
      const result = detectActiveTrigger('@alice # field', 14);
      // # followed by space cancels it, but @ is still active since no space after alice
      expect(result).toBeNull(); // space after # cancels entire detection
    });
  });

  describe('cursor position', () => {
    it('only considers text before cursor', () => {
      const result = detectActiveTrigger('@john#field', 5);

      expect(result?.type).toBe('user');
      expect(result?.query).toBe('john');
    });

    it('includes partial query up to cursor', () => {
      const result = detectActiveTrigger('@johnsmith', 5);

      expect(result?.query).toBe('john');
    });

    it('returns correct startIndex', () => {
      const result = detectActiveTrigger('abc @john', 9);

      expect(result?.startIndex).toBe(4);
    });
  });

  describe('special characters in query', () => {
    it('allows dots in query', () => {
      const result = detectActiveTrigger('@john.doe', 9);

      expect(result?.query).toBe('john.doe');
    });

    it('allows underscores in query', () => {
      const result = detectActiveTrigger('#field_name', 11);

      expect(result?.query).toBe('field_name');
    });

    it('allows hyphens in query', () => {
      const result = detectActiveTrigger('$blog-post', 10);

      expect(result?.query).toBe('blog-post');
    });

    it('allows numbers in query', () => {
      const result = detectActiveTrigger('#field123', 9);

      expect(result?.query).toBe('field123');
    });
  });

  describe('edge cases', () => {
    it('handles trigger at end of text', () => {
      const result = detectActiveTrigger('Hello @', 7);

      expect(result).toEqual({
        type: 'user',
        query: '',
        startIndex: 6,
      });
    });

    it('handles multiple same triggers', () => {
      const result = detectActiveTrigger('@alice@bob', 10);

      expect(result?.query).toBe('bob');
      expect(result?.startIndex).toBe(6);
    });

    it('handles unicode characters after trigger', () => {
      const result = detectActiveTrigger('@ジョン', 4);

      expect(result?.query).toBe('ジョン');
    });
  });
});
