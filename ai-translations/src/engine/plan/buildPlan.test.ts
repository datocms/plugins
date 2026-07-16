import { describe, expect, it } from 'vitest';
import { buildPlan } from './buildPlan';
import type { BuildPlanInput, PlanField, PlanRecord } from './buildPlanTypes';

const field = (apiKey: string, isLocalized = true): PlanField => ({
  id: apiKey,
  apiKey,
  fieldType: 'string',
  isLocalized,
  validators: {},
});

const record: PlanRecord = {
  id: '1',
  itemTypeId: 'article',
  meta: { current_version: 'v7' },
  title: { en: 'Hi', it: 'Ciao' },
};

const input = (over: Partial<BuildPlanInput> = {}): BuildPlanInput => ({
  records: [record],
  fieldsByItemType: new Map([['article', [field('title')]]]),
  allLocalesRequiredByItemType: new Map([['article', false]]),
  policy: { excludedTokens: [], copyTokens: [] },
  fromLocale: 'en',
  toLocales: ['it', 'de'],
  policyDigest: 'digest-1',
  ...over,
});

describe('buildPlan', () => {
  it('builds one RecordPlan per record with one unit per target locale', () => {
    const plan = buildPlan(input());
    expect(plan.policyDigest).toBe('digest-1');
    expect(plan.records).toHaveLength(1);
    const rp = plan.records[0];
    expect(rp.recordId).toBe('1');
    expect(rp.sourceVersion).toBe('v7');
    expect(rp.allLocalesRequired).toBe(false);
    expect(rp.units.map((u) => u.toLocale)).toEqual(['it', 'de']);
    // 'de' is a new locale → completeness makes it a unit with the title cell
    expect(rp.units.find((u) => u.toLocale === 'de')?.isNewLocale).toBe(true);
  });

  it('defaults sourceVersion to empty string when meta is absent', () => {
    const plan = buildPlan(input({ records: [{ id: '2', itemTypeId: 'article', title: { en: 'x' } }] }));
    expect(plan.records[0].sourceVersion).toBe('');
  });

  it('yields empty-cell units for an unknown item type without throwing', () => {
    const plan = buildPlan(input({ records: [{ id: '3', itemTypeId: 'ghost', title: { en: 'x' } }] }));
    expect(plan.records[0].units.every((u) => u.cells.length === 0)).toBe(true);
  });

  it('honors all_locales_required per item type', () => {
    const plan = buildPlan(
      input({ allLocalesRequiredByItemType: new Map([['article', true]]) }),
    );
    expect(plan.records[0].allLocalesRequired).toBe(true);
  });
});
