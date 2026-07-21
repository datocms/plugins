import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIndexedDBRunStore } from './indexedDBRunStore';
import { createRunState } from './runState';

const makeState = (runId: string, startedAt: number) =>
  createRunState({
    runId,
    deviceId: 'device-1',
    startedAt,
    operation: 'translate',
    policyDigest: 'abcd1234',
    fromLocale: 'en',
    toLocales: ['it'],
  });

describe('createIndexedDBRunStore', () => {
  let store: ReturnType<typeof createIndexedDBRunStore>;

  beforeEach(() => {
    // A fresh in-memory IndexedDB per test keeps them isolated.
    store = createIndexedDBRunStore(new IDBFactory(), 'runs-test');
  });

  it('saves and loads a run by id, round-tripping through the JSON adapter', async () => {
    await store.save(makeState('run-1', 100));
    const loaded = await store.load('run-1');
    expect(loaded?.runId).toBe('run-1');
    expect(loaded?.startedAt).toBe(100);
  });

  it('returns null for an unknown run', async () => {
    expect(await store.load('nope')).toBeNull();
  });

  it('latest() returns the most recently started run', async () => {
    await store.save(makeState('old', 100));
    await store.save(makeState('new', 200));
    expect((await store.latest())?.runId).toBe('new');
  });

  it('latest() is null when the store is empty', async () => {
    expect(await store.latest()).toBeNull();
  });

  it('list() projects run summaries', async () => {
    await store.save(makeState('run-1', 100));
    expect(await store.list()).toEqual([
      {
        runId: 'run-1',
        checkpoint: 0,
        startedAt: 100,
        operation: 'translate',
      },
    ]);
  });

  it('delete() removes a run', async () => {
    await store.save(makeState('run-1', 100));
    await store.delete('run-1');
    expect(await store.load('run-1')).toBeNull();
  });

  it('save() overwrites an existing run (idempotent by runId)', async () => {
    await store.save(makeState('run-1', 100));
    await store.save(makeState('run-1', 999));
    expect((await store.load('run-1'))?.startedAt).toBe(999);
    expect(await store.list()).toHaveLength(1);
  });
});
