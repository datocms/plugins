import { describe, expect, it } from 'vitest';
import { existingLocalesOf } from './existingLocales';
import type { PlanField, PlanRecord } from './buildPlanTypes';

const field = (apiKey: string, isLocalized: boolean): PlanField => ({
  id: apiKey,
  apiKey,
  fieldType: 'string',
  isLocalized,
  validators: {},
});

describe('existingLocalesOf', () => {
  it('unions locale keys across localized fields, lowercased', () => {
    const record: PlanRecord = {
      id: '1',
      itemTypeId: 'article',
      title: { en: 'Hi', it: 'Ciao' },
      slug: { en: 'hi' },
      views: 5,
    };
    const locales = existingLocalesOf(record, [
      field('title', true),
      field('slug', true),
      field('views', false),
    ]);
    expect([...locales].sort()).toEqual(['en', 'it']);
  });

  it('ignores non-localized field values', () => {
    const record: PlanRecord = { id: '1', itemTypeId: 'a', views: 5, title: { en: 'Hi' } };
    expect([...existingLocalesOf(record, [field('views', false), field('title', true)])]).toEqual(['en']);
  });

  it('returns empty when no localized field carries data', () => {
    expect(existingLocalesOf({ id: '1', itemTypeId: 'a' }, [field('title', true)]).size).toBe(0);
  });
});
