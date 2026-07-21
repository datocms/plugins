import { describe, expect, it } from 'vitest';
import { decideResume } from './resumeDecision';
import { createRunState, foldOutcome, type RunContext } from './runState';

const ctx: RunContext = {
  runId: 'run-1',
  deviceId: 'device-1',
  startedAt: 1,
  operation: 'translate',
  policyDigest: 'digest-1',
  fromLocale: 'en',
  toLocales: ['it', 'de'],
};

const outcome = (over: Record<string, unknown>) => ({
  recordId: 'r1',
  toLocale: 'it',
  bucket: 'written' as const,
  reasons: [],
  flags: [],
  ...over,
});

describe('decideResume', () => {
  it('is none when there is no prior run', () => {
    expect(decideResume(null, 'digest-1')).toEqual({ kind: 'none' });
  });

  it('is none when the prior run has nothing left to resume', () => {
    let state = createRunState(ctx);
    state = foldOutcome(state, outcome({ toLocale: 'it', bucket: 'written' }), {
      now: 1,
    });
    expect(decideResume(state, 'digest-1')).toEqual({ kind: 'none' });
  });

  it('is none when the policy digest is incompatible (config changed mid-run)', () => {
    let state = createRunState(ctx);
    state = foldOutcome(state, outcome({ toLocale: 'de', bucket: 'blocked' }), {
      now: 1,
    });
    expect(decideResume(state, 'A-DIFFERENT-DIGEST')).toEqual({ kind: 'none' });
  });

  it('is resumable with the unfinished units when a compatible prior exists', () => {
    let state = createRunState(ctx);
    state = foldOutcome(state, outcome({ toLocale: 'it', bucket: 'written' }), {
      now: 1,
    });
    state = foldOutcome(state, outcome({ toLocale: 'de', bucket: 'blocked' }), {
      now: 1,
    });

    const decision = decideResume(state, 'digest-1');
    expect(decision.kind).toBe('resumable');
    if (decision.kind === 'resumable') {
      expect(decision.priorState).toBe(state);
      expect(decision.targets).toEqual([{ recordId: 'r1', toLocale: 'de' }]);
    }
  });
});
