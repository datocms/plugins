/**
 * Tests for slotScheduler.ts — the AIMD slot scheduler (spec §2.3-3).
 *
 * Verifies the ported adaptive-concurrency invariants: start at the cap, +1 after
 * three consecutive successes (bounded by the cap), halve (floor 1) on a
 * rate-limit error while requeuing that job at the tail, `spacingMs` between
 * launches, cancellation stopping further launches, results aligned to input
 * order, and per-instance state (concurrency + success streak) surviving across
 * successive `run()` calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSlotScheduler } from './slotScheduler';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const defer = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Tracks live/peak execution concurrency and launch order across jobs. */
const makeHarness = () => {
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  const wrap =
    (index: number, impl: () => Promise<unknown>) =>
    (): Promise<unknown> => {
      started.push(index);
      active += 1;
      peak = Math.max(peak, active);
      return impl().finally(() => {
        active -= 1;
      });
    };
  return {
    wrap,
    started,
    active: () => active,
    peak: () => peak,
  };
};

const noHooks = {
  isRateLimitError: () => false,
  checkCancellation: () => false,
};

/** Flush pending microtasks + any due fake timers. */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('slotScheduler.ts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at the cap: launches exactly maxConcurrency jobs at once', async () => {
    const scheduler = createSlotScheduler({ maxConcurrency: 3, spacingMs: 0 });
    const h = makeHarness();
    const deferreds = Array.from({ length: 6 }, () => defer<string>());
    const jobs = deferreds.map((d, i) => h.wrap(i, () => d.promise));

    const runP = scheduler.run(jobs, noHooks);
    await flush();

    expect(h.active()).toBe(3);
    expect(h.started).toEqual([0, 1, 2]);

    for (const d of deferreds) d.resolve('ok');
    await runP;
  });

  it('6 jobs, cap 3, no errors: never more than 3 in flight, all settle', async () => {
    const scheduler = createSlotScheduler({ maxConcurrency: 3, spacingMs: 0 });
    const h = makeHarness();
    const deferreds = Array.from({ length: 6 }, () => defer<string>());
    const jobs = deferreds.map((d, i) => h.wrap(i, () => d.promise));

    const runP = scheduler.run(jobs, noHooks);
    for (const d of deferreds) {
      d.resolve('ok');
      // biome-ignore lint/performance/noAwaitInLoops: intentional step-by-step draining to observe in-flight concurrency.
      await flush();
    }
    const results = await runP;

    expect(h.peak()).toBeLessThanOrEqual(3);
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('spaces launches by spacingMs', async () => {
    const scheduler = createSlotScheduler({
      maxConcurrency: 5,
      spacingMs: 100,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    const h = makeHarness();
    const deferreds = Array.from({ length: 3 }, () => defer<string>());
    const jobs = deferreds.map((d, i) => h.wrap(i, () => d.promise));

    const runP = scheduler.run(jobs, noHooks);

    await flush();
    expect(h.started).toEqual([0]);

    await vi.advanceTimersByTimeAsync(100);
    expect(h.started).toEqual([0, 1]);

    await vi.advanceTimersByTimeAsync(100);
    expect(h.started).toEqual([0, 1, 2]);

    for (const d of deferreds) d.resolve('ok');
    await runP;
  });

  it('halves concurrency (floor 1) on a rate-limit error and requeues the job at the tail', async () => {
    const isRateLimitError = (e: unknown) => e === 'RL';
    const scheduler = createSlotScheduler({ maxConcurrency: 4, spacingMs: 0 });
    const h = makeHarness();

    // 8 controllable jobs; job 0 rate-limits on its first run, succeeds on rerun.
    const d = Array.from({ length: 8 }, () => defer<string>());
    const d0Rerun = defer<string>();
    let job0Calls = 0;
    const jobs = [
      h.wrap(0, () => (job0Calls++ === 0 ? d[0].promise : d0Rerun.promise)),
      ...Array.from({ length: 7 }, (_unused, k) =>
        h.wrap(k + 1, () => d[k + 1].promise),
      ),
    ];

    const runP = scheduler.run(jobs, {
      isRateLimitError,
      checkCancellation: () => false,
    });
    await flush();
    expect(h.active()).toBe(4); // started at the cap

    // Job 0 rate-limits → concurrency halves 4 → 2, job 0 requeued at the tail.
    d[0].reject('RL');
    await flush();
    // In flight is now {1,2,3}; no slot opens because active(3) > concurrency(2).
    expect(h.active()).toBe(3);

    d[1].resolve('a');
    await flush();
    expect(h.active()).toBe(2); // still no new launch (2 - 2 = 0)

    d[2].resolve('b');
    await flush();
    expect(h.active()).toBe(2); // one drained, one launched — capped at 2

    // Drain everything so the requeued job 0 finally reruns at the tail.
    d[3].resolve('c');
    d[4].resolve('d');
    d[5].resolve('e');
    d[6].resolve('f');
    d[7].resolve('g');
    d0Rerun.resolve('z');
    const results = await runP;

    expect(h.peak()).toBeLessThanOrEqual(4);
    expect(h.started[h.started.length - 1]).toBe(0); // requeued job ran last
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('429 on the second job drops concurrency to ⌈3/2⌉ and reruns it at the tail', async () => {
    const isRateLimitError = (e: unknown) => e === 'RL';
    const scheduler = createSlotScheduler({ maxConcurrency: 3, spacingMs: 0 });
    const h = makeHarness();

    const d = Array.from({ length: 6 }, () => defer<string>());
    const d1Rerun = defer<string>();
    let job1Calls = 0;
    const jobs = [
      h.wrap(0, () => d[0].promise),
      h.wrap(1, () => (job1Calls++ === 0 ? d[1].promise : d1Rerun.promise)),
      ...Array.from({ length: 4 }, (_unused, k) =>
        h.wrap(k + 2, () => d[k + 2].promise),
      ),
    ];

    const runP = scheduler.run(jobs, {
      isRateLimitError,
      checkCancellation: () => false,
    });
    await flush();
    expect(h.active()).toBe(3); // {0,1,2}

    d[1].reject('RL');
    await flush();
    // concurrency 3 → ceil(3/2) = 2; in flight {0,2}, no slot opens (2 - 2 = 0).
    expect(h.active()).toBe(2);

    d[0].resolve('a');
    d[2].resolve('b');
    d[3].resolve('c');
    d[4].resolve('d');
    d[5].resolve('e');
    d1Rerun.resolve('z');
    const results = await runP;

    expect(h.peak()).toBeLessThanOrEqual(3);
    expect(h.started[h.started.length - 1]).toBe(1); // job 1 reran at the tail
    expect(results).toHaveLength(6);
  });

  it('increases concurrency by 1 after 3 consecutive successes, up to the cap', async () => {
    const isRateLimitError = (e: unknown) => e === 'RL';
    const scheduler = createSlotScheduler({ maxConcurrency: 4, spacingMs: 0 });
    const h = makeHarness();

    const d = Array.from({ length: 8 }, () => defer<string>());
    const d0Rerun = defer<string>();
    let job0Calls = 0;
    const jobs = [
      h.wrap(0, () => (job0Calls++ === 0 ? d[0].promise : d0Rerun.promise)),
      ...Array.from({ length: 7 }, (_unused, k) =>
        h.wrap(k + 1, () => d[k + 1].promise),
      ),
    ];

    const runP = scheduler.run(jobs, {
      isRateLimitError,
      checkCancellation: () => false,
    });
    await flush();

    // Drop to 2 so there is headroom below the cap to grow back into.
    d[0].reject('RL');
    await flush();
    expect(h.active()).toBe(3); // {1,2,3} still draining

    d[1].resolve('a'); // success streak 1
    await flush();
    expect(h.active()).toBe(2);

    d[2].resolve('b'); // success streak 2 → launches one more, capped at 2
    await flush();
    expect(h.active()).toBe(2);

    d[3].resolve('c'); // success streak 3 → concurrency 2 → 3
    await flush();
    expect(h.active()).toBe(3); // the +1 slot opened

    d[4].resolve('d');
    d[5].resolve('e');
    d[6].resolve('f');
    d[7].resolve('g');
    d0Rerun.resolve('z');
    const results = await runP;

    expect(h.peak()).toBeLessThanOrEqual(4);
    expect(results).toHaveLength(8);
  });

  it('cancellation stops filling slots and resolves once active jobs settle', async () => {
    let cancelled = false;
    const scheduler = createSlotScheduler({ maxConcurrency: 2, spacingMs: 0 });
    const h = makeHarness();
    const deferreds = Array.from({ length: 6 }, () => defer<string>());
    const jobs = deferreds.map((d, i) => h.wrap(i, () => d.promise));

    const runP = scheduler.run(jobs, {
      isRateLimitError: () => false,
      checkCancellation: () => cancelled,
    });
    await flush();
    expect(h.started).toEqual([0, 1]); // launched at the cap

    // Cancel while jobs 0 and 1 are in flight; jobs 2+ must never start.
    cancelled = true;
    deferreds[0].resolve('ok');
    await flush();
    deferreds[1].resolve('ok');
    const results = await runP;

    expect(h.started).toEqual([0, 1]);
    expect(results).toHaveLength(2); // exactly the settled ones
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('records a non-rate-limit rejection as a settled rejected result', async () => {
    const scheduler = createSlotScheduler({ maxConcurrency: 2, spacingMs: 0 });
    const h = makeHarness();
    const d0 = defer<string>();
    const d1 = defer<string>();
    const jobs = [h.wrap(0, () => d0.promise), h.wrap(1, () => d1.promise)];

    const runP = scheduler.run(jobs, noHooks);
    const boom = new Error('boom');
    d0.reject(boom);
    d1.resolve('ok');
    const results = await runP;

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ status: 'rejected', reason: boom });
    expect(results[1]).toEqual({ status: 'fulfilled', value: 'ok' });
  });

  it('carries adapted concurrency and success streak across run() calls', async () => {
    const isRateLimitError = (e: unknown) => e === 'RL';
    const scheduler = createSlotScheduler({ maxConcurrency: 4, spacingMs: 0 });

    // First run: one rate-limit halves concurrency 4 → 2 (streak stays < 3).
    const h1 = makeHarness();
    const dA = defer<string>();
    const dARerun = defer<string>();
    const dB = defer<string>();
    let aCalls = 0;
    const run1 = scheduler.run(
      [
        h1.wrap(0, () => (aCalls++ === 0 ? dA.promise : dARerun.promise)),
        h1.wrap(1, () => dB.promise),
      ],
      { isRateLimitError, checkCancellation: () => false },
    );
    await flush();
    dA.reject('RL'); // 4 → 2
    await flush();
    dB.resolve('ok');
    dARerun.resolve('ok');
    await run1;

    // Second run on the SAME instance must start at 2, not 4.
    const h2 = makeHarness();
    const deferreds = Array.from({ length: 6 }, () => defer<string>());
    const run2 = scheduler.run(
      deferreds.map((d, i) => h2.wrap(i, () => d.promise)),
      { isRateLimitError, checkCancellation: () => false },
    );
    await flush();
    expect(h2.active()).toBe(2); // inherited concurrency

    for (const d of deferreds) d.resolve('ok');
    await run2;
  });

  it('resolves immediately for an empty job list', async () => {
    const scheduler = createSlotScheduler({ maxConcurrency: 3, spacingMs: 0 });
    const results = await scheduler.run([], noHooks);
    expect(results).toEqual([]);
  });
});
