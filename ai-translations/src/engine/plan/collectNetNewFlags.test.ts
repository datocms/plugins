import { describe, expect, it } from 'vitest';
import { checkNetNewCell, collectNetNewFlags, SEAM_NET_NEW_CHECK_IDS } from './collectNetNewFlags';
import { unitKey } from './conform';
import type { CellPlan, TranslationPlan } from './types';

const cell = (over: Partial<CellPlan> = {}): CellPlan => ({
  fieldPath: 'body',
  fieldType: 'rich_text',
  toLocale: 'it',
  fate: 'translate',
  cannotBeBlank: false,
  expected: { preservedLocales: [] },
  ...over,
});
const block = (id?: string) => ({ type: 'item', ...(id ? { id } : {}), attributes: {}, relationships: {} });

describe('checkNetNewCell', () => {
  it('runs ONLY block-structure and block-id-provenance', () => {
    const flags = checkNetNewCell({
      cell: cell({ expected: { preservedLocales: [], blockSignature: { count: 2, children: [] } } }),
      translatedValue: [block()],
      sourceValue: [block('s1')],
    });
    expect(flags.map((f) => f.checkId).sort()).toEqual(['block-structure']);
  });
  it('flags a leaked source id', () => {
    const flags = checkNetNewCell({ cell: cell(), translatedValue: [block('s1')], sourceValue: [block('s1')] });
    expect(flags.map((f) => f.checkId)).toContain('block-id-provenance');
  });
  it('never emits an engine-owned checkId', () => {
    const flags = checkNetNewCell({ cell: cell(), translatedValue: '', sourceValue: '' });
    expect(flags.some((f) => ['truncated', 'length-validator', 'cannot-be-blank'].includes(f.checkId))).toBe(false);
  });
});

describe('collectNetNewFlags', () => {
  const plan: TranslationPlan = {
    policyDigest: 'x',
    records: [
      {
        recordId: 'r1',
        itemTypeId: 'a',
        fromLocale: 'en',
        sourceVersion: 'v',
        allLocalesRequired: false,
        units: [
          {
            toLocale: 'it',
            isNewLocale: false,
            cells: [cell({ expected: { preservedLocales: [], blockSignature: { count: 1, children: [] } } })],
          },
        ],
      },
    ],
  };
  it('groups net-new flags under the unit key', () => {
    const flags = collectNetNewFlags(plan, () => ({ translatedValue: [], sourceValue: [block('s')] }));
    expect(flags.get(unitKey('r1', 'it'))?.map((f) => f.checkId)).toContain('block-structure');
  });
});

describe('ownership partition', () => {
  it('is disjoint from the engine-owned check ids', () => {
    const engineOwned = ['truncated', 'length-validator', 'placeholder-loss', 'html-structure', 'markdown-structure', 'copied-from-source'];
    expect(SEAM_NET_NEW_CHECK_IDS.some((id) => engineOwned.includes(id))).toBe(false);
  });
});
