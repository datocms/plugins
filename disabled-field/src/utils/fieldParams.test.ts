import { describe, expect, it } from 'vitest';
import {
  normalizeDisabledLocales,
  resolveFieldLocale,
  shouldDisableField,
} from './fieldParams';

const siteLocales = ['en', 'it'];

describe('normalizeDisabledLocales', () => {
  it('returns [] for legacy parameters', () => {
    expect(normalizeDisabledLocales({})).toEqual([]);
  });

  it('drops non-string entries', () => {
    expect(normalizeDisabledLocales({ disabledLocales: ['it', 3] })).toEqual([
      'it',
    ]);
  });
});

describe('resolveFieldLocale', () => {
  it('uses ctx.locale for localized fields', () => {
    expect(
      resolveFieldLocale({
        locale: 'it',
        isLocalized: true,
        fieldPath: 'title.it',
        siteLocales,
      }),
    ).toBe('it');
  });

  it('reads the locale segment for block fields', () => {
    expect(
      resolveFieldLocale({
        locale: 'en',
        isLocalized: false,
        fieldPath: 'content.it.0.title',
        siteLocales,
      }),
    ).toBe('it');
  });

  it('returns undefined when no locale applies', () => {
    expect(
      resolveFieldLocale({
        locale: 'en',
        isLocalized: false,
        fieldPath: 'content.0.title',
        siteLocales,
      }),
    ).toBeUndefined();
  });
});

describe('shouldDisableField', () => {
  const localizedIt = {
    locale: 'it',
    isLocalized: true,
    fieldPath: 'title.it',
    siteLocales,
  };

  it('disables in every locale when the list is empty', () => {
    expect(shouldDisableField([], localizedIt)).toBe(true);
  });

  it('disables only the selected locales', () => {
    expect(shouldDisableField(['it'], localizedIt)).toBe(true);
    expect(
      shouldDisableField(['it'], {
        ...localizedIt,
        locale: 'en',
        fieldPath: 'title.en',
      }),
    ).toBe(false);
  });

  it('honours the list for block fields inside a localized field', () => {
    const blockField = {
      locale: 'en',
      isLocalized: false,
      fieldPath: 'content.en.0.title',
      siteLocales,
    };
    expect(shouldDisableField(['it'], blockField)).toBe(false);
    expect(
      shouldDisableField(['it'], {
        ...blockField,
        fieldPath: 'content.it.0.title',
      }),
    ).toBe(true);
  });

  it('always disables fields with no locale', () => {
    expect(
      shouldDisableField(['it'], {
        locale: 'en',
        isLocalized: false,
        fieldPath: 'sku',
        siteLocales,
      }),
    ).toBe(true);
  });
});
