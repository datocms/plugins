import { describe, expect, it } from 'vitest';
import { checkAssembledBody } from './checkAssembledBody';
import type { RecordPlan } from './types';

const plan = (over: Partial<RecordPlan> = {}): RecordPlan => ({
  recordId: 'r1',
  itemTypeId: 'a',
  fromLocale: 'en',
  sourceVersion: 'v',
  allLocalesRequired: false,
  units: [
    {
      toLocale: 'it',
      isNewLocale: false,
      cells: [{ fieldPath: 'title', fieldType: 'string', toLocale: 'it', fate: 'translate', cannotBeBlank: true, expected: { preservedLocales: ['en', 'it'] } }],
    },
    {
      toLocale: 'de',
      isNewLocale: false,
      cells: [{ fieldPath: 'title', fieldType: 'string', toLocale: 'de', fate: 'translate', cannotBeBlank: true, expected: { preservedLocales: ['en', 'de'] } }],
    },
  ],
  ...over,
});

describe('checkAssembledBody', () => {
  it('passes a clean body', () => {
    const body = { title: { en: 'Hi', it: 'Ciao', de: 'Hallo' } };
    expect(checkAssembledBody({ body, recordPlan: plan() })).toEqual([]);
  });
  it('blocks EVERY target locale when a field would drop an existing locale', () => {
    const body = { title: { it: 'Ciao', de: 'Hallo' } }; // en dropped!
    const flags = checkAssembledBody({ body, recordPlan: plan() });
    const preservation = flags.filter((f) => f.checkId === 'locale-preservation');
    expect(preservation.map((f) => f.locale).sort()).toEqual(['de', 'it']);
  });
  it('flags a blank required field per locale', () => {
    const body = { title: { en: 'Hi', it: '', de: 'Hallo' } };
    const flags = checkAssembledBody({ body, recordPlan: plan() });
    expect(flags.some((f) => f.checkId === 'cannot-be-blank' && f.locale === 'it')).toBe(true);
    expect(flags.some((f) => f.checkId === 'cannot-be-blank' && f.locale === 'de')).toBe(false);
  });
});
