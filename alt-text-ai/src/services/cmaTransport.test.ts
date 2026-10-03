import { buildClient } from '@datocms/cma-client-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCmaFetch } from './cmaTransport';

function jsonResponse(status = 200, headers: HeadersInit = {}): Response {
  return new Response('{"data":{"id":"upload-id"}}', {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function pendingResponse(): Promise<Response> {
  return new Promise(() => {});
}

beforeEach(() => {
  vi.useFakeTimers({ loopLimit: 100_000 });
  vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The synthetic 10,000-asset fixture also runs under heavy concurrent plugin checks.
// Transport deadlines are asserted using fake time, independently of wall time.
describe('createCmaFetch', { timeout: 60_000 }, () => {
  it('obtains fetch at request time so a shared instance can use test mocks', async () => {
    const fetchFn = createCmaFetch();
    const networkFetch = vi.fn<typeof fetch>(async () => jsonResponse());
    vi.stubGlobal('fetch', networkFetch);

    const response = await fetchFn('https://cma.example/uploads/1');

    expect(await response.json()).toEqual({ data: { id: 'upload-id' } });
    expect(networkFetch).toHaveBeenCalledOnce();
  });

  it('limits active network requests even when more than three callers enqueue work', async () => {
    let active = 0;
    let peakActive = 0;
    const networkFetch = vi.fn<typeof fetch>(async () => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise((resolve) => setTimeout(resolve, 500));
      active -= 1;
      return jsonResponse();
    });
    vi.stubGlobal('fetch', networkFetch);
    const fetchFn = createCmaFetch();
    const requests = Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        fetchFn(`https://cma.example/uploads/${index}`),
      ),
    );

    await vi.runAllTimersAsync();
    await requests;

    expect(peakActive).toBe(3);
    expect(networkFetch).toHaveBeenCalledTimes(8);
  });

  it('processes 10,000 synthetic assets with three workers and paced requests', async () => {
    const starts: number[] = [];
    let active = 0;
    let peakActive = 0;
    let completed = 0;
    let nextAsset = 0;
    const networkFetch = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise((resolve) => setTimeout(resolve, 250));
      active -= 1;
      return jsonResponse();
    });
    vi.stubGlobal('fetch', networkFetch);
    const fetchFn = createCmaFetch();
    const work = Promise.all(
      Array.from({ length: 3 }, async () => {
        while (nextAsset < 10_000) {
          const asset = nextAsset++;
          // biome-ignore lint/performance/noAwaitInLoops: Three workers deliberately bound concurrency for the entire asset selection.
          const response = await fetchFn(
            `https://cma.example/uploads/${asset}`,
          );
          await response.json();
          completed += 1;
        }
      }),
    );

    await vi.runAllTimersAsync();
    await work;

    expect(completed).toBe(10_000);
    expect(networkFetch).toHaveBeenCalledTimes(10_000);
    expect(peakActive).toBe(3);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(100);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares a 429 cooldown with queued callers without releasing a burst', async () => {
    const starts: number[] = [];
    const baseTime = Date.now();
    const cancelBody = vi.fn();
    const networkFetch = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now() - baseTime);
      if (starts.length === 1) {
        return new Response(new ReadableStream({ cancel: cancelBody }), {
          status: 429,
          headers: { 'x-ratelimit-reset': '2', 'retry-after': '3' },
        });
      }
      return jsonResponse();
    });
    vi.stubGlobal('fetch', networkFetch);
    const fetchFn = createCmaFetch();
    const work = Promise.all([
      fetchFn('https://cma.example/uploads/1', { method: 'PUT', body: '{}' }),
      fetchFn('https://cma.example/uploads/2'),
      fetchFn('https://cma.example/uploads/3'),
    ]);

    await vi.advanceTimersByTimeAsync(2999);
    expect(starts).toEqual([0]);
    expect(cancelBody).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    await work;

    expect(starts).toEqual([0, 3000, 3100, 3200]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('respects Retry-After HTTP dates', async () => {
    const baseTime = Date.now();
    const starts: number[] = [];
    const networkFetch = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now() - baseTime);
      return starts.length === 1
        ? jsonResponse(429, {
            'retry-after': new Date(baseTime + 2000).toUTCString(),
          })
        : jsonResponse();
    });
    vi.stubGlobal('fetch', networkFetch);
    const request = createCmaFetch()('https://cma.example/uploads/1');

    await vi.runAllTimersAsync();
    await request;

    expect(starts).toEqual([0, 2000]);
  });

  it('retries GET network errors and 5xx responses with bounded backoff', async () => {
    const baseTime = Date.now();
    const starts: number[] = [];
    const networkFetch = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now() - baseTime);
      if (starts.length === 1) throw new TypeError('Failed to fetch');
      if (starts.length === 2) return jsonResponse(503, { 'retry-after': '2' });
      return jsonResponse();
    });
    vi.stubGlobal('fetch', networkFetch);
    const request = createCmaFetch()('https://cma.example/uploads/1');

    await vi.runAllTimersAsync();
    const response = await request;

    expect(starts).toEqual([0, 1000, 3000]);
    expect(await response.json()).toEqual({ data: { id: 'upload-id' } });
  });

  it('stops repeated GET 5xx failures after three attempts', async () => {
    const networkFetch = vi.fn<typeof fetch>(async () => jsonResponse(503));
    vi.stubGlobal('fetch', networkFetch);
    const request = createCmaFetch()('https://cma.example/uploads/1');

    await vi.runAllTimersAsync();
    const response = await request;

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ data: { id: 'upload-id' } });
    expect(networkFetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not replay an uncertain PUT network failure', async () => {
    const networkError = new TypeError('Failed to fetch');
    const networkFetch = vi.fn<typeof fetch>(async () => {
      throw networkError;
    });
    vi.stubGlobal('fetch', networkFetch);

    await expect(
      createCmaFetch()('https://cma.example/uploads/1', {
        method: 'PUT',
        body: '{}',
      }),
    ).rejects.toBe(networkError);

    expect(networkFetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not replay a PUT 5xx response', async () => {
    const networkFetch = vi.fn<typeof fetch>(async () => jsonResponse(503));
    vi.stubGlobal('fetch', networkFetch);
    const response = await createCmaFetch()('https://cma.example/uploads/1', {
      method: 'PUT',
      body: '{}',
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ data: { id: 'upload-id' } });
    expect(networkFetch).toHaveBeenCalledOnce();
  });

  it('aborts the actual PUT signal after 30 seconds without replaying it', async () => {
    let requestSignal: AbortSignal | null | undefined;
    const networkFetch = vi.fn<typeof fetch>((_input, init) => {
      requestSignal = init?.signal;
      return pendingResponse();
    });
    vi.stubGlobal('fetch', networkFetch);
    const outcome = createCmaFetch()('https://cma.example/uploads/1', {
      method: 'PUT',
      body: '{}',
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(30_000);
    const error = await outcome;

    expect(error).toMatchObject({ name: 'TimeoutError' });
    expect(requestSignal?.aborted).toBe(true);
    expect(networkFetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled JSON response body and does not replay the PUT', async () => {
    const response = jsonResponse();
    vi.spyOn(response, 'text').mockImplementation(() => new Promise(() => {}));
    let requestSignal: AbortSignal | null | undefined;
    const networkFetch = vi.fn<typeof fetch>(async (_input, init) => {
      requestSignal = init?.signal;
      return response;
    });
    vi.stubGlobal('fetch', networkFetch);
    const outcome = createCmaFetch()('https://cma.example/uploads/1', {
      method: 'PUT',
      body: '{}',
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(await outcome).toMatchObject({ name: 'TimeoutError' });
    expect(requestSignal?.aborted).toBe(true);
    expect(networkFetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can retry a GET after its response body stalls', async () => {
    const stalled = jsonResponse();
    vi.spyOn(stalled, 'text').mockImplementation(() => new Promise(() => {}));
    const networkFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(stalled)
      .mockResolvedValueOnce(jsonResponse());
    vi.stubGlobal('fetch', networkFetch);
    const request = createCmaFetch()('https://cma.example/uploads/1');

    await vi.runAllTimersAsync();
    const response = await request;

    expect(await response.json()).toEqual({ data: { id: 'upload-id' } });
    expect(networkFetch).toHaveBeenCalledTimes(2);
  });

  it('caps the total lifetime including a long server cooldown at 120 seconds', async () => {
    const networkFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse(429, {
        'x-ratelimit-reset': '180',
      }),
    );
    vi.stubGlobal('fetch', networkFetch);
    const outcome = createCmaFetch()('https://cma.example/uploads/1').catch(
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(119_999);
    expect(networkFetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toMatchObject({ name: 'TimeoutError' });
    expect(networkFetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not overflow a very long Retry-After timer into an immediate retry', async () => {
    const networkFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse(429, {
        'retry-after': '3000000',
      }),
    );
    vi.stubGlobal('fetch', networkFetch);
    const outcome = createCmaFetch()('https://cma.example/uploads/1').catch(
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(120_000);

    expect(await outcome).toMatchObject({ name: 'TimeoutError' });
    expect(networkFetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds GET timeout retries and aborts every timed-out attempt', async () => {
    const signals: AbortSignal[] = [];
    const networkFetch = vi.fn<typeof fetch>((_input, init) => {
      if (init?.signal) signals.push(init.signal);
      return pendingResponse();
    });
    vi.stubGlobal('fetch', networkFetch);
    const outcome = createCmaFetch()('https://cma.example/uploads/1').catch(
      (error: unknown) => error,
    );

    await vi.runAllTimersAsync();

    expect(await outcome).toMatchObject({ name: 'TimeoutError' });
    expect(networkFetch).toHaveBeenCalledTimes(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('integrates PUT timeouts with the real SDK without numeric DOMException codes', async () => {
    const networkFetch = vi.fn<typeof fetch>((input, init) => {
      // CMA 6 consults environment metadata before serializing upload patches.
      if (new URL(String(input)).pathname === '/site' && init?.method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({
          data: { id: 'synthetic-site', type: 'site', attributes: { locales: ['en'] },
            meta: { non_localized_focal_points: true } },
        }), { headers: { 'content-type': 'application/json' } }));
      }
      return pendingResponse();
    });
    vi.stubGlobal('fetch', networkFetch);
    const client = buildClient({
      apiToken: 'synthetic-token',
      baseUrl: 'https://cma.example',
      autoRetry: false,
      requestTimeout: 125_000,
      fetchFn: createCmaFetch(),
    });
    const outcome = client.uploads
      .update('synthetic-upload', {
        default_field_metadata: { alt: { en: 'Synthetic description' } },
      })
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(30_100);
    const error = await outcome;

    expect(error).toMatchObject({
      name: 'TimeoutError',
      message: 'The CMA request timed out.',
    });
    expect(error).not.toHaveProperty('code');
    expect(networkFetch).toHaveBeenCalledTimes(2);
    expect(networkFetch.mock.calls[1][1]?.method).toBe('PUT');
    await vi.runAllTimersAsync();
  });

  it('integrates caller DOMException cancellation with the real SDK', async () => {
    const networkFetch = vi.fn<typeof fetch>(() => pendingResponse());
    vi.stubGlobal('fetch', networkFetch);
    const controller = new AbortController();
    const transport = createCmaFetch();
    const client = buildClient({
      apiToken: 'synthetic-token',
      baseUrl: 'https://cma.example',
      autoRetry: false,
      requestTimeout: 125_000,
      fetchFn: (input, init) =>
        transport(input, { ...init, signal: controller.signal }),
    });
    const outcome = client.uploads
      .find('synthetic-upload')
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new DOMException('Synthetic cancellation', 'AbortError'));
    const error = await outcome;

    expect(error).toMatchObject({
      name: 'AbortError',
      message: 'Synthetic cancellation',
    });
    expect(error).not.toHaveProperty('code');
    expect(networkFetch).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
  });

  it('cancels a queued request before it reaches the network', async () => {
    const networkFetch = vi.fn<typeof fetch>(async () => jsonResponse());
    vi.stubGlobal('fetch', networkFetch);
    const fetchFn = createCmaFetch();
    const first = fetchFn('https://cma.example/uploads/1');
    const controller = new AbortController();
    const outcome = fetchFn('https://cma.example/uploads/2', {
      signal: controller.signal,
    }).catch((error: unknown) => error);
    controller.abort();

    await first;
    await vi.runAllTimersAsync();

    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(networkFetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates caller cancellation to an active network request', async () => {
    let requestSignal: AbortSignal | null | undefined;
    const networkFetch = vi.fn<typeof fetch>((_input, init) => {
      requestSignal = init?.signal;
      return pendingResponse();
    });
    vi.stubGlobal('fetch', networkFetch);
    const controller = new AbortController();
    const outcome = createCmaFetch()('https://cma.example/uploads/1', {
      signal: controller.signal,
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(requestSignal?.aborted).toBe(true);
    expect(networkFetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
