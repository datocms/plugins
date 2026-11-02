import { describe, expect, it } from 'vitest';
import type { LinkOccurrence } from '../types';
import {
  countLabel,
  FACT_SEPARATOR,
  formatWarning,
  groupWarnings,
  joinFacts,
  joinNames,
  localeName,
  locationParts,
  placeName,
  preciseWarnings,
} from './format';

function occurrence(overrides: Partial<LinkOccurrence> = {}): LinkOccurrence {
  return {
    id: 'occurrence-1',
    recordId: 'record-1',
    recordTitle: 'Pricing news',
    modelId: 'news',
    modelName: 'News',
    fieldPath: 'body.en',
    fieldLabel: 'Body',
    locale: 'en',
    blockPath: [],
    url: 'https://example.com/',
    ...overrides,
  };
}

describe('locationParts', () => {
  it('puts a top-level field alone, with no surrounding path', () => {
    expect(locationParts(occurrence(), 'en', true)).toEqual({
      field: 'Body',
      parents: '',
      locale: 'English',
    });
  });

  it('drops a container label repeated as the field label', () => {
    expect(
      locationParts(
        occurrence({ blockPath: ['Body'], fieldLabel: 'Body' }),
        'en',
        false,
      ),
    ).toEqual({ field: 'Body', parents: '', locale: undefined });
  });

  it('splits a nested field from the fields and blocks around it', () => {
    expect(
      locationParts(
        occurrence({
          blockPath: ['Content', '📲 CTA App Download 1'],
          fieldLabel: 'Google Play URL',
          locale: 'de',
        }),
        'en',
        true,
      ),
    ).toEqual({
      field: 'Google Play URL',
      parents: 'Content > 📲 CTA App Download 1',
      locale: 'German',
    });
  });

  it('collapses repeated adjacent labels inside the path', () => {
    expect(
      locationParts(
        occurrence({ blockPath: ['Hero', 'Hero'], fieldLabel: 'Link' }),
        'en',
        false,
      ),
    ).toMatchObject({ field: 'Link', parents: 'Hero' });
  });

  it('leaves the locale out when asked to or when the field is not localized', () => {
    expect(locationParts(occurrence(), 'en', false).locale).toBeUndefined();
    expect(
      locationParts(occurrence({ locale: undefined }), 'en', true).locale,
    ).toBeUndefined();
  });
});

describe('placeName', () => {
  it('reads a place in the order it is shown: field, locale, then its path', () => {
    expect(
      placeName(
        occurrence({ blockPath: ['Body', 'Hero 1'], fieldLabel: 'Link' }),
        'en',
        true,
      ),
    ).toBe('Link, English, in Body > Hero 1');
    expect(placeName(occurrence(), 'en', false)).toBe('Body');
    expect(placeName(occurrence({ locale: undefined }), 'en', true)).toBe(
      'Body',
    );
  });
});

describe('localeName', () => {
  it('names a locale in the interface language', () => {
    expect(localeName('it', 'en')).toBe('Italian');
    expect(localeName('en', 'it')).toBe('inglese');
  });

  it('falls back to the code', () => {
    expect(localeName('not a locale!', 'en')).toBe('not a locale!');
  });
});

describe('countLabel', () => {
  it('uses whole-string branches and a localized count', () => {
    expect(countLabel(1, '1 record', '{n} records', 'en')).toBe('1 record');
    expect(countLabel(0, '1 record', '{n} records', 'en')).toBe('0 records');
    expect(countLabel(1204, '1 record', '{n} records', 'en')).toBe(
      '1,204 records',
    );
    expect(countLabel(1204, '1 record', '{n} records', 'it')).toBe(
      '1204 records',
    );
  });
});

describe('lists', () => {
  it('joins names without an Oxford comma', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['English'])).toBe('English');
    expect(joinNames(['English', 'Italian'])).toBe('English and Italian');
    expect(joinNames(['English', 'Italian', 'German'])).toBe(
      'English, Italian and German',
    );
  });

  it('joins facts and skips empty ones', () => {
    expect(joinFacts(['HTTP 404', null, '9 records'])).toBe(
      `HTTP 404${FACT_SEPARATOR}9 records`,
    );
  });
});

describe('formatWarning', () => {
  // formRecord.ts appends this to every path it couldn't read.
  const unread = (path: string) =>
    `${path}: Current content could not be fully read; some links could not be checked.`;

  it('keeps only the path of an unread form field, with " > " and locale names', () => {
    expect(formatWarning(unread('Body (en)'), 'en')).toBe('Body (English)');
    expect(formatWarning(unread('content › Card › url (it)'), 'en')).toBe(
      'content > Card > url (Italian)',
    );
    expect(
      formatWarning(unread('Sections (en) 2 › Hero › Button URL'), 'en'),
    ).toBe('Sections (English) 2 > Hero > Button URL');
    expect(formatWarning(unread('Summary'), 'en')).toBe('Summary');
    expect(formatWarning(unread('Body (pt-BR)'), 'it')).toBe(
      'Body (portoghese brasiliano)',
    );
  });

  it('leaves a code alone when it names no known language', () => {
    expect(formatWarning(unread('Body (xx)'), 'en')).toBe('Body (xx)');
    expect(formatWarning(unread('Link (new)'), 'en')).toBe('Link (new)');
  });

  it('rewords the still-loading message for the panel\'s "Check again"', () => {
    expect(
      formatWarning(
        'Content is still loading; some links could not be checked. Wait for the record to load and scan again.',
        'en',
      ),
    ).toBe('The record is still loading. Wait for it to load and check again.');
  });

  it('joins extraction paths with " > " and shows a repeated container once', () => {
    expect(
      formatWarning(
        'Sections › Sections › Hero 3 › Inner: Modular content is not loaded; some links could not be checked.',
        'en',
      ),
    ).toBe(
      'Sections > Hero 3 > Inner: Modular content is not loaded; some links could not be checked.',
    );
    expect(
      formatWarning(
        'Body › Body: Structured Text content is not available in its saved format.',
        'en',
      ),
    ).toBe(
      'Body: Structured Text content is not available in its saved format.',
    );
  });

  it('keeps messages without a path unchanged', () => {
    for (const warning of [
      'URL: Localized content is unavailable; some links could not be checked.',
      'Example page: The record model is unavailable; its links could not be checked.',
      'The record model is unavailable.',
      'News: Model schema could not be loaded.',
    ])
      expect(formatWarning(warning, 'en')).toBe(warning);
  });
});

describe('groupWarnings', () => {
  it('says each reason once, after the places that give it', () => {
    expect(
      groupWarnings([
        "Article > Content: Some blocks couldn't be read.",
        "Event: Your role can't see these records.",
        "Job posting: Your role can't see these records.",
        "Landing page > Sections: Some blocks couldn't be read.",
        'Body (English) > Hero',
        "Press release: Your role can't see these records.",
      ]),
    ).toEqual([
      "Article > Content, Landing page > Sections: Some blocks couldn't be read.",
      "Event, Job posting, Press release: Your role can't see these records.",
      'Body (English) > Hero',
    ]);
  });

  it('names at most 10 places in a line', () => {
    const lines = Array.from(
      { length: 12 },
      (_, index) => `Model ${index}: Access was refused.`,
    );
    expect(groupWarnings(lines)).toEqual([
      `${lines
        .slice(0, 10)
        .map((_, index) => `Model ${index}`)
        .join(', ')}: Access was refused.`,
      'Model 10, Model 11: Access was refused.',
    ]);
  });
});

describe('preciseWarnings', () => {
  it("drops a model's line when one of its fields gives the same reason", () => {
    expect(
      preciseWarnings([
        "Article: Some blocks couldn't be read.",
        "Article › Content: Some blocks couldn't be read.",
        "Landing page: Some blocks couldn't be read.",
        'Author: Access was refused.',
        "Author › Bio: Part of this text couldn't be read.",
      ]),
    ).toEqual([
      "Article › Content: Some blocks couldn't be read.",
      "Landing page: Some blocks couldn't be read.",
      'Author: Access was refused.',
      "Author › Bio: Part of this text couldn't be read.",
    ]);
  });
});
