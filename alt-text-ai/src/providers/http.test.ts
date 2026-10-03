import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFatalProviderFailure, parseRetryAfter } from './errors';
import { readBoundedResponseBytes, ResponseTooLargeError } from './http';
import { fetchProviderJson } from './shared';

function jsonResponse(
  payload: unknown,
  status = 200,
  retryAfter?: string,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('bounded provider HTTP requests', () => {
  it.each([
    [401, 'auth'],
    [402, 'quota'],
    [429, 'rate_limit'],
  ])('preserves HTTP %s when the error body exceeds the byte limit', async (status, code) => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response('error', {
          status,
          headers: { 'Content-Length': String(9 * 1024 * 1024) },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const assertion = expect(
      fetchProviderJson(
        'openai',
        `https://oversized-error-${status}.example/responses`,
        { method: 'POST' },
      ),
    ).rejects.toMatchObject({ status, code });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(status === 429 ? 4 : 1);
  });

  it.each([
    [401, 'auth'],
    [429, 'rate_limit'],
  ])('preserves confirmed HTTP %s when the error body stalls until the deadline', async (status, code) => {
    const cancel = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(new ReadableStream<Uint8Array>({ cancel }), { status }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const assertion = expect(
      fetchProviderJson(
        'openai',
        `https://stalled-error-${status}.example/responses`,
        { method: 'POST' },
      ),
    ).rejects.toMatchObject({ status, code });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(status === 429 ? 2 : 1);
    expect(cancel).toHaveBeenCalledTimes(status === 429 ? 2 : 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('distinguishes Gemini minute quotas from exhausted credits and honors RetryInfo', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              message:
                'You exceeded your current quota, please check your billing details.',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                  violations: [
                    { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' },
                  ],
                },
                {
                  '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                  retryDelay: '8s',
                },
              ],
            },
          },
          429,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ text: 'Success' }));
    vi.stubGlobal('fetch', fetchMock);
    const request = fetchProviderJson(
      'gemini',
      'https://minute-quota.example/generateContent',
      { method: 'POST' },
    );
    await vi.advanceTimersByTimeAsync(7999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toEqual({ text: 'Success' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    '5',
    new Date(5000).toUTCString(),
  ])('honors Retry-After %s before repeating a rejected paid request', async (retryAfter) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: 'Too many requests' } },
          429,
          retryAfter,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ text: 'Success' }));
    vi.stubGlobal('fetch', fetchMock);
    const request = fetchProviderJson(
      'openai',
      'https://minimum-delay.example/responses',
      { method: 'POST', body: '{}' },
    );
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toEqual({ text: 'Success' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares rate-limit cooldown with other requests to the same provider', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Too many requests' } }, 429, '10'),
      )
      .mockImplementation(async () => jsonResponse({ text: 'Success' }));
    vi.stubGlobal('fetch', fetchMock);
    const first = fetchProviderJson(
      'openai',
      'https://shared-cooldown.example/responses',
      { method: 'POST' },
    );
    await vi.advanceTimersByTimeAsync(0);
    const second = fetchProviderJson(
      'openai',
      'https://shared-cooldown.example/responses',
      { method: 'POST' },
    );
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not shorten a server delay that exceeds its automatic retry budget', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { message: 'Too many requests' } }, 429, '180'),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchProviderJson('openai', 'https://excessive-delay.example/responses', {
        method: 'POST',
      }),
    ).rejects.toMatchObject({ code: 'rate_limit', retryAfterMs: 180_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps repeated rate-limit rejections at four attempts', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        jsonResponse({ error: { message: 'Too many requests' } }, 429),
      );
    vi.stubGlobal('fetch', fetchMock);
    const assertion = expect(
      fetchProviderJson('anthropic', 'https://attempt-limit.example/messages', {
        method: 'POST',
      }),
    ).rejects.toMatchObject({ code: 'rate_limit' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    [401, { message: 'Invalid key' }, 'auth'],
    [402, { message: 'Payment required' }, 'quota'],
    [429, { code: 'insufficient_quota', message: 'Request failed' }, 'quota'],
    [
      429,
      {
        message: 'Request failed',
        details: { error_code: 'enforced_spend_limit_reached' },
      },
      'quota',
    ],
    [429, { message: 'Daily quota exhausted' }, 'quota'],
    [404, { message: 'Model not found' }, 'model'],
    [503, { message: 'Service unavailable' }, 'provider'],
  ])('does not repeat terminal or ambiguous paid HTTP %s errors', async (status, error, code) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error }, status));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchProviderJson(
        'openai',
        'https://terminal-failure.example/responses',
        { method: 'POST' },
      ),
    ).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a paid request whose network outcome is unknown', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Connection lost'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchProviderJson(
        'openai',
        'https://ambiguous-outcome.example/responses',
        { method: 'POST' },
      ),
    ).rejects.toMatchObject({ code: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a read-only network failure automatically', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Connection lost'))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const request = fetchProviderJson(
      'openai',
      'https://read-only.example/models',
      {},
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expect(request).resolves.toEqual({ data: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels a retry wait without sending another paid request', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { message: 'Too many requests' } }, 429, '20'),
      );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const assertion = expect(
      fetchProviderJson('openai', 'https://cancel-wait.example/responses', {
        method: 'POST',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not send requests with an already canceled signal', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchProviderJson(
        'openai',
        'https://already-canceled.example/responses',
        { method: 'POST', signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('terminates a hung paid request and aborts its fetch without repeating it', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const assertion = expect(
      fetchProviderJson('openai', 'https://timeout.example/responses', {
        method: 'POST',
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an actual byte stream as soon as it exceeds the read limit', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.enqueue(new Uint8Array([5, 6, 7, 8]));
        },
        cancel,
      }),
    );
    await expect(readBoundedResponseBytes(response, 6)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('stops reading a hung response body when its request is canceled', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));
    const controller = new AbortController();
    const assertion = expect(
      readBoundedResponseBytes(response, 6, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('HTTP failure metadata', () => {
  it('identifies terminal provider failures without treating isolated failures as fatal', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { message: 'Invalid key' } }, 401),
      );
    vi.stubGlobal('fetch', fetchMock);
    const failure = await fetchProviderJson(
      'openai',
      'https://fatal.example/responses',
      { method: 'POST' },
    ).catch((error: unknown) => error);
    expect(isFatalProviderFailure(failure)).toBe(true);
    expect(isFatalProviderFailure(new Error('Connection lost'))).toBe(false);
  });

  it('rejects invalid or negative Retry-After values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('invalid')).toBeUndefined();
    expect(parseRetryAfter('-1')).toBeUndefined();
    expect(parseRetryAfter('0.25')).toBe(250);
  });
});
