import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  changeCreators,
  FAILURE_SAMPLE_LIMIT,
  MAX_ATTEMPTS,
  sleep,
  type BulkProgress,
  type CreatorClient,
  type Runtime,
} from './bulkChangeCreator';

const creator = { id: 'new-user', type: 'user' as const };

function apiError(
  status: number,
  headers: Record<string, string> = {},
  transient = false,
) {
  return {
    request: { headers: { authorization: 'Bearer PRIVATE_TOKEN' } },
    response: {
      status,
      headers,
      body: {
        data: [
          {
            attributes: {
              code: 'SIMULATED_ERROR',
              transient,
              details: { secret: 'PRIVATE_TOKEN' },
            },
          },
        ],
      },
    },
  };
}

function fastRuntime(): Runtime {
  let now = 0;
  return {
    now: () => now,
    random: () => 0,
    sleep: async (ms) => {
      now += ms;
    },
  };
}

function clientWithUpdate(
  update: CreatorClient['items']['update'],
): CreatorClient {
  return { items: { update, find: async () => ({ creator }) } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('massive creator updates', () => {
  it('does not interrupt updates when a progress observer fails', async () => {
    const update = vi.fn(async () => {});
    const result = await changeCreators(
      clientWithUpdate(update),
      ['a', 'b'],
      creator,
      {
        runtime: fastRuntime(),
        onProgress: () => {
          throw new Error('Reporting failed');
        },
      },
    );
    expect(result).toMatchObject({ succeeded: 2, failed: 0, unprocessed: 0 });
    expect(update).toHaveBeenCalledTimes(2);
  });
  it('processes 200,000 IDs once, retains bounded results and never reads content', async () => {
    const ids = Array.from(
      { length: 200_000 },
      (_, index) => `record-${index}`,
    );
    let count = 0;
    let progressCount = 0;
    let last: BulkProgress | undefined;
    const client = clientWithUpdate(async (id, body) => {
      if (id !== ids[count] || Object.keys(body).join() !== 'creator') {
        throw new Error('Unexpected ID or mutation payload');
      }
      count += 1;
    });
    client.items.find = async () => {
      throw new Error('Unnecessary content read');
    };
    const result = await changeCreators(client, [...ids, ids[0]], creator, {
      concurrency: 1,
      runtime: fastRuntime(),
      onProgress: (progress) => {
        progressCount += 1;
        last = progress;
      },
    });
    expect(result).toEqual({
      total: 200_000,
      succeeded: 200_000,
      failed: 0,
      uncertain: 0,
      unprocessed: 0,
      stopped: false,
      failureSamples: [],
    });
    expect(count).toBe(200_000);
    expect(last).toMatchObject({
      processed: 200_000,
      active: 0,
      total: 200_000,
    });
    expect(progressCount).toBeLessThan(70_000);
  }, 120_000);

  it('continues record-specific failures and stores only sanitized samples at scale', async () => {
    const ids = Array.from({ length: 200_000 }, (_, index) => `${index}`);
    const result = await changeCreators(
      clientWithUpdate(async () => {
        throw apiError(422);
      }),
      ids,
      creator,
      { concurrency: 1, runtime: fastRuntime() },
    );
    expect(result.failed).toBe(200_000);
    expect(result.unprocessed).toBe(0);
    expect(result.failureSamples).toHaveLength(FAILURE_SAMPLE_LIMIT);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN');
    expect(JSON.stringify(result).length).toBeLessThan(1000);
  }, 120_000);

  it('paces all workers, bounds in-flight updates and clamps unsafe concurrency', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: number[] = [];
    let active = 0;
    let maxActive = 0;
    const client = clientWithUpdate(async () => {
      starts.push(Date.now());
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(1000);
      active -= 1;
    });
    const run = changeCreators(
      client,
      Array.from({ length: 20 }, (_, i) => `${i}`),
      creator,
      {
        concurrency: 100_000,
      },
    );
    await vi.runAllTimersAsync();
    expect((await run).succeeded).toBe(20);
    expect(maxActive).toBe(6);
    expect(
      starts.every(
        (time, index) => index === 0 || time - starts[index - 1] >= 100,
      ),
    ).toBe(true);
  });

  it('shares 429 cooldown across workers and retries without manual intervention', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: number[] = [];
    const update = vi.fn(async () => {
      starts.push(Date.now());
      if (starts.length === 1)
        throw apiError(429, { 'X-RateLimit-Reset': '3' });
    });
    const run = changeCreators(
      clientWithUpdate(update),
      ['a', 'b', 'c'],
      creator,
    );
    await vi.advanceTimersByTimeAsync(2900);
    expect(update).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect((await run).succeeded).toBe(3);
    expect(starts[1]).toBeGreaterThanOrEqual(3000);
    expect(
      starts.every(
        (time, index) => index === 0 || time - starts[index - 1] >= 100,
      ),
    ).toBe(true);
  });

  it('caps transient retries and stops dispatch after an exhausted outage', async () => {
    const update = vi.fn(async () => {
      throw apiError(429);
    });
    const result = await changeCreators(
      clientWithUpdate(update),
      ['a', 'b', 'c'],
      creator,
      {
        concurrency: 1,
        runtime: fastRuntime(),
      },
    );
    expect(update).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(result).toMatchObject({ failed: 1, unprocessed: 2, stopped: true });
  });

  it('stops global authentication errors but continues 403/404/422 failures', async () => {
    const update = vi.fn(async (id: string) => {
      if (id === 'a') throw apiError(403);
      if (id === 'b') throw apiError(404);
      if (id === 'c') throw apiError(422);
      if (id === 'd') throw apiError(401);
    });
    const result = await changeCreators(
      clientWithUpdate(update),
      ['a', 'b', 'c', 'd', 'e'],
      creator,
      {
        concurrency: 1,
        runtime: fastRuntime(),
      },
    );
    expect(update).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ failed: 4, unprocessed: 1, stopped: true });
  });

  it('confirms an ambiguous PUT through GET without issuing a second mutation', async () => {
    const update = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const find = vi.fn(async () => ({ creator }));
    const result = await changeCreators(
      { items: { update, find } },
      ['a'],
      creator,
      {
        runtime: fastRuntime(),
      },
    );
    expect(result).toMatchObject({ succeeded: 1, uncertain: 0, failed: 0 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('separates uncertain outcomes from failures and stops when confirmation fails', async () => {
    const update = vi.fn(async () => {
      throw apiError(503);
    });
    const find = vi.fn(async () => {
      throw apiError(503);
    });
    const result = await changeCreators(
      { items: { update, find } },
      ['a', 'b'],
      creator,
      {
        concurrency: 1,
        runtime: fastRuntime(),
      },
    );
    expect(result).toMatchObject({
      failed: 0,
      uncertain: 1,
      unprocessed: 1,
      stopped: true,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('does not claim success when creator verification differs', async () => {
    const client = clientWithUpdate(async () => {
      throw new Error('timeout');
    });
    client.items.find = async () => ({
      creator: { ...creator, type: 'sso_user' },
    });
    const result = await changeCreators(client, ['a'], creator, {
      runtime: fastRuntime(),
    });
    expect(result).toMatchObject({ succeeded: 0, failed: 0, uncertain: 1 });
  });

  it('cancels future scheduling while waiting for in-flight updates to settle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const controller = new AbortController();
    const update = vi.fn(async () => {
      await sleep(1000);
    });
    const run = changeCreators(
      clientWithUpdate(update),
      ['a', 'b', 'c', 'd'],
      creator,
      {
        signal: controller.signal,
      },
    );
    await vi.advanceTimersByTimeAsync(150);
    expect(update).toHaveBeenCalledTimes(2);
    controller.abort();
    let finished = false;
    void run.then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).toBe(false);
    await vi.runAllTimersAsync();
    expect(await run).toMatchObject({
      succeeded: 2,
      unprocessed: 2,
      stopped: true,
    });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('records a rejected update as failed when cancelled during retry cooldown', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const update = vi.fn(async () => {
      throw apiError(429, { 'retry-after': '100' });
    });
    const run = changeCreators(clientWithUpdate(update), ['a', 'b'], creator, {
      signal: controller.signal,
      concurrency: 1,
    });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await run).toMatchObject({
      failed: 1,
      unprocessed: 1,
      stopped: true,
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('wakes cooldown sleepers after a fatal error while another PUT is in flight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const update = vi.fn(async (id: string) => {
      if (id === 'a') {
        await sleep(200);
        throw apiError(429, { 'retry-after': '3600' });
      }
      await sleep(200);
      throw apiError(401);
    });
    const run = changeCreators(
      clientWithUpdate(update),
      ['a', 'b', 'c'],
      creator,
      {
        concurrency: 2,
      },
    );
    await vi.advanceTimersByTimeAsync(350);
    expect(await run).toMatchObject({
      failed: 2,
      unprocessed: 1,
      stopped: true,
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops confirmation reads waiting on a long shared cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const controller = new AbortController();
    const update = vi.fn(async (id: string) => {
      await sleep(200);
      if (id === 'a') throw apiError(429, { 'retry-after': '3600' });
      throw new TypeError('Lost response');
    });
    const find = vi.fn(async () => ({ creator }));
    const run = changeCreators(
      { items: { update, find } },
      ['a', 'b', 'c'],
      creator,
      { concurrency: 2, signal: controller.signal },
    );
    await vi.advanceTimersByTimeAsync(350);
    expect(find).not.toHaveBeenCalled();
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await run).toMatchObject({
      succeeded: 0,
      failed: 1,
      uncertain: 1,
      unprocessed: 1,
      stopped: true,
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(find).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for a confirmation read already started when stopped', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const controller = new AbortController();
    const update = vi.fn(async () => {
      throw new TypeError('Lost response');
    });
    const find = vi.fn(async () => {
      await sleep(500);
      return { creator };
    });
    const run = changeCreators(
      { items: { update, find } },
      ['a', 'b'],
      creator,
      { concurrency: 1, signal: controller.signal },
    );
    await vi.advanceTimersByTimeAsync(150);
    controller.abort();
    await vi.advanceTimersByTimeAsync(450);
    expect(await run).toMatchObject({
      succeeded: 1,
      uncertain: 0,
      unprocessed: 1,
      stopped: true,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a definite transient rejection and paces confirmation reads', async () => {
    const runtime = fastRuntime();
    const starts: number[] = [];
    let attempts = 0;
    const client = clientWithUpdate(async () => {
      starts.push(runtime.now());
      attempts += 1;
      if (attempts === 1) throw apiError(409, {}, true);
      throw new TypeError('Lost response');
    });
    client.items.find = async () => {
      starts.push(runtime.now());
      return { creator };
    };
    const result = await changeCreators(client, ['a'], creator, { runtime });
    expect(result.succeeded).toBe(1);
    expect(attempts).toBe(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(100);
  });

  it('handles empty/pre-cancelled selections and invalid limits without silent omissions', async () => {
    const update = vi.fn(async () => {});
    const client = clientWithUpdate(update);
    expect(await changeCreators(client, [], creator)).toMatchObject({
      total: 0,
      succeeded: 0,
    });
    const controller = new AbortController();
    controller.abort();
    expect(
      await changeCreators(client, ['a'], creator, {
        signal: controller.signal,
      }),
    ).toMatchObject({ unprocessed: 1, stopped: true });
    expect(update).not.toHaveBeenCalled();
    const results = await Promise.all(
      [0, -1, 0.5, NaN, Infinity].map((concurrency) =>
        changeCreators(client, ['a', 'b'], creator, {
          concurrency,
          runtime: fastRuntime(),
        }),
      ),
    );
    for (const result of results)
      expect(result).toMatchObject({ succeeded: 2, unprocessed: 0 });
  });
});
