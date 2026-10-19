import { describe, expect, it } from 'vitest';
import {
  formatGlossaryBlock,
  htmlToMatchableText,
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

describe('selectGlossaryTerms with combining marks', () => {
  const entries = parseLlmGlossary(
    ['hi,en,कम,less', 'ar,en,كتب,books', 'vi,en,ca,sing'].join('\n'),
  );

  it('treats marks as part of the word', () => {
    // ी (U+0940) is a vowel sign, so कमी is a different word.
    expect(selectGlossaryTerms(entries, 'hi', 'en', ['यह कमी है'])).toEqual([]);
    expect(
      selectGlossaryTerms(entries, 'hi', 'en', ['यह कम है']).map(
        (entry) => entry.target,
      ),
    ).toEqual(['less']);
    // Arabic harakat after the term continue the word.
    expect(selectGlossaryTerms(entries, 'ar', 'en', ['كتبُ'])).toEqual([]);
    // Decomposed Vietnamese: "cá" is c + a + U+0301.
    expect(
      selectGlossaryTerms(entries, 'vi', 'en', ['con ca\u0301 nhỏ']),
    ).toEqual([]);
  });
});

describe('selectGlossaryTerms with HTML', () => {
  const entries = parseLlmGlossary(
    ['en,de,R&D,F&E', 'en,de,Acme Corp,Acme GmbH', 'en,de,strong,stark'].join(
      '\n',
    ),
  );
  const sources = (texts: string[], isHtml: boolean) =>
    selectGlossaryTerms(entries, 'en', 'de', texts, isHtml).map(
      (entry) => entry.source,
    );

  it('decodes entities and ignores tags when isHtml is set', () => {
    expect(
      sources(['<p><strong>R&amp;D</strong> at Acme&nbsp;Corp</p>'], true),
    ).toEqual(['R&D', 'Acme Corp']);
    expect(sources(['<p>a &#x73;trong team</p>'], true)).toEqual(['strong']);
  });

  it('matches raw text when isHtml is not set', () => {
    expect(sources(['R&amp;D'], false)).toEqual([]);
  });
});

describe('htmlToMatchableText', () => {
  it('keeps unknown entities and drops tags', () => {
    expect(htmlToMatchableText('<b>a</b>&bogus;&#169;&#xA0;b')).toBe(
      ' a &bogus;© b',
    );
  });
});

describe('formatGlossaryBlock', () => {
  const terms = parseLlmGlossary(
    ['en,de,cart,Warenkorb', 'en,de,checkout,Kasse'].join('\n'),
  );

  it('returns an empty block without terms', () => {
    expect(formatGlossaryBlock([], 'en', 'de')).toEqual({
      text: '',
      omittedCount: 0,
    });
  });

  it('lists terms as quoted pairs', () => {
    const block = formatGlossaryBlock(terms, 'en', 'de');
    expect(block.omittedCount).toBe(0);
    expect(block.text).toContain('GLOSSARY (required terminology, en → de)');
    expect(block.text).toContain('- "cart" → "Warenkorb"');
  });

  it('drops terms that exceed the byte limit', () => {
    const full = formatGlossaryBlock(terms, 'en', 'de').text;
    const truncated = formatGlossaryBlock(terms, 'en', 'de', full.length - 1);
    expect(truncated.omittedCount).toBe(1);
    expect(truncated.text).toContain('Warenkorb');
    expect(truncated.text).not.toContain('Kasse');
    expect(formatGlossaryBlock(terms, 'en', 'de', 10)).toEqual({
      text: '',
      omittedCount: 2,
    });
  });
});
