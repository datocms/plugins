/**
 * Tests for DeepLSettings.ts
 * Tests tag-list parsing and formality mapping for DeepL requests.
 */

import { describe, expect, it } from 'vitest';
import {
  DEEPL_DEFAULT_IGNORE_TAGS,
  DEEPL_DEFAULT_NON_SPLITTING_TAGS,
  parseDeepLTagList,
  toDeepLFormality,
} from './DeepLSettings';

describe('DeepLSettings.ts', () => {
  describe('parseDeepLTagList', () => {
    it('uses the fallback when the setting was never saved', () => {
      expect(parseDeepLTagList(undefined, DEEPL_DEFAULT_IGNORE_TAGS)).toEqual([
        'notranslate',
        'ph',
      ]);
      expect(
        parseDeepLTagList(undefined, DEEPL_DEFAULT_NON_SPLITTING_TAGS),
      ).toEqual(['a', 'code', 'pre', 'strong', 'em', 'ph', 'notranslate']);
    });

    it('keeps an explicitly cleared setting empty', () => {
      expect(parseDeepLTagList('', DEEPL_DEFAULT_IGNORE_TAGS)).toEqual([]);
      expect(parseDeepLTagList('  ,  ', DEEPL_DEFAULT_IGNORE_TAGS)).toEqual([]);
    });

    it('splits on commas, whitespace and new lines', () => {
      expect(parseDeepLTagList('a, code\npre  em', '')).toEqual([
        'a',
        'code',
        'pre',
        'em',
      ]);
    });

    it('strips angle brackets and drops duplicates', () => {
      expect(parseDeepLTagList('<code>, </code>, code, <x-keep/>', '')).toEqual(
        ['code', 'x-keep'],
      );
    });
  });

  describe('toDeepLFormality', () => {
    it('maps more and less to the prefer_ variants', () => {
      expect(toDeepLFormality('more')).toBe('prefer_more');
      expect(toDeepLFormality('less')).toBe('prefer_less');
    });

    it('omits formality for the default or a missing setting', () => {
      expect(toDeepLFormality('default')).toBeUndefined();
      expect(toDeepLFormality(undefined)).toBeUndefined();
    });
  });
});
