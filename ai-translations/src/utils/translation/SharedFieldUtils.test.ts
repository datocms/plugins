import { describe, expect, it } from 'vitest';
import {
  hasMinItemsValidator,
  isFieldExcluded,
  isFieldRequired,
  isReferenceField,
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

  describe('hasMinItemsValidator', () => {
    it('returns true when size.min requires at least one item', () => {
      expect(hasMinItemsValidator({ size: { min: 2 } })).toBe(true);
      expect(hasMinItemsValidator({ size: { min: 1 } })).toBe(true);
    });

    it('returns true when size.eq requires an exact non-zero count', () => {
      expect(hasMinItemsValidator({ size: { eq: 3 } })).toBe(true);
    });

    it('returns false when size only caps the maximum or allows zero', () => {
      expect(hasMinItemsValidator({ size: { max: 5 } })).toBe(false);
      expect(hasMinItemsValidator({ size: { min: 0 } })).toBe(false);
      expect(hasMinItemsValidator({ size: { eq: 0 } })).toBe(false);
    });

    it('returns false when there is no size validator', () => {
      expect(hasMinItemsValidator({ required: {} })).toBe(false);
      expect(hasMinItemsValidator({})).toBe(false);
      expect(hasMinItemsValidator(undefined)).toBe(false);
    });
  });

  describe('isReferenceField', () => {
    it('detects a single link field via item_item_type', () => {
      expect(
        isReferenceField({ item_item_type: { item_types: ['abc'] } }),
      ).toBe(true);
    });

    it('detects a multiple links field via items_item_type', () => {
      expect(
        isReferenceField({
          items_item_type: { item_types: ['abc'] },
          size: { min: 2 },
        }),
      ).toBe(true);
    });

    it('returns false for non-reference fields', () => {
      expect(isReferenceField({ required: {} })).toBe(false);
      // structured_text_links must NOT be treated as a reference field:
      // structured text is translated normally, not locale-copied.
      expect(
        isReferenceField({
          structured_text_blocks: { item_types: [] },
          structured_text_links: { item_types: [] },
        }),
      ).toBe(false);
      expect(isReferenceField({})).toBe(false);
      expect(isReferenceField(undefined)).toBe(false);
    });
  });
});
