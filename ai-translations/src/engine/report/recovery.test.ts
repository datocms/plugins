import { describe, expect, it } from 'vitest';
import { isPolicyCompatible, pickLatestRunState, unitsToResume } from './recovery';
import { createRunState, foldOutcome, type RunContext, type RunState } from './runState';
import type { UnitOutcome } from '../plan/types';

const ctx: RunContext = {
  runId: 'run-1',
  deviceId: 'dev-A',
  startedAt: 0,
  operation: 'translate',
  policyDigest: 'digest-1',
  fromLocale: 'en',
  toLocales: ['it'],
};

const withCheckpoint = (over: Partial<RunState>): RunState => ({ ...createRunState(ctx), ...over });

describe('pickLatestRunState', () => {
  it('returns null for no candidates', () => {
    expect(pickLatestRunState([])).toBeNull();
  });

  it('picks the highest checkpoint (ignoring wall-clock)', () => {
    const a = withCheckpoint({ checkpoint: 3 });
    const b = withCheckpoint({ checkpoint: 7 });
    expect(pickLatestRunState([a, b])).toBe(b);
  });

  it('breaks a checkpoint tie deterministically by deviceId', () => {
    const a = withCheckpoint({ checkpoint: 5, deviceId: 'dev-A' });
    const b = withCheckpoint({ checkpoint: 5, deviceId: 'dev-B' });
    expect(pickLatestRunState([a, b])).toBe(b);
    expect(pickLatestRunState([b, a])).toBe(b); // order-independent
  });
});

describe('unitsToResume', () => {
  it('re-runs every non-written bucket, skips written', () => {
    const outcome = (over: Partial<UnitOutcome>): UnitOutcome => ({
      recordId: 'r1', toLocale: 'it', bucket: 'written', reasons: [], flags: [], ...over,
    });
    let state = createRunState(ctx);
    state = foldOutcome(state, outcome({ toLocale: 'it', bucket: 'written' }), { now: 1 });
    state = foldOutcome(state, outcome({ toLocale: 'de', bucket: 'blocked' }), { now: 1 });
    state = foldOutcome(state, outcome({ toLocale: 'fr', bucket: 'not-attempted' }), { now: 1 });
    state = foldOutcome(state, outcome({ toLocale: 'es', bucket: 'written-unverified' }), { now: 1 });

    const targets = unitsToResume(state).map((t) => t.toLocale).sort();
    expect(targets).toEqual(['de', 'es', 'fr']); // it (written) skipped
  });
});

describe('isPolicyCompatible', () => {
  it('is true only when the digest matches the live policy', () => {
    const state = createRunState(ctx);
    expect(isPolicyCompatible(state, 'digest-1')).toBe(true);
    expect(isPolicyCompatible(state, 'digest-2')).toBe(false);
  });
});
