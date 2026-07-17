import { describe, expect, it } from 'vitest';
import { toPlanFields, toPlanInput, toPlanRecord, type ApiRecord } from './toPlanInput';
import { existingLocalesOf } from './existingLocales';
import type { FieldTypeDictionary } from '../../utils/translation/SharedFieldUtils';

const record: ApiRecord = {
  id: 'r1',
  item_type: { id: 'article' },
  meta: { current_version: 'v7' },
  title: { en: 'Hi', it: 'Ciao' },
  brand: { en: 'Acme' },
};

const dictionary: FieldTypeDictionary = {
  title: { editor: 'string', id: 'f-title', isLocalized: true, validators: { required: {} } as never },
  brand: { editor: 'string', id: 'f-brand', isLocalized: true },
};

describe('toPlanRecord', () => {
  it('maps id + item_type.id and passes field values through untouched', () => {
    const planRecord = toPlanRecord(record);
    expect(planRecord.id).toBe('r1');
    expect(planRecord.itemTypeId).toBe('article');
    expect(planRecord.meta?.current_version).toBe('v7');
    expect(planRecord.title).toEqual({ en: 'Hi', it: 'Ciao' });
    expect('item_type' in planRecord).toBe(false);
  });

  it('preserves the record locale keys (preservedLocales will be correct)', () => {
    const planRecord = toPlanRecord(record);
    const fields = toPlanFields(dictionary);
    expect([...existingLocalesOf(planRecord, fields)].sort()).toEqual(['en', 'it']);
  });
});

describe('toPlanFields', () => {
  it('maps dictionary entries to PlanField (editor→fieldType, defaults validators)', () => {
    const fields = toPlanFields(dictionary);
    expect(fields).toContainEqual({ id: 'f-title', apiKey: 'title', fieldType: 'string', isLocalized: true, validators: { required: {} } });
    expect(fields.find((f) => f.apiKey === 'brand')?.validators).toEqual({});
  });
});

describe('toPlanInput', () => {
  it('assembles a single-record BuildPlanInput keyed by item type', () => {
    const input = toPlanInput({
      record,
      dictionary,
      allLocalesRequired: true,
      policy: { excludedTokens: ['brand'], copyTokens: [] },
      policyDigest: 'digest-1',
      fromLocale: 'en',
      toLocales: ['it', 'de'],
    });
    expect(input.records).toHaveLength(1);
    expect(input.fieldsByItemType.get('article')).toHaveLength(2);
    expect(input.allLocalesRequiredByItemType.get('article')).toBe(true);
    expect(input.policyDigest).toBe('digest-1');
    expect(input.toLocales).toEqual(['it', 'de']);
  });
});
