import { describe, expect, it } from 'vitest';
import { createInMemoryRunStore } from './runStore';
import { bumpCheckpoint, createRunState, type RunContext } from './runState';

const ctx = (over: Partial<RunContext> = {}): RunContext => ({
  runId: 'run-1',
  deviceId: 'dev-1',
  startedAt: 100,
  operation: 'translate',
  policyDigest: 'd',
  fromLocale: 'en',
  toLocales: ['it'],
  ...over,
});

describe('InMemoryRunStore', () => {
  it('saves and loads a validated copy (not a shared reference)', async () => {
    const store = createInMemoryRunStore();
    const state = createRunState(ctx());
    await store.save(state);
    const loaded = await store.load('run-1');
    expect(loaded).toEqual(state);
    expect(loaded).not.toBe(state); // fresh copy through the serialization path
  });

  it('returns null for an unknown run', async () => {
    expect(await createInMemoryRunStore().load('nope')).toBeNull();
  });

  it('overwrites a run on re-save (latest checkpoint wins per run)', async () => {
    const store = createInMemoryRunStore();
    await store.save(createRunState(ctx()));
    await store.save(bumpCheckpoint(bumpCheckpoint(createRunState(ctx()))));
    expect((await store.load('run-1'))?.checkpoint).toBe(2);
  });

  it('latest() returns the most recently STARTED run', async () => {
    const store = createInMemoryRunStore();
    await store.save(createRunState(ctx({ runId: 'old', startedAt: 100 })));
    await store.save(createRunState(ctx({ runId: 'new', startedAt: 500 })));
    expect((await store.latest())?.runId).toBe('new');
  });

  it('lists run summaries and deletes', async () => {
    const store = createInMemoryRunStore();
    await store.save(createRunState(ctx({ runId: 'a' })));
    await store.save(createRunState(ctx({ runId: 'b' })));
    expect((await store.list()).map((s) => s.runId).sort()).toEqual(['a', 'b']);
    await store.delete('a');
    expect((await store.list()).map((s) => s.runId)).toEqual(['b']);
  });
});
