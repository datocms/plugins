/**
 * Tests for localeUtils.ts
 * Tests locale name formatting and display functions.
 */

import { describe, expect, it } from 'vitest';
import {
  formatLocaleLabel,
  formatLocaleWithCode,
  getLocaleName,
  localeSelect,
} from './localeUtils';

describe('localeUtils.ts', () => {
  describe('localeSelect', () => {
    it('should be a function from locale-codes library', () => {
      expect(typeof localeSelect).toBe('function');
    });

    it('should return locale info for valid tags', () => {
      const result = localeSelect('en');
      expect(result).toBeDefined();
      expect(result?.tag).toBe('en');
    });
  });

  describe('getLocaleName', () => {
    it('should return English for en locale', () => {
      const name = getLocaleName('en');
      expect(name).toBe('English');
    });

    it('should return Portuguese (Brazil) for pt-BR locale', () => {
      const name = getLocaleName('pt-BR');
      // The exact format may vary, but should contain Portuguese
      expect(name.toLowerCase()).toContain('portuguese');
    });

    it('should return German for de locale', () => {
      const name = getLocaleName('de');
      expect(name).toBe('German');
    });

    it('should return French for fr locale', () => {
      const name = getLocaleName('fr');
      expect(name).toBe('French');
    });

    it('should return Spanish for es locale', () => {
      const name = getLocaleName('es');
      expect(name).toBe('Spanish');
    });

    it('should return Italian for it locale', () => {
      const name = getLocaleName('it');
      expect(name).toBe('Italian');
    });

    it('should return Japanese for ja locale', () => {
      const name = getLocaleName('ja');
      expect(name).toBe('Japanese');
    });

    it('should return Chinese for zh locale', () => {
      const name = getLocaleName('zh');
      // locale-codes may return variations like "Chinese" or "中文"
      expect(name.toLowerCase()).toContain('chinese');
    });

    it('should handle hyphenated locales with region', () => {
      const name = getLocaleName('en-US');
      // Should return something containing English
      expect(name.toLowerCase()).toContain('english');
    });

    it('should handle en-GB locale', () => {
      const name = getLocaleName('en-GB');
      expect(name.toLowerCase()).toContain('english');
    });

    it('should fallback to locale code for unknown locales', () => {
      const name = getLocaleName('xyz-unknown');
      // Should return the locale code or something containing it
      expect(name).toBeDefined();
      expect(typeof name).toBe('string');
    });

    it('should handle empty string gracefully', () => {
      const name = getLocaleName('');
      expect(name).toBeDefined();
      expect(typeof name).toBe('string');
    });
  });

  describe('formatLocaleWithCode', () => {
    it('should format English with code', () => {
      const formatted = formatLocaleWithCode('en');
      expect(formatted).toBe('English [en]');
    });

    it('should format German with code', () => {
      const formatted = formatLocaleWithCode('de');
      expect(formatted).toBe('German [de]');
    });

    it('should format French with code', () => {
      const formatted = formatLocaleWithCode('fr');
      expect(formatted).toBe('French [fr]');
    });

    it('should format hyphenated locales with code', () => {
      const formatted = formatLocaleWithCode('pt-BR');
      expect(formatted).toContain('[pt-BR]');
      expect(formatted.toLowerCase()).toContain('portuguese');
    });

    it('should format en-US with code', () => {
      const formatted = formatLocaleWithCode('en-US');
      expect(formatted).toContain('[en-US]');
    });

    it('should include locale code in brackets', () => {
      const locales = ['en', 'fr', 'de', 'es', 'it', 'ja', 'zh'];

      for (const locale of locales) {
        const formatted = formatLocaleWithCode(locale);
        expect(formatted).toContain(`[${locale}]`);
      }
    });

    it('should handle unknown locales with fallback', () => {
      const formatted = formatLocaleWithCode('unknown-locale');
      expect(formatted).toContain('[unknown-locale]');
    });
  });

  describe('formatLocaleLabel', () => {
    it('returns the English language name for a bare language tag', () => {
      expect(formatLocaleLabel('en')).toBe('English');
      expect(formatLocaleLabel('es')).toBe('Spanish');
      expect(formatLocaleLabel('fr')).toBe('French');
    });

    it('appends the English region name for language-region tags', () => {
      expect(formatLocaleLabel('es-ES')).toBe('Spanish (Spain)');
      expect(formatLocaleLabel('pt-BR')).toBe('Portuguese (Brazil)');
      expect(formatLocaleLabel('en-US')).toBe('English (United States)');
    });

    it('uppercases lowercase region subtags before resolving', () => {
      // BCP 47 region subtags are case-insensitive but `Intl.DisplayNames`
      // resolves uppercase canonically (`Region` of `es` returns nothing).
      expect(formatLocaleLabel('pt-br')).toBe('Portuguese (Brazil)');
    });

    it('falls back to the input for unknown or malformed tags', () => {
      expect(formatLocaleLabel('xyz-unknown')).toBe('xyz-unknown');
      expect(formatLocaleLabel('')).toBe('');
    });
  });
});
