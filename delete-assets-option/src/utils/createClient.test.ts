import { ApiError } from '@datocms/cma-client-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createClient,
  createControlledFetch,
  pollAsyncJob,
  RequestTimeoutError,
} from './createClient';

const URL = 'https://example.invalid/test';

function response(status = 200, headers: Record<string, string> = {}) {
  return new Response('{}', {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function apiError(status: number) {
  return new ApiError({
    request: { url: URL, method: 'GET', headers: {} },
    response: { status, statusText: 'Test response', headers: {} },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createControlledFetch', () => {
  it('limits 24 competing requests to four in flight and spaces every start by 100ms', async () => {
    let active = 0;
    let maximumActive = 0;
    const starts: number[] = [];
    const fetchFn = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      active -= 1;
      return response();
    });
    const controlledFetch = createControlledFetch({ fetchFn, random: () => 0 });

    const result = Promise.all(
      Array.from({ length: 24 }, () => controlledFetch(URL)),
    );
    await vi.runAllTimersAsync();
    await result;

    expect(maximumActive).toBe(4);
    expect(fetchFn).toHaveBeenCalledTimes(24);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(100);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds the concurrency slot until the response body finishes', async () => {
    let bodiesReading = 0;
    let maximumBodiesReading = 0;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      bodiesReading += 1;
      maximumBodiesReading = Math.max(maximumBodiesReading, bodiesReading);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            setTimeout(() => {
              bodiesReading -= 1;
              controller.enqueue(new TextEncoder().encode('{}'));
              controller.close();
            }, 1000);
          },
        }),
      );
    });
    const controlledFetch = createControlledFetch({ fetchFn });
    const result = Promise.all(
      Array.from({ length: 12 }, () => controlledFetch(URL)),
    );

    await vi.runAllTimersAsync();
    await result;

    expect(maximumBodiesReading).toBe(4);
    expect(fetchFn).toHaveBeenCalledTimes(12);
  });

  it('retries a POST rejected with 429 and applies server cooldown to other requests', async () => {
    const starts: number[] = [];
    const fetchFn = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      return starts.length === 1
        ? response(429, { 'x-ratelimit-reset': '2', 'retry-after': '3' })
        : response();
    });
    const controlledFetch = createControlledFetch({ fetchFn, random: () => 0 });
    const first = controlledFetch(URL, { method: 'POST', body: '{}' });
    await vi.advanceTimersByTimeAsync(0);
    const second = controlledFetch(URL);

    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(starts).toEqual([0, 3000, 3100]);
    expect(fetchFn.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(
      ['POST', 'GET', 'POST'],
    );
  });

  it('honors a Retry-After HTTP date and bounded jitter', async () => {
    const starts: number[] = [];
    const fetchFn = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      return starts.length === 1
        ? response(429, { 'retry-after': new Date(3000).toUTCString() })
        : response();
    });
    const controlledFetch = createControlledFetch({
      fetchFn,
      random: () => 0.5,
    });
    const result = controlledFetch(URL, { method: 'DELETE' });
    await vi.runAllTimersAsync();
    await result;

    expect(starts).toEqual([0, 3000]);
  });

  it('ignores invalid rate-limit headers and uses exponential backoff with jitter', async () => {
    const starts: number[] = [];
    const fetchFn = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      return starts.length < 3
        ? response(429, {
            'x-ratelimit-reset': 'garbage',
            'retry-after': 'bad date',
          })
        : response();
    });
    const result = createControlledFetch({ fetchFn, random: () => 0.5 })(URL);
    await vi.runAllTimersAsync();
    await result;

    expect(starts).toEqual([0, 1125, 3250]);
  });

  it('retries GET network errors and 5xx responses with a five-attempt maximum', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    fetchFn.mockRejectedValueOnce(new TypeError('Network error'));
    fetchFn.mockResolvedValueOnce(response(503));
    fetchFn.mockResolvedValueOnce(response());
    const result = createControlledFetch({ fetchFn, random: () => 0 })(URL);
    await vi.runAllTimersAsync();
    expect((await result).status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(3);

    const failingFetch = vi.fn<typeof fetch>(async () => response(503));
    const failure = createControlledFetch({
      fetchFn: failingFetch,
      random: () => 0,
    })(URL);
    await vi.runAllTimersAsync();
    expect((await failure).status).toBe(503);
    expect(failingFetch).toHaveBeenCalledTimes(5);
  });

  it('bounds persistent 429 responses to five attempts for mutations too', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => response(429));
    const result = createControlledFetch({ fetchFn, random: () => 0 })(URL, {
      method: 'POST',
    });
    await vi.runAllTimersAsync();

    expect((await result).status).toBe(429);
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'POST',
    'DELETE',
    'PUT',
  ])('does not replay %s after a network error or 5xx response', async (method) => {
    const failure = new TypeError('Network error');
    const networkFetch = vi.fn<typeof fetch>(async () => {
      throw failure;
    });
    const networkResult = createControlledFetch({ fetchFn: networkFetch })(
      URL,
      { method },
    );
    const networkCheck = expect(networkResult).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await networkCheck;
    expect(networkFetch).toHaveBeenCalledTimes(1);

    const serverFetch = vi.fn<typeof fetch>(async () => response(503));
    const serverResult = createControlledFetch({ fetchFn: serverFetch })(URL, {
      method,
    });
    await vi.runAllTimersAsync();
    expect((await serverResult).status).toBe(503);
    expect(serverFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    'GET',
    'POST',
    'DELETE',
  ])('aborts a stalled %s transport after 20 seconds', async (method) => {
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => {});
    });
    const result = createControlledFetch({ fetchFn, random: () => 0 })(URL, {
      method,
    });
    const check = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.runAllTimersAsync();
    await check;

    expect(fetchFn).toHaveBeenCalledTimes(method === 'GET' ? 5 : 1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts an incomplete response body, with no DELETE replay', async () => {
    let transportSignal: AbortSignal | null | undefined;
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      transportSignal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>());
    });
    const result = createControlledFetch({ fetchFn })(URL, {
      method: 'DELETE',
    });
    const check = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(20_000);
    await check;

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(transportSignal?.aborted).toBe(true);
  });

  it('does not retry permission or validation failures, or unrelated exceptions', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const fetchFn = vi.fn<typeof fetch>(async () => response(status));
      const result = createControlledFetch({ fetchFn })(URL);
      // biome-ignore lint/performance/noAwaitInLoops: Each mock advances its fake clock before the next case.
      await vi.runAllTimersAsync();
      expect((await result).status).toBe(status);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
    const failure = new RangeError('Invalid request');
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw failure;
    });
    const check = expect(createControlledFetch({ fetchFn })(URL)).rejects.toBe(
      failure,
    );
    await vi.runAllTimersAsync();
    await check;
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('cancels queued requests without sending them and frees the queue for subsequent requests', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return response();
    });
    const controlledFetch = createControlledFetch({ fetchFn });
    const active = Array.from({ length: 4 }, () => controlledFetch(URL));
    await vi.advanceTimersByTimeAsync(300);
    const controller = new AbortController();
    const queued = controlledFetch(URL, { signal: controller.signal });
    const check = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await check;
    const following = controlledFetch(URL);

    await vi.runAllTimersAsync();
    await Promise.all([...active, following]);
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never starts a retry early when the server cooldown exceeds the total request budget', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      response(429, { 'retry-after': '3600' }),
    );
    const result = createControlledFetch({ fetchFn })(URL, { method: 'POST' });
    const check = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(240_000);
    await check;
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('pollAsyncJob', () => {
  it('polls pending 404 results at one to five second intervals and returns the completed result', async () => {
    const starts: number[] = [];
    const completed = { status: 200, payload: { deleted: ['asset-1'] } };
    const fetcher = vi.fn(async () => {
      starts.push(Date.now());
      if (starts.length < 6) throw apiError(404);
      return completed;
    });
    const result = pollAsyncJob(fetcher);
    await vi.runAllTimersAsync();

    expect(await result).toEqual(completed);
    expect(starts).toEqual([1000, 3000, 6000, 10000, 15000, 20000]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a perpetually pending job after 30 minutes', async () => {
    const fetcher = vi.fn(async () => {
      throw apiError(404);
    });
    const result = pollAsyncJob(fetcher);
    const check = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.runAllTimersAsync();
    await check;

    expect(Date.now()).toBe(30 * 60_000);
    expect(fetcher.mock.calls.length).toBeLessThan(365);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects other API failures and times out a hung job read', async () => {
    const failure = apiError(403);
    const failedFetch = vi.fn(async () => {
      throw failure;
    });
    const failed = expect(pollAsyncJob(failedFetch)).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await failed;
    expect(failedFetch).toHaveBeenCalledTimes(1);

    const stalledFetch = vi.fn(() => new Promise<never>(() => {}));
    const stalled = expect(pollAsyncJob(stalledFetch)).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );
    await vi.runAllTimersAsync();
    await stalled;
    expect(stalledFetch).toHaveBeenCalledTimes(1);
  });
});

describe('createClient', () => {
  it('consumes a 202 job through the SDK without resubmitting the accepted POST', async () => {
    let polls = 0;
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({ data: { type: 'job', id: 'job-1' } }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      polls += 1;
      if (polls < 3) return response(404);
      return new Response(
        JSON.stringify({
          data: {
            type: 'job_result',
            id: 'job-1',
            attributes: { status: 200, payload: { data: [] } },
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const client = createClient({
      currentUserAccessToken: 'test-token',
      environment: 'sandbox',
      cmaBaseUrl: URL,
    });
    // Isolate this integration fixture from the frame-wide production scheduler.
    client.config.fetchFn = createControlledFetch({ fetchFn });
    const result = client.request({
      method: 'POST',
      url: '/uploads/bulk-destroy',
      body: {},
    });
    await vi.runAllTimersAsync();

    expect(await result).toEqual({ data: [] });
    expect(fetchFn.mock.calls.map(([, init]) => init?.method)).toEqual([
      'POST',
      'GET',
      'GET',
      'GET',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves authentication/environment, disables SDK retries/logging, and shares request admission', () => {
    const client = createClient({
      currentUserAccessToken: 'test-token',
      environment: 'sandbox',
      cmaBaseUrl: URL,
    });
    const otherClient = createClient({
      currentUserAccessToken: 'another-token',
      environment: 'other',
      cmaBaseUrl: URL,
    });

    expect(client.config).toMatchObject({
      apiToken: 'test-token',
      environment: 'sandbox',
      baseUrl: URL,
      autoRetry: false,
      logLevel: 0,
      requestTimeout: 300_000,
    });
    expect(client.config.fetchFn).toBe(otherClient.config.fetchFn);
    expect(client.jobResultsFetcher).toBeTypeOf('function');
  });
});
