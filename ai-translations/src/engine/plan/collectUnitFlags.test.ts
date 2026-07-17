import { describe, expect, it } from 'vitest';
import { collectUnitFlags, type ReconstructedCell } from './collectUnitFlags';
import { unitKey } from './conform';
import type { CellPlan, TranslationPlan } from './types';

const cell = (fieldPath: string, over: Partial<CellPlan> = {}): CellPlan => ({
  fieldPath,
  fieldType: 'string',
  toLocale: 'it',
  fate: 'translate',
  cannotBeBlank: false,
  expected: { preservedLocales: [] },
  ...over,
});

const plan: TranslationPlan = {
  policyDigest: 'x',
  records: [
    {
      recordId: 'r1',
      itemTypeId: 'article',
      fromLocale: 'en',
      sourceVersion: 'v1',
      allLocalesRequired: false,
      units: [
        { toLocale: 'it', isNewLocale: false, cells: [cell('title', { cannotBeBlank: true }), cell('body')] },
        { toLocale: 'de', isNewLocale: false, cells: [cell('title', { toLocale: 'de' })] },
      ],
    },
  ],
};

describe('collectUnitFlags', () => {
  it('groups per-cell flags under the correct unit key', () => {
    // title:it is blank on a cannot-be-blank cell → one flag; everything else clean
    const results = new Map<string, ReconstructedCell>([
      ['r1|title|it', { translatedValue: '' }],
      ['r1|body|it', { translatedValue: 'Ciao mondo' }],
      ['r1|title|de', { translatedValue: 'Hallo' }],
    ]);
    const flags = collectUnitFlags(plan, (r, f, l) => results.get(`${r}|${f}|${l}`));
    expect(flags.get(unitKey('r1', 'it'))?.map((x) => x.checkId)).toEqual(['cannot-be-blank']);
    expect(flags.has(unitKey('r1', 'de'))).toBe(false); // clean unit → no entry
  });

  it('skips cells with no reconstructed result', () => {
    const flags = collectUnitFlags(plan, () => undefined);
    expect(flags.size).toBe(0);
  });

  it('accumulates flags from multiple cells in one unit', () => {
    const results = new Map<string, ReconstructedCell>([
      ['r1|title|it', { translatedValue: '', finishReason: 'length' }], // blank + truncated
      ['r1|body|it', { translatedValue: '', finishReason: 'length' }], // truncated (not cannot-be-blank)
    ]);
    const flags = collectUnitFlags(plan, (r, f, l) => results.get(`${r}|${f}|${l}`));
    const ids = flags.get(unitKey('r1', 'it'))?.map((x) => x.checkId).sort();
    expect(ids).toEqual(['cannot-be-blank', 'truncated', 'truncated']);
  });
});
