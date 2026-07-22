import { describe, expect, it } from 'vitest';
import {
  bumpCheckpoint,
  createRunState,
  foldOutcome,
  foldOutcomes,
  type RunContext,
} from './runState';
import type { UnitOutcome } from '../plan/types';

const ctx: RunContext = {
  runId: 'run-1',
  deviceId: 'dev-1',
  startedAt: 1000,
  operation: 'translate',
  policyDigest: 'digest-1',
  fromLocale: 'en',
  toLocales: ['it', 'de'],
};

const outcome = (over: Partial<UnitOutcome> = {}): UnitOutcome => ({
  recordId: 'r1',
  toLocale: 'it',
  bucket: 'written',
  reasons: [],
  flags: [],
  ...over,
});

describe('createRunState', () => {
  it('captures the run context and starts empty at checkpoint 0', () => {
    const state = createRunState(ctx);
    expect(state.runId).toBe('run-1');
    expect(state.policyDigest).toBe('digest-1');
    expect(state.checkpoint).toBe(0);
    expect(state.records).toEqual([]);
  });

  it('persists the field allowlist so a resume can restore it', () => {
    const state = createRunState({
      ...ctx,
      selectedFieldsByModel: { m1: ['title', 'body'] },
    });
    expect(state.selectedFieldsByModel).toEqual({ m1: ['title', 'body'] });
  });
});

describe('foldOutcome — itemTypeId', () => {
  it('records the model id on the record (for the per-model summary)', () => {
    const state = foldOutcome(
      createRunState(ctx),
      outcome({ itemTypeId: 'model-A' }),
      { now: 1 },
    );
    expect(state.records[0].itemTypeId).toBe('model-A');
  });

  it('keeps a prior itemTypeId when a later outcome omits it', () => {
    let state = foldOutcome(createRunState(ctx), outcome({ itemTypeId: 'model-A' }), {
      now: 1,
    });
    state = foldOutcome(state, outcome({ toLocale: 'de' }), { now: 2 });
    expect(state.records[0].itemTypeId).toBe('model-A');
  });
});

describe('bumpCheckpoint', () => {
  it('increments the monotonic ordinal', () => {
    expect(bumpCheckpoint(bumpCheckpoint(createRunState(ctx))).checkpoint).toBe(2);
  });
});

describe('foldOutcome', () => {
  it('adds a new record + unit and stamps updatedAt from the injected clock', () => {
    const state = foldOutcome(createRunState(ctx), outcome({ preVersion: 'v1' }), { now: 5000 });
    expect(state.records).toHaveLength(1);
    expect(state.records[0].recordId).toBe('r1');
    expect(state.records[0].sourceVersion).toBe('v1');
    expect(state.records[0].units[0].updatedAt).toBe(5000);
  });

  it('nests a second locale under the same record', () => {
    let state = foldOutcome(createRunState(ctx), outcome({ toLocale: 'it' }), { now: 1 });
    state = foldOutcome(state, outcome({ toLocale: 'de' }), { now: 2 });
    expect(state.records).toHaveLength(1);
    expect(state.records[0].units.map((u) => u.toLocale)).toEqual(['it', 'de']);
  });

  it('upserts (replaces) a unit on a bucket transition, not duplicates', () => {
    let state = foldOutcome(createRunState(ctx), outcome({ bucket: 'not-attempted' }), { now: 1 });
    state = foldOutcome(state, outcome({ bucket: 'written', postVersion: 'v9' }), { now: 2 });
    expect(state.records[0].units).toHaveLength(1);
    expect(state.records[0].units[0].bucket).toBe('written');
    expect(state.records[0].writtenVersion).toBe('v9');
  });

  it('keeps prior versions when a later outcome omits them', () => {
    let state = foldOutcome(createRunState(ctx), outcome({ preVersion: 'v1', postVersion: 'v2' }), { now: 1 });
    state = foldOutcome(state, outcome({ toLocale: 'de' }), { now: 2 }); // no versions
    expect(state.records[0].sourceVersion).toBe('v1');
    expect(state.records[0].writtenVersion).toBe('v2');
  });

  it('projects reasons (fieldPath + code, message dropped) and flag check ids', () => {
    const state = foldOutcome(
      createRunState(ctx),
      outcome({
        bucket: 'blocked',
        reasons: [{ fieldPath: 'title', code: 'required-blank', message: 'x' }],
        flags: [{ checkId: 'length-ratio', message: 'y' }],
      }),
      { now: 1 },
    );
    const unit = state.records[0].units[0];
    expect(unit.reasons).toEqual([{ fieldPath: 'title', code: 'required-blank' }]);
    expect(unit.flagCheckIds).toEqual(['length-ratio']);
  });

  it('does not mutate the input state', () => {
    const state = createRunState(ctx);
    foldOutcome(state, outcome(), { now: 1 });
    expect(state.records).toEqual([]);
  });
});

describe('foldOutcomes', () => {
  it('folds a batch in order', () => {
    const state = foldOutcomes(
      createRunState(ctx),
      [outcome({ recordId: 'r1' }), outcome({ recordId: 'r2' })],
      { now: 1 },
    );
    expect(state.records.map((r) => r.recordId)).toEqual(['r1', 'r2']);
  });
});
