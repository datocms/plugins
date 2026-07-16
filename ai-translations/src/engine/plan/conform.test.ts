import { describe, expect, it } from 'vitest';
import { conform, unitKey } from './conform';
import type { TranslationPlan } from './types';
import type { QcFlag } from '../../utils/translation/qc/types';

const plan: TranslationPlan = {
  policyDigest: 'x',
  records: [{
    recordId: 'r1', itemTypeId: 'article', fromLocale: 'en', sourceVersion: 'v1',
    allLocalesRequired: false,
    units: [
      { toLocale: 'it', isNewLocale: false, cells: [] },
      { toLocale: 'zh', isNewLocale: false, cells: [] },
    ],
  }],
};

const err = (checkId: QcFlag['checkId'], fieldPath: string): QcFlag =>
  ({ checkId, severity: 'error', fieldPath, message: 'boom' });
const warn = (checkId: QcFlag['checkId'], fieldPath: string): QcFlag =>
  ({ checkId, severity: 'warning', fieldPath, message: 'hmm' });

describe('conform', () => {
  it('writes a clean unit', () => {
    const out = conform(plan, new Map());
    const it = out.find((u) => u.toLocale === 'it');
    expect(it?.bucket).toBe('written');
    expect(it?.reasons).toEqual([]);
  });
  it('blocks a unit with any invariant (error) flag and records its reason code', () => {
    const flags = new Map([[unitKey('r1', 'zh'), [err('placeholder-loss', 'body')]]]);
    const out = conform(plan, flags);
    const zh = out.find((u) => u.toLocale === 'zh');
    expect(zh?.bucket).toBe('blocked');
    expect(zh?.reasons).toEqual([{ fieldPath: 'body', code: 'placeholder-lost', message: 'boom' }]);
  });
  it('writes a unit that has only heuristic (warning) flags, attaching them', () => {
    const flags = new Map([[unitKey('r1', 'it'), [warn('length-ratio', 'body')]]]);
    const out = conform(plan, flags);
    const it = out.find((u) => u.toLocale === 'it');
    expect(it?.bucket).toBe('written');
    expect(it?.flags).toEqual([{ checkId: 'length-ratio', message: 'hmm' }]);
  });
  it('blocks a mixed unit (one error + one warning) and keeps only the error as a reason', () => {
    const flags = new Map([[unitKey('r1', 'zh'), [warn('no-op', 'title'), err('truncated', 'body')]]]);
    const out = conform(plan, flags);
    const zh = out.find((u) => u.toLocale === 'zh');
    expect(zh?.bucket).toBe('blocked');
    expect(zh?.reasons.map((r) => r.code)).toEqual(['truncated']);
  });
});
