import { describe, expect, it } from 'vitest';
import {
  ALL_SCOPE,
  isScope,
  resolveScope,
  type Scope,
  scopeLabel,
} from './scope';

const models = [
  { id: 'article', name: 'Article' },
  { id: 'news', name: 'News' },
  { id: 'page', name: 'Page' },
];
const siteLocales = ['en', 'it', 'de'];

// Facts are joined with a no-break space before the bullet.
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('isScope', () => {
  it('accepts "all" or string lists for both dimensions', () => {
    expect(isScope(ALL_SCOPE)).toBe(true);
    expect(isScope({ modelIds: ['page'], localeIds: 'all' })).toBe(true);
    expect(isScope({ modelIds: [], localeIds: ['en'] })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isScope(undefined)).toBe(false);
    expect(isScope(null)).toBe(false);
    expect(isScope('all')).toBe(false);
    expect(isScope({ modelIds: 'all' })).toBe(false);
    expect(isScope({ modelIds: 'some', localeIds: 'all' })).toBe(false);
    expect(isScope({ modelIds: [1], localeIds: 'all' })).toBe(false);
  });
});

describe('resolveScope', () => {
  it('drops unknown IDs and keeps the loader and site order', () => {
    const scope: Scope = {
      modelIds: ['page', 'missing', 'article'],
      localeIds: ['it', 'fr', 'en'],
    };
    const resolved = resolveScope(scope, models, siteLocales);
    expect(resolved.models.map((model) => model.id)).toEqual([
      'article',
      'page',
    ]);
    expect(resolved.locales).toEqual(['en', 'it']);
  });

  it('expands "all"', () => {
    const resolved = resolveScope(ALL_SCOPE, models, siteLocales);
    expect(resolved.models).toEqual(models);
    expect(resolved.locales).toEqual(siteLocales);
  });
});

describe('scopeLabel', () => {
  const label = (scope: Scope, locales = siteLocales) =>
    plain(scopeLabel(scope, models, locales, 'en'));

  it('names everything, one model, or a count', () => {
    expect(label(ALL_SCOPE)).toBe('All models • All locales');
    expect(label({ modelIds: ['news'], localeIds: 'all' })).toBe(
      'News • All locales',
    );
    expect(label({ modelIds: ['news', 'page'], localeIds: ['en', 'it'] })).toBe(
      '2 of 3 models • English and Italian',
    );
    expect(label({ modelIds: ['page'], localeIds: ['en'] })).toBe(
      'Page • English',
    );
    expect(
      label({ modelIds: ['news', 'page', 'article'], localeIds: ['en'] }),
    ).toBe('All models • English');
  });

  it('counts three or more of the site locales', () => {
    expect(
      label({ modelIds: 'all', localeIds: ['en', 'it', 'de'] }, [
        'en',
        'it',
        'de',
        'fr',
      ]),
    ).toBe('All models • 3 locales');
  });

  it('keeps "All" for two models or two locales', () => {
    expect(
      plain(scopeLabel(ALL_SCOPE, models.slice(0, 2), ['en', 'it'], 'en')),
    ).toBe('All models • All locales');
  });

  it('leaves the locale out on a single-locale site', () => {
    expect(label(ALL_SCOPE, ['en'])).toBe('All models');
    expect(label({ modelIds: ['page'], localeIds: 'all' }, ['en'])).toBe(
      'Page',
    );
  });
});
