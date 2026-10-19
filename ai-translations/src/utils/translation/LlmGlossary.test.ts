import { describe, expect, it } from 'vitest';
import {
  formatGlossaryBlock,
  parseLlmGlossary,
  selectGlossaryTerms,
} from './LlmGlossary';

describe('parseLlmGlossary', () => {
  it('parses CSV lines, skipping comments, blanks and incomplete rows', () => {
    expect(
      parseLlmGlossary(
        [
          '# comment',
          '',
          'en, de , checkout , Kasse',
          'en,de,missing-target',
          '*,it,"Hello, world","Ciao, mondo"',
          'en,fr,"say ""hi""",dis bonjour',
        ].join('\r\n'),
      ),
    ).toEqual([
      { fromLocale: 'en', toLocale: 'de', source: 'checkout', target: 'Kasse' },
      {
        fromLocale: '*',
        toLocale: 'it',
        source: 'Hello, world',
        target: 'Ciao, mondo',
      },
      {
        fromLocale: 'en',
        toLocale: 'fr',
        source: 'say "hi"',
        target: 'dis bonjour',
      },
    ]);
  });

  it('returns an empty list for missing input', () => {
    expect(parseLlmGlossary(undefined)).toEqual([]);
    expect(parseLlmGlossary('')).toEqual([]);
  });
});

describe('selectGlossaryTerms', () => {
  const entries = parseLlmGlossary(
    [
      '*,*,DatoCMS,DatoCMS',
      'en,*,cart,basket',
      'en,de,cart,Warenkorb',
      'en,de,cat,Katze',
      'EN,DE,C++,C++',
      'ja,en,猫,cat',
      'en,fr,cart,panier',
    ].join('\n'),
  );

  it('keeps only terms found in the text, case-insensitively', () => {
    expect(
      selectGlossaryTerms(entries, 'en', 'de', ['Add to CART', 'Built on datocms']),
    ).toEqual([
      { fromLocale: '*', toLocale: '*', source: 'DatoCMS', target: 'DatoCMS' },
      { fromLocale: 'en', toLocale: 'de', source: 'cart', target: 'Warenkorb' },
    ]);
  });

  it('prefers the most specific locale pair for the same term', () => {
    expect(
      selectGlossaryTerms(entries, 'en', 'it', ['cart'])[0].target,
    ).toBe('basket');
    expect(
      selectGlossaryTerms(entries, 'en', 'de', ['cart'])[0].target,
    ).toBe('Warenkorb');
  });

  it('matches whole words only in spaced scripts', () => {
    expect(selectGlossaryTerms(entries, 'en', 'de', ['category'])).toEqual([]);
    expect(
      selectGlossaryTerms(entries, 'en', 'de', ['I love C++!']).map(
        (entry) => entry.source,
      ),
    ).toEqual(['C++']);
  });

  it('matches inside running text in unspaced scripts', () => {
    expect(
      selectGlossaryTerms(entries, 'ja', 'en', ['これは猫です']).map(
        (entry) => entry.target,
      ),
    ).toEqual(['cat']);
  });

  it('ignores entries for other locale pairs', () => {
    expect(selectGlossaryTerms(entries, 'de', 'en', ['cart'])).toEqual([]);
  });
});

describe('formatGlossaryBlock', () => {
  it('returns an empty string without terms', () => {
    expect(formatGlossaryBlock([], 'en', 'de')).toBe('');
  });

  it('lists terms as quoted pairs', () => {
    const block = formatGlossaryBlock(
      [{ fromLocale: 'en', toLocale: 'de', source: 'cart', target: 'Warenkorb' }],
      'en',
      'de',
    );
    expect(block).toContain('GLOSSARY (required terminology, en → de)');
    expect(block).toContain('- "cart" → "Warenkorb"');
  });
});
