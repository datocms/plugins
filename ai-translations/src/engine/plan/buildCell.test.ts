import { describe, expect, it } from 'vitest';
import { buildCell } from './buildCell';
import type { PlanField, PlanPolicy, PlanRecord } from './buildPlanTypes';

const policy: PlanPolicy = { excludedTokens: [], copyTokens: [] };
const strField = (over: Partial<PlanField> = {}): PlanField => ({
  id: 'title',
  apiKey: 'title',
  fieldType: 'string',
  isLocalized: true,
  validators: {},
  ...over,
});
const record: PlanRecord = {
  id: '1',
  itemTypeId: 'article',
  title: { en: 'Hi', it: 'Ciao' },
};

const base = {
  record,
  toLocale: 'it',
  fromLocale: 'en',
  policy,
  allLocalesRequired: false,
};

describe('buildCell', () => {
  it('translates by default and records preserved locales + length bounds', () => {
    const cell = buildCell({
      ...base,
      field: strField({ validators: { length: { max: 100 } } as never }),
    });
    expect(cell.fate).toBe('translate');
    expect(cell.fieldPath).toBe('title');
    expect(cell.toLocale).toBe('it');
    expect(cell.expected.lengthBounds).toEqual({ max: 100 });
    expect(cell.expected.preservedLocales.sort()).toEqual(['en', 'it']);
  });

  it('marks a required field cannotBeBlank', () => {
    const cell = buildCell({
      ...base,
      field: strField({ validators: { required: {} } as never }),
    });
    expect(cell.cannotBeBlank).toBe(true);
  });

  it('leaves an optional field able to be blank', () => {
    const cell = buildCell({ ...base, field: strField() });
    expect(cell.cannotBeBlank).toBe(false);
  });

  it('all_locales_required flips exclude→copy and forces cannotBeBlank', () => {
    const cell = buildCell({
      ...base,
      field: strField(),
      policy: { excludedTokens: ['title'], copyTokens: [] },
      allLocalesRequired: true,
    });
    expect(cell.fate).toBe('copy');
    expect(cell.cannotBeBlank).toBe(true);
  });

  it('computes a block signature for block-bearing source content', () => {
    const block = (id: string) => ({ type: 'item', id, attributes: {}, relationships: {} });
    const blockRecord: PlanRecord = {
      id: '2',
      itemTypeId: 'article',
      body: { en: [block('a'), block('b')], it: [] },
    };
    const cell = buildCell({
      ...base,
      record: blockRecord,
      field: strField({ id: 'body', apiKey: 'body', fieldType: 'rich_text' }),
    });
    expect(cell.expected.blockSignature).toEqual({ count: 2, children: [] });
  });

  it('omits blockSignature and lengthBounds for a plain string field', () => {
    const cell = buildCell({ ...base, field: strField() });
    expect(cell.expected.blockSignature).toBeUndefined();
    expect(cell.expected.lengthBounds).toBeUndefined();
  });
});
