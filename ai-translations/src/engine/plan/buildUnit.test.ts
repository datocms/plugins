import { describe, expect, it } from 'vitest';
import { buildRecordLocaleUnit } from './buildUnit';
import type { PlanField, PlanPolicy, PlanRecord } from './buildPlanTypes';

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
  title: { en: 'Hi', it: 'Ciao' },
  brand: { en: 'Acme' },
  views: 5,
};
const fields = [field('title'), field('brand'), field('views', false)];
// brand is admin-excluded.
const policy: PlanPolicy = { excludedTokens: ['brand'], copyTokens: [] };

const base = { record, fields, fromLocale: 'en', policy, allLocalesRequired: false };

describe('buildRecordLocaleUnit', () => {
  it('for an EXISTING locale, omits excluded fields and skips non-localized', () => {
    const unit = buildRecordLocaleUnit({
      ...base,
      toLocale: 'it',
      existingLocales: new Set(['en', 'it']),
    });
    expect(unit.isNewLocale).toBe(false);
    expect(unit.cells.map((c) => c.fieldPath)).toEqual(['title']);
  });

  it('for a NEW locale, includes EVERY localized field (completeness fill)', () => {
    const unit = buildRecordLocaleUnit({
      ...base,
      toLocale: 'de',
      existingLocales: new Set(['en', 'it']),
    });
    expect(unit.isNewLocale).toBe(true);
    expect(unit.cells.map((c) => c.fieldPath).sort()).toEqual(['brand', 'title']);
    // the excluded field still resolves to its fate, but is present for the fill
    expect(unit.cells.find((c) => c.fieldPath === 'brand')?.fate).toBe('exclude');
  });

  it('treats locale presence case-insensitively', () => {
    const unit = buildRecordLocaleUnit({
      ...base,
      toLocale: 'IT',
      existingLocales: new Set(['en', 'it']),
    });
    expect(unit.isNewLocale).toBe(false);
  });
});
