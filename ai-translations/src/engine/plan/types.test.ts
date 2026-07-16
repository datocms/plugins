import { describe, expect, it } from 'vitest';
import { tierOf } from './types';
import type { CellPlan, RecordPlan, TranslationPlan, UnitOutcome } from './types';

describe('tierOf', () => {
  it('maps error → invariant', () => expect(tierOf('error')).toBe('invariant'));
  it('maps warning → heuristic', () => expect(tierOf('warning')).toBe('heuristic'));
  it('maps info → heuristic', () => expect(tierOf('info')).toBe('heuristic'));
});

describe('plan IR shape', () => {
  it('composes a well-formed plan value', () => {
    const cell: CellPlan = {
      fieldPath: 'title',
      fieldType: 'string',
      toLocale: 'it',
      fate: 'translate',
      cannotBeBlank: true,
      expected: { preservedLocales: ['en'] },
    };
    const record: RecordPlan = {
      recordId: '1',
      itemTypeId: 'article',
      fromLocale: 'en',
      sourceVersion: 'v1',
      allLocalesRequired: false,
      units: [{ toLocale: 'it', isNewLocale: false, cells: [cell] }],
    };
    const plan: TranslationPlan = { records: [record], policyDigest: 'abc' };
    expect(plan.records[0].units[0].cells[0].fate).toBe('translate');
    const outcome: UnitOutcome = {
      recordId: '1', toLocale: 'it', bucket: 'written', reasons: [], flags: [],
    };
    expect(outcome.bucket).toBe('written');
  });
});
