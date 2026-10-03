import { ApiError } from '@datocms/cma-client-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CmaReadScheduler,
  cancellableRead,
  createCmaReadFetch,
  retryCmaRead,
  retryDelay,
} from './cmaRequests';
import { buildCmaClient, readRecords } from './records';

function apiError(status: number, headers: Record<string, string> = {}) {
  return new ApiError({
    request: { url: '/items', method: 'GET', headers: {} },
    response: {
      status,
      statusText: 'Unavailable',
      headers,
      body: { data: [] },
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bounded CMA reads', () => {
  it('retries transient reads automatically and honors the CMA reset header', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockRejectedValueOnce(apiError(429, { 'x-ratelimit-reset': '3' }))
      .mockResolvedValue('page');
    const pending = retryCmaRead(request);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('page');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('stops persistent 5xx failures after four attempts', async () => {
    vi.useFakeTimers();
    const error = apiError(503);
    const request = vi.fn().mockRejectedValue(error);
    const pending = retryCmaRead(request);
    const result = expect(pending).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await result;
    expect(request).toHaveBeenCalledTimes(4);
  });

  it.each([
    401, 403, 404,
  ])('does not retry a permanent %i failure', async (status) => {
    const error = apiError(status);
    const request = vi.fn().mockRejectedValue(error);
    await expect(retryCmaRead(request)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('cancels a retry backoff without sending another request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = vi
      .fn()
      .mockRejectedValue(apiError(429, { 'x-ratelimit-reset': '3' }));
    const pending = retryCmaRead(request, controller.signal);
    const result = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.runAllTimersAsync();
    await result;
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares request pacing and rate-limit cooldown between readers', async () => {
    vi.useFakeTimers();
    const scheduler = new CmaReadScheduler();
    await scheduler.beforeRead();
    const second = vi.fn();
    const waiting = scheduler.beforeRead().then(second);
    scheduler.rateLimited(3_000);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(second).toHaveBeenCalledOnce();
  });

  it('reads Retry-After dates and defaults to exponential backoff', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(
      retryDelay(
        apiError(429, { 'retry-after': 'Thu, 01 Jan 2026 00:00:05 GMT' }),
        0,
      ),
    ).toBe(5_000);
    expect(retryDelay(new TypeError('Offline'), 2)).toBe(4_000);
    expect(retryDelay(apiError(429, { 'retry-after': '120' }), 0)).toBe(
      120_000,
    );
  });

  it('keeps a final 429 cooldown for the next model after the retry budget is exhausted', async () => {
    vi.useFakeTimers();
    const scheduler = new CmaReadScheduler();
    const error = apiError(429, { 'x-ratelimit-reset': '3' });
    const pending = retryCmaRead(
      vi.fn().mockRejectedValue(error),
      undefined,
      scheduler,
    );
    const failed = expect(pending).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(9_000);
    await failed;
    const next = vi.fn();
    const nextModel = scheduler.beforeRead().then(next);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(next).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await nextModel;
    expect(next).toHaveBeenCalledOnce();
  });

  it('bounds host promises that never settle and removes abort listeners', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = cancellableRead(
      new Promise<never>(() => {}),
      controller.signal,
      50,
    );
    const result = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(50);
    await result;
    expect(remove).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('CMA transport cancellation and response deadline', () => {
  it('retries transport timeouts four times without the outer guard winning or overlapping requests', async () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    const fetchFn = vi.fn(
      ((_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          active += 1;
          peak = Math.max(active, peak);
          init?.signal?.addEventListener(
            'abort',
            () => {
              active -= 1;
              reject(new DOMException('Request aborted', 'AbortError'));
            },
            { once: true },
          );
        })) as typeof fetch,
    );
    vi.stubGlobal('fetch', fetchFn);
    const client = buildCmaClient({
      currentUserAccessToken: 'synthetic-test-token',
      environment: 'test',
    });
    const pending = readRecords(client, 'article').next();
    const failure = expect(pending).rejects.toMatchObject({
      name: 'CmaReadTimeoutError',
    });
    await vi.runAllTimersAsync();
    await failure;
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(peak).toBe(1);
    expect(active).toBe(0);
  });

  it('passes abort to the actual fetch and observes ignored late outcomes', async () => {
    const controller = new AbortController();
    let transportSignal: AbortSignal | undefined;
    let rejectLate: ((error: Error) => void) | undefined;
    const fetchFn = vi.fn(((_input, init) => {
      transportSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        rejectLate = reject;
      });
    }) as typeof fetch);
    const pending = createCmaReadFetch(controller.signal, fetchFn)('/items');
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(transportSignal?.aborted).toBe(true);
    rejectLate?.(new Error('Late transport failure'));
    await Promise.resolve();
  });

  it('bounds a response body that stalls after its headers arrived', async () => {
    vi.useFakeTimers();
    let transportSignal: AbortSignal | undefined;
    const fetchFn = vi.fn((async (_input, init) => {
      transportSignal = init?.signal ?? undefined;
      return {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
      } as Response;
    }) as typeof fetch);
    const pending = createCmaReadFetch(undefined, fetchFn, 50)('/items');
    const result = expect(pending).rejects.toMatchObject({
      name: 'CmaReadTimeoutError',
    });
    await vi.advanceTimersByTimeAsync(50);
    await result;
    expect(transportSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves JSON response status and headers after consuming the body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('{"meta":{"total_count":200000}}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-ratelimit-remaining': '40',
        },
      }),
    );
    const response = await createCmaReadFetch(undefined, fetchFn)('/items');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ratelimit-remaining')).toBe('40');
    expect(await response.json()).toEqual({ meta: { total_count: 200_000 } });
  });
});
