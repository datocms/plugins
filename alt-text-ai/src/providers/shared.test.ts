import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALT_TEXT_PROMPT,
  expandPromptTemplate,
  sanitizeAltText,
} from './shared';

describe('provider shared helpers', () => {
  it('expands filenames literally and locales unambiguously', () => {
    const result = expandPromptTemplate('{filename} — {locale} — {filename}', {
      filename: '$&-hero.jpg',
      locale: 'pt-BR',
    });

    expect(result).toContain('$&-hero.jpg');
    expect(result).toContain('Portuguese');
    expect(result).toContain('locale code "pt-BR"');
  });

  it('does not let the Italian locale code read as the English pronoun', () => {
    expect(
      expandPromptTemplate('Write this in {locale}.', {
        filename: 'hero.jpg',
        locale: 'it',
      }),
    ).toBe('Write this in Italian (locale code "it").');
  });

  it('uses an accessible default prompt for an empty template', () => {
    const result = expandPromptTemplate('   ', {
      filename: 'hero.jpg',
      locale: 'en',
    });

    expect(result).not.toBe(DEFAULT_ALT_TEXT_PROMPT);
    expect(result).toContain('hero.jpg');
    expect(result).toContain('English');
    expect(result).toContain('locale code "en"');
  });

  it('removes common model wrappers and normalizes whitespace', () => {
    expect(
      sanitizeAltText('```text\nAlt text: “A red kite\n in the sky”\n```'),
    ).toBe('A red kite in the sky');
  });

  it('removes a label wrapped inside quotation marks', () => {
    expect(sanitizeAltText('"Alt text: A red kite"')).toBe('A red kite');
  });
});
