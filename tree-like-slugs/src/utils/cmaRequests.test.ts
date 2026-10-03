import { LogLevel, TimeoutError } from '@datocms/cma-client-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTreeClient,
  createPacedFetch,
  isRetryableError,
  isStaleVersionError,
  RETRY_ATTEMPTS,
  readWithRetry,
  retryDelay,
  throwIfAborted,
  waitForRetry,
} from './cmaRequests';

function apiError(
  status: number,
  headers: Record<string, string> | Headers = {},
  attributes: Record<string, unknown>[] = [],
) {
  return {
    response: {
      status,
      headers,
      body: { data: attributes.map((value) => ({ attributes: value })) },
    },
  };
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) throw new Error('Missing promise resolver');
      resolvePromise(value);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('buildTreeClient', () => {
  it('shares global pacing and leaves retries to the read/write callers', () => {
    const options = {
      apiToken: 'test-only',
      environment: 'sandbox',
      baseUrl: 'https://cma.test',
    };
    const first = buildTreeClient(options);
    const second = buildTreeClient(options);

    expect(first.config).toMatchObject({
      ...options,
      autoRetry: false,
      requestTimeout: 60_000,
      logLevel: LogLevel.NONE,
    });
    expect(first.config.fetchFn).toBe(second.config.fetchFn);
  });

  it('does not let a native AbortError be masked by the CMA transport', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(
          new DOMException('private network detail', 'AbortError'),
        ),
    );
    const client = buildTreeClient({
      apiToken: 'test-only',
      environment: 'sandbox',
      baseUrl: 'https://cma.test',
    });

    await expect(client.items.rawFind('test-record')).rejects.toMatchObject({
      name: 'AbortError',
      message: 'The operation was cancelled.',
    });
    // The installed transport retains its own timeout after rejected fetches.
    await vi.advanceTimersByTimeAsync(60_000);
  });
});

describe('createPacedFetch', () => {
  it('spaces concurrent starts without waiting for previous responses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const gate = deferred<void>();
    const starts: number[] = [];
    const fetchFn = vi.fn<typeof fetch>(() => {
      starts.push(Date.now());
      return gate.promise.then(() => Response.json({ ok: true }));
    });
    const fetch = createPacedFetch({ fetchFn });
    const requests = Promise.all([
      fetch('https://cma.test/first'),
      fetch('https://cma.test/second'),
      fetch('https://cma.test/third'),
    ]);

    await vi.advanceTimersByTimeAsync(200);
    expect(starts).toEqual([0, 100, 200]);
    gate.resolve(undefined);
    expect(await requests).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses actual wake times after a delayed timer instead of bunching starts', async () => {
    let now = 0;
    const starts: number[] = [];
    const fetch = createPacedFetch({
      now: () => now,
      wait: async (milliseconds) => {
        now += milliseconds + 250;
      },
      fetchFn: async () => {
        starts.push(now);
        return Response.json({ ok: true });
      },
    });

    await Promise.all(
      Array.from({ length: 4 }, () => fetch('https://cma.test/item')),
    );
    expect(starts).toEqual([0, 350, 700, 1050]);
  });

  it('aborts and settles a fetch that never returns, even if fetch ignores abort', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null | undefined;
    const fetch = createPacedFetch({
      fetchFn: async (_input, init) => {
        requestSignal = init?.signal;
        return new Promise<Response>(() => undefined);
      },
    });
    const rejection = expect(
      fetch('https://cma.test/item'),
    ).rejects.toMatchObject({ name: 'TimeoutError' });

    await vi.advanceTimersByTimeAsync(45_000);
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('includes response body reading in the timeout', async () => {
    vi.useFakeTimers();
    const response = Response.json({ ok: true });
    vi.spyOn(response, 'arrayBuffer').mockImplementation(
      () => new Promise<ArrayBuffer>(() => undefined),
    );
    const fetch = createPacedFetch({
      fetchFn: async () => response,
      timeoutMs: 250,
    });
    const rejection = expect(
      fetch('https://cma.test/item'),
    ).rejects.toMatchObject({ name: 'TimeoutError' });

    await vi.advanceTimersByTimeAsync(250);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'fetch',
    'body',
  ])('normalizes native %s abort rejections during a timeout', async (phase) => {
    vi.useFakeTimers();
    const fetch = createPacedFetch({
      timeoutMs: 250,
      fetchFn: async (_input, init) => {
        const aborted = new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () =>
              reject(new DOMException('private network detail', 'AbortError')),
            { once: true },
          );
        });
        if (phase === 'fetch') return aborted;
        const response = Response.json({ ok: true });
        vi.spyOn(response, 'arrayBuffer').mockImplementation(() => aborted);
        return response;
      },
    });
    const failure = fetch('https://cma.test/item').catch(
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(250);
    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'TimeoutError',
      message: 'The DatoCMS request timed out.',
    });
    expect(error).not.toHaveProperty('code');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves response status, headers, JSON and bodyless responses', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { data: [1, 2] },
          { status: 429, headers: { 'X-RateLimit-Reset': '3' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const fetch = createPacedFetch({ fetchFn, intervalMs: 0 });

    const first = await fetch('https://cma.test/item');
    expect(first.status).toBe(429);
    expect(first.headers.get('x-ratelimit-reset')).toBe('3');
    expect(await first.json()).toEqual({ data: [1, 2] });
    const second = await fetch('https://cma.test/item', { method: 'PUT' });
    expect(second.status).toBe(204);
    expect(second.body).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('cancels a queued request immediately and allows the queue to continue', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: number[] = [];
    const fetchFn = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      return Response.json({ ok: true });
    });
    const fetch = createPacedFetch({ fetchFn });
    await fetch('https://cma.test/first');
    const controller = new AbortController();
    const cancelled = expect(
      fetch('https://cma.test/second', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort('private cancellation reason');
    await cancelled;
    const third = fetch('https://cma.test/third');
    await vi.advanceTimersByTimeAsync(100);
    await third;
    expect(starts).toEqual([0, 100]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards cancellation to the in-flight network request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let networkSignal: AbortSignal | null | undefined;
    const fetch = createPacedFetch({
      fetchFn: async (_input, init) => {
        networkSignal = init?.signal;
        return new Promise<Response>(() => undefined);
      },
    });
    const result = expect(
      fetch(
        new Request('https://cma.test/item', { signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await result;
    expect(networkSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('observes a response rejected while cancellation wins the start race', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = createPacedFetch({
      fetchFn: async () => {
        controller.abort();
        return Response.json({ ok: true });
      },
    });

    await expect(
      fetch('https://cma.test/item', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('retry classification', () => {
  it.each([
    401, 403, 404, 422,
  ])('treats HTTP %s as terminal even if marked transient', (status) => {
    expect(isRetryableError(apiError(status, {}, [{ transient: true }]))).toBe(
      false,
    );
  });

  it.each([408, 429, 500, 502, 503, 504])('retries HTTP %s', (status) => {
    expect(isRetryableError(apiError(status))).toBe(true);
  });

  it('classifies transport errors without inspecting or serializing messages', () => {
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
    expect(
      isRetryableError(
        new TimeoutError({
          request: { method: 'GET', url: 'https://cma.test', headers: {} },
        }),
      ),
    ).toBe(true);
    expect(isRetryableError({ name: 'TimeoutError' })).toBe(true);
    expect(isRetryableError({ name: 'AbortError', code: 20 })).toBe(true);
    expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryableError(new Error('ordinary application error'))).toBe(
      false,
    );
    expect(isRetryableError(apiError(400))).toBe(false);
  });

  it('detects optimistic-lock errors structurally', () => {
    expect(
      isStaleVersionError(apiError(422, {}, [{ code: 'STALE_ITEM_VERSION' }])),
    ).toBe(true);
    expect(
      isStaleVersionError({
        errors: [{ attributes: { code: 'STALE_ITEM_VERSION' } }],
      }),
    ).toBe(true);
    expect(
      isStaleVersionError({
        findError: (code: string) => code === 'STALE_ITEM_VERSION',
      }),
    ).toBe(true);
    expect(
      isStaleVersionError({
        findError: () => {
          throw new Error('unsupported');
        },
      }),
    ).toBe(false);
    expect(isStaleVersionError(new Error('STALE_ITEM_VERSION'))).toBe(false);
  });
});

describe('retryDelay and waitForRetry', () => {
  it('applies exponential bounded backoff with jitter', () => {
    expect(retryDelay(undefined, 0, () => 0)).toBe(800);
    expect(retryDelay(undefined, 1, () => 0.5)).toBe(2000);
    expect(retryDelay(undefined, 20, () => 0.5)).toBe(30_000);
  });

  it('respects rate reset seconds and both Retry-After formats case-insensitively', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    expect(
      retryDelay(
        apiError(429, { 'X-RateLimit-Reset': '7', 'Retry-After': '5' }),
        0,
        () => 0.5,
      ),
    ).toBe(7000);
    expect(
      retryDelay(
        apiError(
          503,
          new Headers({ 'Retry-After': 'Fri, 02 Oct 2026 00:00:12 GMT' }),
        ),
        0,
        () => 0.5,
      ),
    ).toBe(12_000);
    expect(
      retryDelay(
        apiError(429, { 'x-ratelimit-reset': '-2', 'retry-after': 'invalid' }),
        0,
        () => 0.5,
      ),
    ).toBe(1000);
  });

  it('does not interpret a numeric Retry-After as an HTTP date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    expect(
      retryDelay(apiError(429, { 'Retry-After': '2' }), 0, () => 0.5),
    ).toBe(2000);
  });

  it('cancels backoff immediately without leaking default timers', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const result = expect(
      waitForRetry(apiError(429), 0, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
    expect(() => throwIfAborted(controller.signal)).toThrow(
      'The operation was cancelled.',
    );
  });

  it('honors a long server delay without overflowing the timer into an immediate retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const settled = vi.fn();
    const pending = waitForRetry(
      apiError(429, { 'Retry-After': '3000000' }),
      0,
      { random: () => 0.5 },
    );
    void pending.then(settled);

    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000_000_000 - 2_147_483_647);
    await pending;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(3_000_000_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('readWithRetry', () => {
  it('retries transient reads automatically and returns the eventual result', async () => {
    const operation = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce(42);
    const wait = vi.fn(async (_milliseconds: number) => undefined);

    expect(await readWithRetry(operation, { wait, random: () => 0.5 })).toBe(
      42,
    );
    expect(operation).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      1000, 2000,
    ]);
  });

  it('makes exactly six total attempts before surfacing the original failure', async () => {
    const error = apiError(429, { 'x-ratelimit-reset': '8' });
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(error);
    const wait = vi.fn(async (_milliseconds: number) => undefined);

    await expect(
      readWithRetry(operation, { wait, random: () => 0.5 }),
    ).rejects.toBe(error);
    expect(RETRY_ATTEMPTS).toBe(6);
    expect(operation).toHaveBeenCalledTimes(6);
    expect(wait).toHaveBeenCalledTimes(5);
  });

  it('does not retry terminal validation failures', async () => {
    const error = apiError(422);
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(error);
    const wait = vi.fn(async (_milliseconds: number) => undefined);

    await expect(readWithRetry(operation, { wait })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('cancels a custom backoff without scheduling another read', async () => {
    const controller = new AbortController();
    const operation = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(apiError(503));
    const reachedBackoff = deferred<void>();
    const result = expect(
      readWithRetry(operation, {
        signal: controller.signal,
        wait: () => {
          reachedBackoff.resolve(undefined);
          return new Promise<void>(() => undefined);
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    await reachedBackoff.promise;
    controller.abort();
    await result;
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
