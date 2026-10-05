import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BULK_ITEMS } from '../constants';
import { executeBulkOperation } from '../operations/execute';
import type { BulkClient } from '../operations/types';
import {
  CmaRateLimitWaitError,
  CmaRequestScheduler,
  CmaRequestTimeoutError,
  createCmaFetch,
  isMutationOutcomeUnknown,
  JobPollingError,
  MutationOutcomeUnknownError,
  pollCmaJob,
  waitForRequest,
} from './requests';

function jsonResponse(
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ data: [] }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function transport(fetchFn: typeof fetch, timeout = 1000) {
  return createCmaFetch({
    fetchFn,
    scheduler: new CmaRequestScheduler(150, 4),
    requestTimeoutMs: timeout,
  });
}

const rateLimitCases: { headers: Record<string, string>; delay: number }[] = [
  { headers: { 'retry-after': '2.5' }, delay: 2500 },
  { headers: { 'retry-after': 'Fri, 02 Oct 2026 12:00:04 GMT' }, delay: 4000 },
  { headers: { 'x-ratelimit-reset': '2' }, delay: 2000 },
  { headers: { 'retry-after': '0' }, delay: 150 },
  {
    headers: { 'retry-after': 'invalid', 'x-ratelimit-reset': '2' },
    delay: 2000,
  },
];

describe('CMA request transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('paces a queue of reads and limits simultaneous HTTP requests', async () => {
    let active = 0;
    let peak = 0;
    const starts: number[] = [];
    const fetchFn = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      active += 1;
      peak = Math.max(peak, active);
      await waitForRequest(1000);
      active -= 1;
      return jsonResponse();
    });
    const request = transport(fetchFn, 2000);
    const requests = Promise.all(
      Array.from({ length: 80 }, () => request('https://example.test/items')),
    );
    await vi.runAllTimersAsync();
    await requests;
    expect(peak).toBe(4);
    expect(fetchFn).toHaveBeenCalledTimes(80);
    expect(
      starts.slice(1).every((time, index) => time - starts[index] >= 150),
    ).toBe(true);
  });

  it('shares a 429 cooldown and spaces waiting workers when it ends', async () => {
    const starts: number[] = [];
    const scheduler = new CmaRequestScheduler(150, 4);
    const fetchFn = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      return starts.length === 1
        ? jsonResponse(429, { 'x-ratelimit-reset': '3' })
        : jsonResponse();
    });
    const request = createCmaFetch({ fetchFn, scheduler });
    const requests = Promise.all(
      Array.from({ length: 8 }, () => request('https://example.test/items')),
    );
    await vi.runAllTimersAsync();
    await requests;
    expect(starts[1] - starts[0]).toBe(3000);
    expect(
      starts.slice(2).every((time, index) => time - starts[index + 1] >= 150),
    ).toBe(true);
  });

  it.each(rateLimitCases)(
    'honors rate limit header $headers',
    async ({ headers, delay }) => {
      const starts: number[] = [];
      const fetchFn = vi.fn<typeof fetch>(async () => {
        starts.push(Date.now());
        return starts.length === 1
          ? jsonResponse(429, headers)
          : jsonResponse();
      });
      const response = transport(fetchFn)('https://example.test/items', {
        method: 'POST',
      });
      await vi.runAllTimersAsync();
      expect((await response).status).toBe(200);
      expect(starts[1] - starts[0]).toBe(delay);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    },
  );

  it('bounds read retries with exponential backoff', async () => {
    const starts: number[] = [];
    const fetchFn = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      throw new TypeError('Connection lost');
    });
    const response = transport(fetchFn)('https://example.test/items');
    const assertion = expect(response).rejects.toThrow('Connection lost');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(starts.map((time) => time - starts[0])).toEqual([
      0, 1000, 3000, 7000,
    ]);
  });

  const longCooldownHeaders: Record<string, string>[] = [
    { 'retry-after': '90' },
    { 'retry-after': 'Fri, 02 Oct 2026 12:02:00 GMT' },
    { 'x-ratelimit-reset': '1e308' },
  ];
  it.each(longCooldownHeaders)(
    'fails a long advertised cooldown without retrying too early: $0',
    async (headers) => {
      const fetchFn = vi.fn<typeof fetch>(async () =>
        jsonResponse(429, headers),
      );
      const response = transport(fetchFn)('https://example.test/items', {
        method: 'POST',
      });
      const assertion = expect(response).rejects.toMatchObject({
        code: 'RATE_LIMIT_WAIT_EXCEEDED',
        status: 429,
      });
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it('does not submit queued work during a cooldown exceeding the retry budget', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse(429, { 'retry-after': '90' }),
    );
    const request = transport(fetchFn);
    const responses = Promise.allSettled([
      request('https://example.test/items', { method: 'POST' }),
      request('https://example.test/items', { method: 'POST' }),
    ]);
    await vi.runAllTimersAsync();
    const results = await responses;
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(CmaRateLimitWaitError);
        expect(isMutationOutcomeUnknown(result.reason)).toBe(false);
      }
    }
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('classifies a long cooldown as a confirmed 429 failure in bulk execution', async () => {
    const error = new CmaRateLimitWaitError(90_000);
    const mutation = vi.fn(async () => {
      throw error;
    });
    const client: BulkClient = {
      items: {
        rawBulkPublish: mutation,
        rawBulkUnpublish: mutation,
        rawBulkDestroy: mutation,
        rawBulkMoveToStage: mutation,
      },
    };
    const itemIds = Array.from(
      { length: MAX_BULK_ITEMS + 1 },
      (_, index) => `item-${index}`,
    );
    const result = await executeBulkOperation(client, {
      operation: 'publish',
      itemIds,
    });

    expect(error.response.status).toBe(429);
    expect(isMutationOutcomeUnknown(error)).toBe(false);
    expect(result).toMatchObject({
      requested: MAX_BULK_ITEMS + 1,
      successful: 0,
      failed: MAX_BULK_ITEMS,
      uncertain: 0,
      unprocessed: 1,
    });
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('bounds 429 retries instead of inheriting infinite SDK retries', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse(429));
    const response = transport(fetchFn)('https://example.test/items', {
      method: 'DELETE',
    });
    await vi.runAllTimersAsync();
    expect((await response).status).toBe(429);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('retries temporary server failures for reads only', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse());
    const response = transport(fetchFn)('https://example.test/items');
    await vi.runAllTimersAsync();
    expect((await response).status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each(['POST', 'PUT', 'DELETE'])(
    'never replays an uncertain $0 mutation',
    async (method) => {
      const fetchFn = vi.fn<typeof fetch>(async () => {
        throw new TypeError('Connection lost');
      });
      const response = transport(fetchFn)('https://example.test/items', {
        method,
      });
      const assertion = expect(response).rejects.toBeInstanceOf(
        MutationOutcomeUnknownError,
      );
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    () => jsonResponse(503),
    () =>
      new Response('gateway error', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    () =>
      new Response('{broken', {
        headers: { 'content-type': 'application/json' },
      }),
  ])(
    'reports a server or response failure as an uncertain mutation',
    async (makeResponse) => {
      const fetchFn = vi.fn<typeof fetch>(async () => makeResponse());
      const response = transport(fetchFn)('https://example.test/items', {
        method: 'POST',
      });
      const assertion = expect(response).rejects.toMatchObject({
        code: 'MUTATION_OUTCOME_UNKNOWN',
      });
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it('aborts timed out requests and does not retry mutations', async () => {
    let signal: AbortSignal | null | undefined;
    const fetchFn = vi.fn<typeof fetch>(async (_, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => undefined);
    });
    const response = transport(fetchFn)('https://example.test/items', {
      method: 'POST',
    });
    const assertion = expect(response).rejects.toMatchObject({
      code: 'MUTATION_OUTCOME_UNKNOWN',
      originalError: expect.any(CmaRequestTimeoutError),
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('includes response body consumption in the timeout', async () => {
    const response = jsonResponse();
    vi.spyOn(response, 'text').mockImplementation(
      () => new Promise<string>(() => undefined),
    );
    const fetchFn = vi.fn<typeof fetch>(async () => response);
    const result = transport(fetchFn)('https://example.test/items', {
      method: 'POST',
    });
    const assertion = expect(result).rejects.toBeInstanceOf(
      MutationOutcomeUnknownError,
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries a timed-out read by default, but not when told not to', async () => {
    const hang = () => new Promise<Response>(() => undefined);

    const retrying = vi.fn<typeof fetch>(hang);
    const first = transport(retrying, 100)('https://example.test/items');
    const firstAssertion = expect(first).rejects.toBeInstanceOf(
      CmaRequestTimeoutError,
    );
    await vi.runAllTimersAsync();
    await firstAssertion;
    expect(retrying).toHaveBeenCalledTimes(4);

    const single = vi.fn<typeof fetch>(hang);
    const second = createCmaFetch({
      fetchFn: single,
      scheduler: new CmaRequestScheduler(150, 4),
      requestTimeoutMs: 100,
      retryTimeouts: false,
    })('https://example.test/items');
    const secondAssertion = expect(second).rejects.toBeInstanceOf(
      CmaRequestTimeoutError,
    );
    await vi.runAllTimersAsync();
    await secondAssertion;
    expect(single).toHaveBeenCalledTimes(1);
  });

  it('removes cancelled queued requests without dispatching them', async () => {
    const scheduler = new CmaRequestScheduler(150, 1);
    const release = await scheduler.acquire();
    const controller = new AbortController();
    const queued = scheduler.acquire(controller.signal);
    const assertion = expect(queued).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    release();
    await assertion;
    const next = scheduler.acquire();
    await vi.advanceTimersByTimeAsync(150);
    (await next)();
  });

  it('preserves confirmed validation errors without retrying', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse(422));
    const response = transport(fetchFn)('https://example.test/items', {
      method: 'POST',
    });
    await vi.runAllTimersAsync();
    expect((await response).status).toBe(422);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(isMutationOutcomeUnknown(new Error('validation'))).toBe(false);
  });
});

describe('CMA asynchronous job polling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('continues polling 404s with a capped interval', async () => {
    const starts: number[] = [];
    const fetchResult = vi.fn(async () => {
      starts.push(Date.now());
      if (starts.length < 10) throw { response: { status: 404 } };
      return { status: 200, payload: { successful: 200 } };
    });
    const result = pollCmaJob(fetchResult, 'job-1');
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ status: 200 });
    expect(starts.slice(1).map((time, index) => time - starts[index])).toEqual([
      2000, 3000, 4000, 5000, 5000, 5000, 5000, 5000, 5000,
    ]);
  });

  it('bounds a job that never becomes available and keeps its ID', async () => {
    const fetchResult = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const result = pollCmaJob(fetchResult, 'job-unconfirmed', 10_000);
    const assertion = expect(result).rejects.toMatchObject({
      code: 'MUTATION_OUTCOME_UNKNOWN',
      jobId: 'job-unconfirmed',
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchResult).toHaveBeenCalledTimes(3);
  });

  it('does not restart a mutation when job result polling fails', async () => {
    const fetchResult = vi.fn(async () => {
      throw { response: { status: 403 } };
    });
    const result = pollCmaJob(fetchResult, 'job-forbidden');
    const assertion = expect(result).rejects.toBeInstanceOf(JobPollingError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchResult).toHaveBeenCalledTimes(1);
  });

  it('enforces the deadline even when a job result fetch hangs', async () => {
    const fetchResult = vi.fn(() => new Promise<never>(() => undefined));
    const result = pollCmaJob(fetchResult, 'job-hanging', 10_000);
    const assertion = expect(result).rejects.toBeInstanceOf(JobPollingError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchResult).toHaveBeenCalledTimes(1);
  });
});
