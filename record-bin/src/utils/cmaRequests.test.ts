import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CmaRequestScheduler,
  createBoundedFetch,
  getStatus,
  retryCmaRead,
  runWithConcurrency,
  waitForRequest,
} from './cmaRequests';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bounded CMA work', () => {
  it('processes a virtual 200,000-element selection with only four workers', async () => {
    // A virtual array generates tokens lazily; no 200,000 fixtures or promises.
    const range = new Proxy([] as number[], {
      get: (_target, key) => (key === 'length' ? 200000 : Number(key)),
    });
    let active = 0;
    let maximum = 0;
    let count = 0;
    let sum = 0;
    await runWithConcurrency(range, 4, async (value) => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      count++;
      sum += value;
      active--;
    });
    expect(count).toBe(200000);
    expect(sum).toBe((199999 * 200000) / 2);
    expect(maximum).toBe(4);
  });
  it('drains in-flight workers before rejecting', async () => {
    let finished = 0;
    await expect(
      runWithConcurrency([0, 1, 2, 3], 4, async (value) => {
        if (!value) throw new Error('cancelled');
        await Promise.resolve();
        finished++;
      }),
    ).rejects.toThrow('cancelled');
    expect(finished).toBe(3);
  });
  it('spaces starts and shares rate-limit cooldown across workers', async () => {
    vi.useFakeTimers();
    const scheduler = new CmaRequestScheduler(100);
    const starts: number[] = [];
    const start = async () => {
      await scheduler.beforeRequest();
      starts.push(Date.now());
    };
    const initial = Date.now();
    const requests = [start(), start(), start()];
    await vi.advanceTimersByTimeAsync(50);
    scheduler.onRateLimit(1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toEqual([initial]);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(requests);
    expect(starts.slice(1)).toEqual([initial + 1050, initial + 1050]);
  });
  it('honors Retry-After and retries only transient reads', async () => {
    vi.useFakeTimers();
    const operation = vi
      .fn()
      .mockRejectedValueOnce({
        response: { status: 429, headers: { 'retry-after': '2' } },
      })
      .mockResolvedValue('ok');
    const pending = retryCmaRead(operation, new CmaRequestScheduler(0));
    await vi.advanceTimersByTimeAsync(1999);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe('ok');
    const forbidden = vi.fn().mockRejectedValue({ response: { status: 403 } });
    await expect(
      retryCmaRead(forbidden, new CmaRequestScheduler(0)),
    ).rejects.toMatchObject({ response: { status: 403 } });
    expect(forbidden).toHaveBeenCalledTimes(1);
  });
  it('cancels pending backoff without issuing another request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(new TypeError('network'));
    const pending = retryCmaRead(
      operation,
      new CmaRequestScheduler(0),
      controller.signal,
    );
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await assertion;
    expect(operation).toHaveBeenCalledTimes(1);
    await expect(waitForRequest(1000, controller.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
  });
  it('aborts real fetch on a deadline, rather than merely abandoning its promise', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            observedSignal = init.signal ?? undefined;
            observedSignal?.addEventListener('abort', () =>
              reject(observedSignal?.reason),
            );
          }),
      ),
    );
    const pending = createBoundedFetch(
      undefined,
      50,
    )('https://example.invalid');
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(observedSignal?.aborted).toBe(true);
  });
  it('keeps JSON literal attributes opaque through the bounded fetch', async () => {
    const json = { id: 'literal', __itemTypeId: 'literal', type: 'item' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(json), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const response = await createBoundedFetch()('https://example.invalid');
    expect(await response.json()).toEqual(json);
    expect(getStatus({ response: { status: 404 } })).toBe(404);
  });
});
