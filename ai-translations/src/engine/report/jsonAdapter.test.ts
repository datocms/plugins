import { describe, expect, it } from 'vitest';
import { deserializeRunState, serializeRunState, type TokenDivergence } from './jsonAdapter';
import { createRunState, foldOutcome, type RunContext } from './runState';
import type { UnitOutcome } from '../plan/types';

const ctx: RunContext = {
  runId: 'run-1',
  deviceId: 'dev-1',
  startedAt: 100,
  operation: 'translate',
  policyDigest: 'digest-1',
  fromLocale: 'en',
  toLocales: ['it'],
};

const sampleState = () => {
  const outcome = (over: Partial<UnitOutcome>): UnitOutcome => ({
    recordId: 'r1', toLocale: 'it', bucket: 'written', reasons: [], flags: [], ...over,
  });
  let state = createRunState(ctx);
  state = foldOutcome(state, outcome({ toLocale: 'it', bucket: 'written', flags: [{ checkId: 'length-ratio', message: 'x' }], postVersion: 'v2' }), { now: 5 });
  state = foldOutcome(state, outcome({ toLocale: 'de', bucket: 'blocked', reasons: [{ fieldPath: 'title', code: 'required-blank', message: 'y' }] }), { now: 6 });
  return state;
};

describe('jsonAdapter', () => {
  it('round-trips a RunState (mrc stripped back to canonical shape)', () => {
    const state = sampleState();
    const back = deserializeRunState(serializeRunState(state));
    expect(back).toEqual(state);
  });

  it('embeds a per-unit mrc anchor in the JSON', () => {
    const json = JSON.parse(serializeRunState(sampleState()));
    expect(json.records[0].units[0].mrc).toMatch(/^v1:/);
  });

  it('round-trips selectedFieldsByModel and per-record itemTypeId (restore inputs)', () => {
    let state = createRunState({ ...ctx, selectedFieldsByModel: { m1: ['title'] } });
    state = foldOutcome(
      state,
      { recordId: 'r1', itemTypeId: 'm1', toLocale: 'it', bucket: 'written', reasons: [], flags: [] },
      { now: 1 },
    );
    const back = deserializeRunState(serializeRunState(state));
    expect(back.selectedFieldsByModel).toEqual({ m1: ['title'] });
    expect(back.records[0].itemTypeId).toBe('m1');
  });

  it('rejects an unknown schemaVersion', () => {
    const json = serializeRunState(sampleState()).replace('"schemaVersion":1', '"schemaVersion":99');
    expect(() => deserializeRunState(json)).toThrow(/unknown schemaVersion/);
  });

  it('reports a divergence when a structured bucket is tampered but the mrc is intact', () => {
    // Flip the structured bucket of the written unit to 'blocked'; its mrc still says written.
    const json = serializeRunState(sampleState()).replace('"bucket":"written"', '"bucket":"blocked"');
    const divergences: TokenDivergence[] = [];
    deserializeRunState(json, (d) => divergences.push(d));
    expect(divergences.some((d) => d.detail.includes('token bucket "written"'))).toBe(true);
  });

  it('reports no divergence on a clean round-trip', () => {
    const divergences: TokenDivergence[] = [];
    deserializeRunState(serializeRunState(sampleState()), (d) => divergences.push(d));
    expect(divergences).toEqual([]);
  });
});
