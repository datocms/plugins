import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDiscoveryCancelled } from './query';
import { RequestPool } from './requestPool';

const timers = {
  setTimeout: (callback: () => void, ms: number) =>
    globalThis.setTimeout(callback, ms),
  clearTimeout: (handle: unknown) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('RequestPool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps at most `concurrency` requests in flight, first come first served', async () => {
    const pool = new RequestPool({
      concurrency: 2,
      perWindow: 100,
      windowMs: 1000,
      timers,
    });
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((gate, index) =>
      pool.run(async () => {
        started.push(index);
        await gate.promise;
        return index;
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([0, 1]);
    expect(pool.inFlight).toBe(2);
    expect(pool.waiting).toBe(1);

    gates[1]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([0, 1, 2]);

    gates[0]?.resolve();
    gates[2]?.resolve();
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2]);
    expect(pool.inFlight).toBe(0);
  });

  it('starts at most `perWindow` requests in any `windowMs`', async () => {
    const pool = new RequestPool({
      concurrency: 10,
      perWindow: 3,
      windowMs: 3000,
      timers,
    });
    const startedAt: number[] = [];
    const runs = Array.from({ length: 7 }, () =>
      pool.run(async () => {
        startedAt.push(Date.now());
      }),
    );
    const t0 = Date.now();

    await vi.advanceTimersByTimeAsync(0);
    expect(startedAt).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(2999);
    expect(startedAt).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(startedAt).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all(runs);

    expect(startedAt.map((at) => at - t0)).toEqual([
      0, 0, 0, 3000, 3000, 3000, 6000,
    ]);
  });

  it('never starts a waiting request whose signal aborts, and rejects it as cancelled', async () => {
    const pool = new RequestPool({
      concurrency: 1,
      perWindow: 100,
      windowMs: 1000,
      timers,
    });
    const gate = deferred();
    const first = pool.run(() => gate.promise);
    const controller = new AbortController();
    const task = vi.fn(async () => 'late');
    const second = pool.run(task, controller.signal);
    const secondResult = second.catch((error: unknown) => error);

    controller.abort();
    expect(isDiscoveryCancelled(await secondResult)).toBe(true);
    expect(pool.waiting).toBe(0);

    gate.resolve();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(task).not.toHaveBeenCalled();
  });

  it('rejects at once when the signal already aborted', async () => {
    const pool = new RequestPool({
      concurrency: 1,
      perWindow: 1,
      windowMs: 1000,
      timers,
    });
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn(async () => 1);

    const error = await pool
      .run(task, controller.signal)
      .catch((reason: unknown) => reason);

    expect(isDiscoveryCancelled(error)).toBe(true);
    expect(task).not.toHaveBeenCalled();
  });

  it('frees the slot of a request that fails', async () => {
    const pool = new RequestPool({
      concurrency: 1,
      perWindow: 100,
      windowMs: 1000,
      timers,
    });
    const failing = pool.run(async () => {
      throw new Error('boom');
    });
    const next = pool.run(async () => 'next');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('next');
  });
});
