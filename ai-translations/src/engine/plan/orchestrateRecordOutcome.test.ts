import { describe, expect, it } from 'vitest';
import { orchestrateRecordOutcome, type EngineLocaleResult } from './orchestrateRecordOutcome';
import type { PlanRecord } from './buildPlanTypes';
import type { CellPlan, TranslationPlan } from './types';

const cell = (over: Partial<CellPlan> = {}): CellPlan => ({
  fieldPath: 'title',
  fieldType: 'string',
  toLocale: 'it',
  fate: 'translate',
  cannotBeBlank: false,
  expected: { preservedLocales: ['en', 'it'] },
  ...over,
});

const plan = (): TranslationPlan => ({
  policyDigest: 'x',
  records: [
    {
      recordId: 'r1',
      itemTypeId: 'a',
      fromLocale: 'en',
      sourceVersion: 'v',
      allLocalesRequired: false,
      units: [
        { toLocale: 'it', isNewLocale: false, cells: [cell({ toLocale: 'it', expected: { preservedLocales: ['en', 'it'] } })] },
        { toLocale: 'de', isNewLocale: false, cells: [cell({ toLocale: 'de', expected: { preservedLocales: ['en', 'de'] } })] },
      ],
    },
  ],
});

const record: PlanRecord = { id: 'r1', itemTypeId: 'a', title: { en: 'Hi', it: 'x', de: 'y' } };

describe('orchestrateRecordOutcome', () => {
  it('writes all locales when clean', () => {
    const localeResults = new Map<string, EngineLocaleResult>([
      ['it', { payload: { title: { en: 'Hi', it: 'Ciao' } }, qcFlags: [], translatedFields: ['title'] }],
      ['de', { payload: { title: { en: 'Hi', de: 'Hallo' } }, qcFlags: [], translatedFields: ['title'] }],
    ]);
    const { body, outcomes } = orchestrateRecordOutcome({ plan: plan(), record, fromLocale: 'en', localeResults });
    expect(outcomes.every((o) => o.bucket === 'written')).toBe(true);
    expect(body.title).toEqual({ en: 'Hi', it: 'Ciao', de: 'Hallo' });
  });

  it('blocks a locale with an engine error-tier qcFlag and omits it from the body', () => {
    const localeResults = new Map<string, EngineLocaleResult>([
      ['it', { payload: { title: { en: 'Hi', it: 'Ciao' } }, qcFlags: [], translatedFields: ['title'] }],
      ['de', { payload: { title: { en: 'Hi', de: 'Hallo' } }, qcFlags: [{ checkId: 'truncated', severity: 'error', fieldPath: 'title', locale: 'de', message: 'cut' }], translatedFields: ['title'] }],
    ]);
    const { body, outcomes } = orchestrateRecordOutcome({ plan: plan(), record, fromLocale: 'en', localeResults });
    expect(outcomes.find((o) => o.toLocale === 'de')?.bucket).toBe('blocked');
    expect(outcomes.find((o) => o.toLocale === 'it')?.bucket).toBe('written');
    // it gets its new translation; de is BLOCKED so its bad translation ('Hallo') is
    // NOT written — its existing value ('y') is preserved (never deleted).
    expect(body.title).toEqual({ en: 'Hi', it: 'Ciao', de: 'y' });
    expect(body.title.de).not.toBe('Hallo');
  });

  it('carries an engine warning flag onto a Written unit', () => {
    const localeResults = new Map<string, EngineLocaleResult>([
      ['it', { payload: { title: { en: 'Hi', it: 'Ciao' } }, qcFlags: [{ checkId: 'length-ratio', severity: 'warning', fieldPath: 'title', locale: 'it', message: 'short' }], translatedFields: ['title'] }],
      ['de', { payload: { title: { en: 'Hi', de: 'Hallo' } }, qcFlags: [], translatedFields: ['title'] }],
    ]);
    const { outcomes } = orchestrateRecordOutcome({ plan: plan(), record, fromLocale: 'en', localeResults });
    const it = outcomes.find((o) => o.toLocale === 'it');
    expect(it?.bucket).toBe('written');
    expect(it?.flags.map((f) => f.checkId)).toContain('length-ratio');
  });
});
