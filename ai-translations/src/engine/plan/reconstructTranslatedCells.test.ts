import { describe, expect, it } from 'vitest';
import { reconstructTranslatedCells } from './reconstructTranslatedCells';

const base = {
  payload: { title: { en: 'Hi', it: 'Ciao' }, brand: { en: 'Acme', it: 'Acme' } },
  translatedFields: ['title'], // brand was copied, not translated
  record: { title: { en: 'Hi' }, brand: { en: 'Acme' } },
  fromLocale: 'en',
  toLocale: 'it',
};

describe('reconstructTranslatedCells', () => {
  it('returns a cell only for genuinely-translated fields in the target locale', () => {
    const at = reconstructTranslatedCells(base);
    expect(at('r1', 'title', 'it')).toEqual({ translatedValue: 'Ciao', sourceValue: 'Hi' });
  });
  it('returns undefined for a copied/fallback field (not in translatedFields)', () => {
    expect(reconstructTranslatedCells(base)('r1', 'brand', 'it')).toBeUndefined();
  });
  it('returns undefined for a non-target locale', () => {
    expect(reconstructTranslatedCells(base)('r1', 'title', 'de')).toBeUndefined();
  });
});
