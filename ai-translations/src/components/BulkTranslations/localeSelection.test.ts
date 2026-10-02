import { describe, expect, it } from 'vitest';
import type { ChipOption } from './chipOption';
import {
  ALL_LOCALES_OPTION,
  nextTargetSelection,
  targetsForNewSource,
} from './localeSelection';

const en: ChipOption = { label: 'English', value: 'en', code: 'en' };
const it_: ChipOption = { label: 'Italian', value: 'it', code: 'it' };
const de: ChipOption = { label: 'German', value: 'de', code: 'de' };

describe('ALL_LOCALES_OPTION', () => {
  it('is the "All other locales" sentinel without a code', () => {
    expect(ALL_LOCALES_OPTION).toEqual({
      label: 'All other locales',
      value: '__all__',
    });
  });
});

describe('nextTargetSelection', () => {
  it('collapses to "All" when "All" is added to specific picks', () => {
    expect(
      nextTargetSelection([it_, de], [it_, de, ALL_LOCALES_OPTION]),
    ).toEqual([ALL_LOCALES_OPTION]);
  });

  it('drops "All" when a specific locale is added while "All" is selected', () => {
    expect(
      nextTargetSelection([ALL_LOCALES_OPTION], [ALL_LOCALES_OPTION, it_]),
    ).toEqual([it_]);
  });

  it('takes any other change as is', () => {
    expect(nextTargetSelection([it_], [it_, de])).toEqual([it_, de]);
    expect(nextTargetSelection([it_, de], [de])).toEqual([de]);
    expect(nextTargetSelection([ALL_LOCALES_OPTION], [])).toEqual([]);
    expect(
      nextTargetSelection([ALL_LOCALES_OPTION], [ALL_LOCALES_OPTION]),
    ).toEqual([ALL_LOCALES_OPTION]);
    expect(nextTargetSelection([], [ALL_LOCALES_OPTION])).toEqual([
      ALL_LOCALES_OPTION,
    ]);
  });
});

describe('targetsForNewSource', () => {
  it('removes the new source from the specific picks', () => {
    expect(targetsForNewSource([it_, de], 'it')).toEqual([de]);
  });

  it('falls back to "All" when that empties the selection', () => {
    expect(targetsForNewSource([it_], 'it')).toEqual([ALL_LOCALES_OPTION]);
  });

  it('keeps the selection untouched when the source was not picked', () => {
    const prev = [it_, de];
    expect(targetsForNewSource(prev, 'en')).toBe(prev);
    const all = [ALL_LOCALES_OPTION];
    expect(targetsForNewSource(all, 'en')).toBe(all);
  });

  it('keeps an empty selection empty', () => {
    expect(targetsForNewSource([], 'en')).toEqual([]);
  });

  it('does not treat "All" as the source', () => {
    expect(targetsForNewSource([en, ALL_LOCALES_OPTION], 'en')).toEqual([
      ALL_LOCALES_OPTION,
    ]);
  });
});
