import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALT_TEXT_PROMPT,
  expandPromptTemplate,
  sanitizeAltText,
} from './shared';

describe('provider shared helpers', () => {
  it('expands every prompt placeholder as literal text', () => {
    expect(
      expandPromptTemplate('{filename} — {locale} — {filename}', {
        filename: '$&-hero.jpg',
        locale: 'pt-BR',
      }),
    ).toBe('$&-hero.jpg — pt-BR — $&-hero.jpg');
  });

  it('uses an accessible default prompt for an empty template', () => {
    const result = expandPromptTemplate('   ', {
      filename: 'hero.jpg',
      locale: 'en',
    });

    expect(result).not.toBe(DEFAULT_ALT_TEXT_PROMPT);
    expect(result).toContain('hero.jpg');
    expect(result).toContain('in en');
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
