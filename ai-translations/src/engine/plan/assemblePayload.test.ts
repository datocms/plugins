import { describe, expect, it } from 'vitest';
import { assembleRecordPayload } from './assemblePayload';
import type { PlanRecord } from './buildPlanTypes';

const record: PlanRecord = {
  id: '1',
  itemTypeId: 'article',
  title: { en: 'Hi' },
  body: { en: 'Hello world' },
};

describe('assembleRecordPayload', () => {
  it('spreads existing locales and overlays the written locale', () => {
    const payload = assembleRecordPayload(record, [
      { toLocale: 'it', fields: { title: 'Ciao' } },
    ]);
    // en preserved (replace-not-merge safety), it added
    expect(payload.title).toEqual({ en: 'Hi', it: 'Ciao' });
  });

  it('merges multiple written locales for the same field into one object', () => {
    const payload = assembleRecordPayload(record, [
      { toLocale: 'it', fields: { title: 'Ciao' } },
      { toLocale: 'de', fields: { title: 'Hallo' } },
    ]);
    expect(payload.title).toEqual({ en: 'Hi', it: 'Ciao', de: 'Hallo' });
  });

  it('assembles multiple fields across locales', () => {
    const payload = assembleRecordPayload(record, [
      { toLocale: 'it', fields: { title: 'Ciao', body: 'Ciao mondo' } },
    ]);
    expect(payload.title).toEqual({ en: 'Hi', it: 'Ciao' });
    expect(payload.body).toEqual({ en: 'Hello world', it: 'Ciao mondo' });
  });

  it('omits fields/locales not present in the written list (Blocked stay out)', () => {
    const payload = assembleRecordPayload(record, [
      { toLocale: 'it', fields: { title: 'Ciao' } },
    ]);
    // body was not written for 'it' → not added; title has no 'de' (blocked/absent)
    expect(payload.body).toBeUndefined();
    expect(payload.title.de).toBeUndefined();
  });

  it('starts from an empty object when the field had no prior value', () => {
    const bare: PlanRecord = { id: '2', itemTypeId: 'article' };
    const payload = assembleRecordPayload(bare, [
      { toLocale: 'it', fields: { title: 'Ciao' } },
    ]);
    expect(payload.title).toEqual({ it: 'Ciao' });
  });
});
