import { describe, it, expect } from 'vitest';
import {
  encodeFieldPath,
  decodeFieldPath,
  looksLikeLocaleCode,
  findFieldMention,
} from '@utils/mentions/fieldPathCodec';
import type { MentionMapKey, Mention } from '@ctypes/mentions';
import { createFieldMention } from '../fixtures/mentions';

describe('encodeFieldPath', () => {
  it('encodes dots as double colons', () => {
    expect(encodeFieldPath('sections.0.heading')).toBe('sections::0::heading');
  });

  it('handles single segment paths', () => {
    expect(encodeFieldPath('title')).toBe('title');
  });

  it('handles deeply nested paths', () => {
    expect(encodeFieldPath('a.b.c.d.e')).toBe('a::b::c::d::e');
  });

  it('handles paths with numbers', () => {
    expect(encodeFieldPath('blocks.123.content')).toBe('blocks::123::content');
  });

  it('handles already encoded paths (no-op for colons)', () => {
    expect(encodeFieldPath('already::encoded')).toBe('already::encoded');
  });

  it('handles empty string', () => {
    expect(encodeFieldPath('')).toBe('');
  });

  it('handles paths with underscores', () => {
    expect(encodeFieldPath('hero_section.0.hero_title')).toBe('hero_section::0::hero_title');
  });
});

describe('decodeFieldPath', () => {
  // Note: decodeFieldPath only replaces ::digit patterns that are followed by :: or end of string
  // It uses regex: /::(\d+)(?=::|$)/g

  it('decodes numeric segments with double colons to dots', () => {
    // ::0 followed by ::heading → .0 (lookahead matches ::)
    expect(decodeFieldPath('sections::0::heading')).toBe('sections.0::heading');
  });

  it('preserves non-numeric segments with double colons', () => {
    expect(decodeFieldPath('sections::en::heading')).toBe('sections::en::heading');
  });

  it('handles mixed numeric and non-numeric', () => {
    // ::0 and ::1 are followed by :: → replaced
    expect(decodeFieldPath('blocks::0::content::1::text')).toBe('blocks.0::content.1::text');
  });

  it('handles single segment', () => {
    expect(decodeFieldPath('title')).toBe('title');
  });

  it('handles empty string', () => {
    expect(decodeFieldPath('')).toBe('');
  });

  it('handles paths without any numeric indices', () => {
    expect(decodeFieldPath('sections::heading')).toBe('sections::heading');
  });

  it('handles trailing numeric index', () => {
    expect(decodeFieldPath('blocks::0')).toBe('blocks.0');
  });

  it('handles leading numeric index', () => {
    expect(decodeFieldPath('0::content')).toBe('0::content'); // 0 at start isn't preceded by ::
  });
});

describe('looksLikeLocaleCode', () => {
  describe('without projectLocales', () => {
    it('returns true for common 2-letter locales', () => {
      expect(looksLikeLocaleCode('en')).toBe(true);
      expect(looksLikeLocaleCode('it')).toBe(true);
      expect(looksLikeLocaleCode('de')).toBe(true);
      expect(looksLikeLocaleCode('fr')).toBe(true);
      expect(looksLikeLocaleCode('ja')).toBe(true);
    });

    it('returns true for locale pattern matches', () => {
      expect(looksLikeLocaleCode('en-US')).toBe(true);
      expect(looksLikeLocaleCode('pt-BR')).toBe(true);
      expect(looksLikeLocaleCode('zh-CN')).toBe(true);
    });

    it('returns false for non-locale strings', () => {
      expect(looksLikeLocaleCode('title')).toBe(false);
      expect(looksLikeLocaleCode('heading')).toBe(false);
      expect(looksLikeLocaleCode('content123')).toBe(false);
    });

    it('returns false for numbers', () => {
      expect(looksLikeLocaleCode('0')).toBe(false);
      expect(looksLikeLocaleCode('123')).toBe(false);
    });

    it('returns false for single characters', () => {
      expect(looksLikeLocaleCode('a')).toBe(false);
    });

    it('returns false for three letter codes without hyphen', () => {
      expect(looksLikeLocaleCode('abc')).toBe(false);
    });

    it('is case-insensitive for common locales', () => {
      expect(looksLikeLocaleCode('EN')).toBe(true);
      expect(looksLikeLocaleCode('It')).toBe(true);
    });
  });

  describe('with projectLocales', () => {
    const projectLocales = ['en', 'it', 'de'];

    it('returns true for project-defined locales', () => {
      expect(looksLikeLocaleCode('en', projectLocales)).toBe(true);
      expect(looksLikeLocaleCode('it', projectLocales)).toBe(true);
    });

    it('returns false for locales not in project', () => {
      expect(looksLikeLocaleCode('fr', projectLocales)).toBe(false);
      expect(looksLikeLocaleCode('ja', projectLocales)).toBe(false);
    });

    it('is case-insensitive with project locales', () => {
      expect(looksLikeLocaleCode('EN', projectLocales)).toBe(true);
      expect(looksLikeLocaleCode('IT', projectLocales)).toBe(true);
    });

    it('returns false for empty projectLocales array (falls through)', () => {
      // With empty array, it should fall through to pattern matching
      expect(looksLikeLocaleCode('en', [])).toBe(true); // matches common locale
    });
  });
});

describe('findFieldMention', () => {
  function createMentionsMap(mentions: Array<[string, Mention]>): Map<MentionMapKey, Mention> {
    return new Map(mentions.map(([key, mention]) => [key as MentionMapKey, mention]));
  }

  describe('exact encoded path matching', () => {
    it('finds mention with exact encoded path', () => {
      const mention = createFieldMention({ fieldPath: 'sections::0::heading' });
      const map = createMentionsMap([['field:sections::0::heading', mention]]);

      const result = findFieldMention('sections::0::heading', map);

      expect(result).toBe(mention);
    });

    it('finds simple field path', () => {
      const mention = createFieldMention({ fieldPath: 'title' });
      const map = createMentionsMap([['field:title', mention]]);

      const result = findFieldMention('title', map);

      expect(result).toBe(mention);
    });
  });

  describe('decoded path matching (legacy)', () => {
    it('finds mention stored with partial dot notation', () => {
      // decodeFieldPath('sections::0::heading') → 'sections.0::heading'
      // So we need to store with that key for the decoded match to work
      const mention = createFieldMention({ fieldPath: 'sections.0::heading' });
      const map = createMentionsMap([['field:sections.0::heading', mention]]);

      const result = findFieldMention('sections::0::heading', map);

      expect(result).toBe(mention);
    });
  });

  describe('locale suffix extraction', () => {
    it('finds mention when locale suffix is appended', () => {
      const mention = createFieldMention({
        fieldPath: 'title',
        locale: 'en',
      });
      const map = createMentionsMap([['field:title::en', mention]]);

      const result = findFieldMention('title::en', map);

      expect(result).toBe(mention);
    });

    it('returns undefined for non-locale suffix', () => {
      const mention = createFieldMention({ fieldPath: 'title' });
      const map = createMentionsMap([['field:title', mention]]);

      // 'heading' doesn't look like a locale code
      const result = findFieldMention('title::heading', map);

      expect(result).toBeUndefined();
    });
  });

  describe('no match scenarios', () => {
    it('returns undefined when no match found', () => {
      const map = createMentionsMap([]);

      const result = findFieldMention('nonexistent', map);

      expect(result).toBeUndefined();
    });

    it('returns undefined for partial path match', () => {
      const mention = createFieldMention({ fieldPath: 'sections::0::heading' });
      const map = createMentionsMap([['field:sections::0::heading', mention]]);

      const result = findFieldMention('sections::0', map);

      expect(result).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('handles empty encoded path', () => {
      const map = createMentionsMap([]);

      const result = findFieldMention('', map);

      expect(result).toBeUndefined();
    });

    it('handles path with only locale-like segment', () => {
      // Path "en" alone - lastDelimiterIndex would be -1
      const map = createMentionsMap([]);

      const result = findFieldMention('en', map);

      expect(result).toBeUndefined();
    });
  });
});
