import { describe, expect, it } from 'vitest';
import { checkLocaleCompleteness } from './localeCompleteness';
import type { RecordPlan } from '../types';

const recordPlan = (isNewLocale: boolean): RecordPlan => ({
  recordId: 'r1',
  itemTypeId: 'a',
  fromLocale: 'en',
  sourceVersion: 'v',
  allLocalesRequired: false,
  units: [
    {
      toLocale: 'de',
      isNewLocale,
      cells: [
        { fieldPath: 'title', fieldType: 'string', toLocale: 'de', fate: 'translate', cannotBeBlank: false, expected: { preservedLocales: [] } },
        { fieldPath: 'body', fieldType: 'string', toLocale: 'de', fate: 'copy', cannotBeBlank: false, expected: { preservedLocales: [] } },
      ],
    },
  ],
});

describe('checkLocaleCompleteness', () => {
  it('passes when a new locale carries every field', () => {
    const body = { title: { en: 'x', de: 'y' }, body: { en: 'x', de: 'y' } };
    expect(checkLocaleCompleteness({ body, recordPlan: recordPlan(true) })).toEqual([]);
  });
  it('flags a new-locale field missing from the body (would 422 VALIDATION_INVALID_LOCALES)', () => {
    const body = { title: { en: 'x', de: 'y' } }; // body field missing for de
    const flags = checkLocaleCompleteness({ body, recordPlan: recordPlan(true) });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ checkId: 'locale-completeness', severity: 'error', fieldPath: 'body', locale: 'de' });
  });
  it('ignores existing locales (only new locales must be complete)', () => {
    expect(checkLocaleCompleteness({ body: { title: { en: 'x', de: 'y' } }, recordPlan: recordPlan(false) })).toEqual([]);
  });
});
