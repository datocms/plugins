/**
 * Tests for utils.ts
 * Tests text extraction, object reconstruction, and structured text utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  isEmptyStructuredText,
  extractTextValues,
  removeIds,
  reconstructObject,
  insertObjectAtIndex,
  deleteItemIdKeys,
} from './utils';

describe('utils.ts', () => {
  describe('isEmptyStructuredText', () => {
    it('should return true for empty paragraph structure', () => {
      const emptyStructuredText = [
        {
          type: 'paragraph',
          children: [{ text: '' }],
        },
      ];
      expect(isEmptyStructuredText(emptyStructuredText)).toBe(true);
    });

    it('should return false for non-empty paragraph', () => {
      const nonEmpty = [
        {
          type: 'paragraph',
          children: [{ text: 'Hello world' }],
        },
      ];
      expect(isEmptyStructuredText(nonEmpty)).toBe(false);
    });

    it('should return false for multiple paragraphs', () => {
      const multiple = [
        { type: 'paragraph', children: [{ text: '' }] },
        { type: 'paragraph', children: [{ text: '' }] },
      ];
      expect(isEmptyStructuredText(multiple)).toBe(false);
    });

    it('should return false for non-paragraph types', () => {
      const heading = [
        { type: 'heading', children: [{ text: '' }] },
      ];
      expect(isEmptyStructuredText(heading)).toBe(false);
    });

    it('should return false for multiple children', () => {
      const multipleChildren = [
        { type: 'paragraph', children: [{ text: '' }, { text: '' }] },
      ];
      expect(isEmptyStructuredText(multipleChildren)).toBe(false);
    });

    it('should return false for non-array values', () => {
      expect(isEmptyStructuredText(null)).toBe(false);
      expect(isEmptyStructuredText(undefined)).toBe(false);
      expect(isEmptyStructuredText('string')).toBe(false);
      expect(isEmptyStructuredText({})).toBe(false);
    });

    it('should return false for empty array', () => {
      expect(isEmptyStructuredText([])).toBe(false);
    });
  });

  describe('extractTextValues', () => {
    it('should extract text from simple structure', () => {
      const data = {
        text: 'Hello',
      };
      expect(extractTextValues(data)).toEqual(['Hello']);
    });

    it('should extract text from nested structures', () => {
      const data = {
        children: [
          { text: 'Hello' },
          { text: ' ' },
          { text: 'World' },
        ],
      };
      expect(extractTextValues(data)).toEqual(['Hello', ' ', 'World']);
    });

    it('should extract value fields with string values', () => {
      const data = {
        type: 'node',
        value: 'Some value',
      };
      expect(extractTextValues(data)).toEqual(['Some value']);
    });

    it('should handle deeply nested structures', () => {
      const data = {
        document: {
          children: [
            {
              type: 'paragraph',
              children: [
                { text: 'First ' },
                { type: 'link', children: [{ text: 'link text' }] },
                { text: ' end' },
              ],
            },
          ],
        },
      };
      expect(extractTextValues(data)).toEqual(['First ', 'link text', ' end']);
    });

    it('should handle arrays at root level', () => {
      const data = [
        { text: 'One' },
        { text: 'Two' },
        { text: 'Three' },
      ];
      expect(extractTextValues(data)).toEqual(['One', 'Two', 'Three']);
    });

    it('should return empty array for primitives', () => {
      expect(extractTextValues(null)).toEqual([]);
      expect(extractTextValues(undefined)).toEqual([]);
      expect(extractTextValues('string')).toEqual([]);
      expect(extractTextValues(123)).toEqual([]);
    });

    it('should handle circular references without infinite loop', () => {
      const obj: Record<string, unknown> = { text: 'Hello' };
      obj.self = obj; // Circular reference

      const result = extractTextValues(obj);
      expect(result).toEqual(['Hello']);
    });

    it('should extract empty strings as text values', () => {
      const data = {
        children: [
          { text: '' },
          { text: 'Hello' },
        ],
      };
      expect(extractTextValues(data)).toEqual(['', 'Hello']);
    });
  });

  describe('removeIds', () => {
    it('should remove id keys from objects', () => {
      const data = {
        id: '123',
        text: 'Hello',
      };
      expect(removeIds(data)).toEqual({ text: 'Hello' });
    });

    it('should remove ids from nested objects', () => {
      const data = {
        id: 'parent',
        child: {
          id: 'child',
          text: 'Hello',
        },
      };
      expect(removeIds(data)).toEqual({
        child: { text: 'Hello' },
      });
    });

    it('should remove ids from arrays of objects', () => {
      const data = [
        { id: '1', text: 'One' },
        { id: '2', text: 'Two' },
      ];
      expect(removeIds(data)).toEqual([
        { text: 'One' },
        { text: 'Two' },
      ]);
    });

    it('should preserve id when object has only id and value properties', () => {
      const data = {
        id: 'meta-id',
        value: 'some value',
      };
      expect(removeIds(data)).toEqual({
        id: 'meta-id',
        value: 'some value',
      });
    });

    it('should preserve data key as-is', () => {
      const data = {
        data: {
          id: 'inner-id',
          nested: 'value',
        },
      };
      const result = removeIds(data);
      expect(result).toEqual({
        data: {
          id: 'inner-id',
          nested: 'value',
        },
      });
    });

    it('should return primitives unchanged', () => {
      expect(removeIds('string')).toBe('string');
      expect(removeIds(123)).toBe(123);
      expect(removeIds(null)).toBe(null);
      expect(removeIds(undefined)).toBe(undefined);
      expect(removeIds(true)).toBe(true);
    });
  });

  describe('reconstructObject', () => {
    it('should replace text values in order', () => {
      const original = {
        children: [
          { text: 'Hello' },
          { text: 'World' },
        ],
      };
      const translations = ['Hola', 'Mundo'];

      const result = reconstructObject(original, translations);

      expect(result).toEqual({
        children: [
          { text: 'Hola' },
          { text: 'Mundo' },
        ],
      });
    });

    it('should replace value strings in order', () => {
      const original = [
        { type: 'node', value: 'Original value' },
      ];
      const translations = ['Translated value'];

      const result = reconstructObject(original, translations);

      expect(result).toEqual([
        { type: 'node', value: 'Translated value' },
      ]);
    });

    it('should preserve non-text properties', () => {
      const original = {
        type: 'paragraph',
        children: [
          { text: 'Hello', bold: true },
        ],
      };
      const translations = ['Bonjour'];

      const result = reconstructObject(original, translations);

      expect(result).toEqual({
        type: 'paragraph',
        children: [
          { text: 'Bonjour', bold: true },
        ],
      });
    });

    it('should handle nested structures', () => {
      const original = {
        document: {
          children: [
            { text: 'One' },
            { link: { children: [{ text: 'Two' }] } },
          ],
        },
      };
      const translations = ['Uno', 'Dos'];

      const result = reconstructObject(original, translations);

      expect(result).toEqual({
        document: {
          children: [
            { text: 'Uno' },
            { link: { children: [{ text: 'Dos' }] } },
          ],
        },
      });
    });

    it('should handle circular references without infinite loop', () => {
      const obj: Record<string, unknown> = {
        text: 'Hello',
        nested: {},
      };
      (obj.nested as Record<string, unknown>).parent = obj;

      const translations = ['Hola'];
      const result = reconstructObject(obj, translations) as Record<string, unknown>;

      expect((result as { text: string }).text).toBe('Hola');
    });

    it('should return primitives unchanged', () => {
      expect(reconstructObject('string', ['translated'])).toBe('string');
      expect(reconstructObject(123, ['translated'])).toBe(123);
      expect(reconstructObject(null, ['translated'])).toBe(null);
    });
  });

  describe('insertObjectAtIndex', () => {
    it('should insert at the beginning', () => {
      const arr = ['a', 'b', 'c'];
      const result = insertObjectAtIndex(arr, 'x', 0);
      expect(result).toEqual(['x', 'a', 'b', 'c']);
    });

    it('should insert at the end', () => {
      const arr = ['a', 'b', 'c'];
      const result = insertObjectAtIndex(arr, 'x', 3);
      expect(result).toEqual(['a', 'b', 'c', 'x']);
    });

    it('should insert in the middle', () => {
      const arr = ['a', 'b', 'c'];
      const result = insertObjectAtIndex(arr, 'x', 1);
      expect(result).toEqual(['a', 'x', 'b', 'c']);
    });

    it('should not mutate the original array', () => {
      const arr = ['a', 'b', 'c'];
      insertObjectAtIndex(arr, 'x', 1);
      expect(arr).toEqual(['a', 'b', 'c']);
    });

    it('should work with objects', () => {
      const arr = [{ id: 1 }, { id: 2 }];
      const result = insertObjectAtIndex(arr, { id: 3 }, 1);
      expect(result).toEqual([{ id: 1 }, { id: 3 }, { id: 2 }]);
    });

    it('should handle empty arrays', () => {
      const arr: string[] = [];
      const result = insertObjectAtIndex(arr, 'x', 0);
      expect(result).toEqual(['x']);
    });
  });

  describe('deleteItemIdKeys', () => {
    it('should remove itemId keys', () => {
      const data = {
        itemId: '123',
        text: 'Hello',
      };
      expect(deleteItemIdKeys(data)).toEqual({ text: 'Hello' });
    });

    it('should remove id keys', () => {
      const data = {
        id: '123',
        text: 'Hello',
      };
      expect(deleteItemIdKeys(data)).toEqual({ text: 'Hello' });
    });

    it('should remove both itemId and id from nested structures', () => {
      const data = {
        itemId: 'parent',
        id: 'also-parent',
        child: {
          itemId: 'child-item',
          id: 'child-id',
          value: 'test',
        },
      };
      expect(deleteItemIdKeys(data)).toEqual({
        child: { value: 'test' },
      });
    });

    it('should remove from arrays', () => {
      const data = [
        { itemId: '1', text: 'One' },
        { id: '2', text: 'Two' },
      ];
      expect(deleteItemIdKeys(data)).toEqual([
        { text: 'One' },
        { text: 'Two' },
      ]);
    });

    it('should preserve data key as-is', () => {
      const data = {
        data: {
          itemId: 'inner-id',
          id: 'also-inner',
          nested: 'value',
        },
      };
      expect(deleteItemIdKeys(data)).toEqual({
        data: {
          itemId: 'inner-id',
          id: 'also-inner',
          nested: 'value',
        },
      });
    });

    it('should return primitives unchanged', () => {
      expect(deleteItemIdKeys('string')).toBe('string');
      expect(deleteItemIdKeys(123)).toBe(123);
      expect(deleteItemIdKeys(null)).toBe(null);
      expect(deleteItemIdKeys(undefined)).toBe(undefined);
    });
  });
});
