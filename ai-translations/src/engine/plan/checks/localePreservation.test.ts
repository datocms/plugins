import { describe, expect, it } from 'vitest';
import { checkLocalePreservation } from './localePreservation';

describe('checkLocalePreservation', () => {
  it('passes when every preserved locale is still present', () => {
    expect(
      checkLocalePreservation({
        outgoing: { en: 'Hi', it: 'Ciao', de: 'Hallo' },
        preservedLocales: ['en', 'it'],
      }),
    ).toBeNull();
  });

  it('flags a dropped locale as an error', () => {
    const flag = checkLocalePreservation({
      outgoing: { it: 'Ciao' },
      preservedLocales: ['en', 'it'],
      fieldPath: 'title',
      locale: 'it',
    });
    expect(flag?.checkId).toBe('locale-preservation');
    expect(flag?.severity).toBe('error');
    expect(flag?.message).toContain('en');
  });

  it('matches locale keys case-insensitively', () => {
    expect(
      checkLocalePreservation({
        outgoing: { EN: 'Hi', 'pt-BR': 'Olá' },
        preservedLocales: ['en', 'pt-br'],
      }),
    ).toBeNull();
  });

  it('flags when the outgoing value is not a locale object but locales were expected', () => {
    const flag = checkLocalePreservation({ outgoing: 'oops', preservedLocales: ['en'] });
    expect(flag?.severity).toBe('error');
  });

  it('passes when there is nothing to preserve', () => {
    expect(checkLocalePreservation({ outgoing: null, preservedLocales: [] })).toBeNull();
  });
});
