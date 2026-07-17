import { describe, expect, it } from 'vitest';
import { machineTokenForUnit, runUnitFromMachineToken } from './machineToken';
import type { RunUnitState } from './runState';

const unit = (over: Partial<RunUnitState> = {}): RunUnitState => ({
  toLocale: 'it',
  bucket: 'blocked',
  reasons: [{ fieldPath: 'title', code: 'required-blank' }],
  flagCheckIds: [],
  updatedAt: 123,
  ...over,
});

describe('machineToken', () => {
  it('round-trips bucket, locale, reason codes, and record id', () => {
    const token = machineTokenForUnit('rec-9', unit());
    const { recordId, unit: back } = runUnitFromMachineToken(token);
    expect(recordId).toBe('rec-9');
    expect(back.toLocale).toBe('it');
    expect(back.bucket).toBe('blocked');
    expect(back.reasons.map((r) => r.code)).toEqual(['required-blank']);
  });

  it('drops fieldPath on the CSV projection (documented loss)', () => {
    const { unit: back } = runUnitFromMachineToken(machineTokenForUnit('r', unit()));
    expect(back.reasons[0].fieldPath).toBe('');
  });

  it('dedups repeated reason codes across fields', () => {
    const token = machineTokenForUnit(
      'r',
      unit({
        reasons: [
          { fieldPath: 'a', code: 'truncated' },
          { fieldPath: 'b', code: 'truncated' },
        ],
      }),
    );
    expect(runUnitFromMachineToken(token).unit.reasons).toHaveLength(1);
  });

  it('carries heuristic flags on a Written unit', () => {
    const token = machineTokenForUnit(
      'r',
      unit({ bucket: 'written', reasons: [], flagCheckIds: ['length-ratio', 'no-op'] }),
    );
    const { unit: back } = runUnitFromMachineToken(token);
    expect(new Set(back.flagCheckIds)).toEqual(new Set(['length-ratio', 'no-op']));
  });

  it('produces a token usable as a JSON mrc field (same encoder)', () => {
    const token = machineTokenForUnit('r', unit());
    expect(token).toMatch(/^v1:/);
  });
});
