import { describe, expect, it } from 'vitest';
import { checkReconstructedCell } from './checkCell';
import type { CellPlan } from './types';

const cell = (over: Partial<CellPlan> = {}): CellPlan => ({
  fieldPath: 'title',
  fieldType: 'string',
  toLocale: 'it',
  fate: 'translate',
  cannotBeBlank: false,
  expected: { preservedLocales: ['en', 'it'] },
  ...over,
});

const idsOf = (flags: { checkId: string }[]) => flags.map((f) => f.checkId).sort();

describe('checkReconstructedCell', () => {
  it('returns no flags for a clean value', () => {
    expect(checkReconstructedCell({ cell: cell(), translatedValue: 'Ciao' })).toEqual([]);
  });

  it('flags a provider-signalled truncation', () => {
    const flags = checkReconstructedCell({
      cell: cell(),
      translatedValue: 'Ciao',
      finishReason: 'length',
    });
    expect(idsOf(flags)).toContain('truncated');
  });

  it('flags a blank value on a cannot-be-blank field', () => {
    const flags = checkReconstructedCell({
      cell: cell({ cannotBeBlank: true }),
      translatedValue: '   ',
    });
    expect(idsOf(flags)).toContain('cannot-be-blank');
  });

  it('flags an over-max length via the length bounds', () => {
    const flags = checkReconstructedCell({
      cell: cell({ expected: { preservedLocales: [], lengthBounds: { max: 3 } } }),
      translatedValue: 'toolong',
    });
    expect(idsOf(flags)).toContain('length-validator');
  });

  it('flags a dropped block against the expected signature', () => {
    const block = (id?: string) => ({ type: 'item', ...(id ? { id } : {}), attributes: {}, relationships: {} });
    const flags = checkReconstructedCell({
      cell: cell({ expected: { preservedLocales: [], blockSignature: { count: 2, children: [] } } }),
      translatedValue: [block()],
    });
    expect(idsOf(flags)).toContain('block-structure');
  });

  it('flags a leaked source block id', () => {
    const block = (id?: string) => ({ type: 'item', ...(id ? { id } : {}), attributes: {}, relationships: {} });
    const flags = checkReconstructedCell({
      cell: cell(),
      translatedValue: [block('src-1')],
      sourceValue: [block('src-1')],
    });
    expect(idsOf(flags)).toContain('block-id-provenance');
  });

  it('collects multiple invariant violations at once', () => {
    const flags = checkReconstructedCell({
      cell: cell({ cannotBeBlank: true }),
      translatedValue: '',
      finishReason: 'max_tokens',
    });
    expect(idsOf(flags)).toEqual(['cannot-be-blank', 'truncated']);
  });
});
