import { describe, expect, it } from 'vitest';
import {
  isFieldExcluded,
  isFieldRequired,
  normalizeTranslatedSlug,
} from './SharedFieldUtils';

describe('SharedFieldUtils', () => {
  describe('normalizeTranslatedSlug', () => {
    it('normalizes accents and punctuation', () => {
      expect(normalizeTranslatedSlug('Caffè & tè!')).toBe('caffe-te');
    });

    it('collapses repeated spaces and hyphens', () => {
      expect(normalizeTranslatedSlug('hello   --   world')).toBe('hello-world');
    });

    it('removes apostrophes cleanly', () => {
      expect(normalizeTranslatedSlug(`what's new`)).toBe('what-s-new');
    });

    it('preserves valid slugs', () => {
      expect(normalizeTranslatedSlug('already-valid_slug')).toBe(
        'already-valid_slug',
      );
    });

    it('returns empty string when nothing valid remains', () => {
      expect(normalizeTranslatedSlug('!!!')).toBe('');
    });
  });

  describe('isFieldExcluded', () => {
    it('matches field IDs and API keys', () => {
      expect(isFieldExcluded(['field-id-1'], ['field-id-1', 'slug'])).toBe(
        true,
      );
      expect(isFieldExcluded(['slug'], ['field-id-1', 'slug'])).toBe(true);
    });

    it('matches legacy dot-notation paths by their last segment', () => {
      expect(isFieldExcluded(['details.en.slug'], ['field-id-1', 'slug'])).toBe(
        true,
      );
    });
  });

  describe('isFieldRequired', () => {
    it('returns true when validators contain the required key', () => {
      expect(isFieldRequired({ required: {} })).toBe(true);
    });

    it('returns false when validators are empty or missing required', () => {
      expect(isFieldRequired({})).toBe(false);
      expect(isFieldRequired(undefined)).toBe(false);
    });
  });
});
