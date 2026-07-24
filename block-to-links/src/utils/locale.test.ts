import { describe, expect, it } from 'vitest';
import { mergeLocaleData } from './locale';

const projectLocales = [
  'en',
  'de-DE',
  'fr-FR',
  'fr-BE',
  'it-IT',
  'nl-NL',
  'nl-BE',
  'de-AT',
  'de-CH',
  'en-CH',
  'it-CH',
  'fr-CH',
];

describe('mergeLocaleData', () => {
  it('materializes only locales represented by source blocks', () => {
    const result = mergeLocaleData(
      {
        en: { title: 'English', slides: ['slide-en'] },
        'de-DE': { title: 'Deutsch', slides: ['slide-de'] },
      },
      new Set(['title', 'slides']),
      projectLocales,
    );

    expect(Object.keys(result.title)).toEqual(['en', 'de-DE']);
    expect(Object.keys(result.slides)).toEqual(['en', 'de-DE']);
    expect(result.slides).not.toHaveProperty('en-CH');
    expect(result.slides).not.toHaveProperty('it-CH');
    expect(result.slides).not.toHaveProperty('fr-CH');
  });

  it('uses null instead of another locale when a source field is missing', () => {
    const result = mergeLocaleData(
      {
        en: { title: 'English', slides: ['slide-en'] },
        'de-DE': { title: 'Deutsch' },
      },
      new Set(['title', 'slides']),
      projectLocales,
    );

    expect(result.slides).toEqual({
      en: ['slide-en'],
      'de-DE': null,
    });
  });

  it('places a non-localized source only in the main locale', () => {
    const result = mergeLocaleData(
      {
        __default__: {
          title: 'Shared title',
          slides: ['shared-slide'],
        },
      },
      new Set(['title', 'slides']),
      projectLocales,
    );

    expect(result).toEqual({
      title: { en: 'Shared title' },
      slides: { en: ['shared-slide'] },
    });
  });
});
