import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkOccurrence } from '../types';
import {
  countLabel,
  FACT_SEPARATOR,
  formatDateTime,
  formatWarning,
  inSentence,
  joinFacts,
  joinNames,
  localeName,
  locationParts,
  placeName,
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

afterEach(() => {
  vi.useRealTimers();
});

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

describe('dates', () => {
  it('formats today and other days, and lowercases "Today" inside a sentence', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 16, 0));
    const today = formatDateTime(
      new Date(2026, 8, 26, 14, 32).toISOString(),
      'en-GB',
    );
    expect(today).toBe('Today, 14:32');
    expect(inSentence(today)).toBe('today, 14:32');
    const earlier = formatDateTime(
      new Date(2026, 8, 20, 9, 5).toISOString(),
      'en-US',
    );
    // ICU puts a narrow no-break space before the day period.
    expect(earlier.replace(/\s/g, ' ')).toBe('09/20/2026, 09:05 AM');
    expect(inSentence(earlier)).toBe(earlier);
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
