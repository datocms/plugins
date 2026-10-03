import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLambdaBackupStatus } from './fetchLambdaBackupStatus';
import {
  fetchLambdaText,
  isValidLambdaTimestamp,
  LambdaResponseTooLargeError,
  parseRetryAfterMs,
} from './lambdaHttp';
import { triggerLambdaBackupNow } from './triggerLambdaBackupNow';
import { verifyLambdaHealth } from './verifyLambdaHealth';

const input = { timeoutMs: 1000, headers: {}, body: '{}' };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchLambdaText', () => {
  it('retries a transient safe read with exponential backoff', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('ready'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchLambdaText('https://example.test', {
      ...input,
      retrySafeRead: true,
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).payloadText).toBe('ready');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors Retry-After seconds for a safe read', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '2' },
        }),
      )
      .mockResolvedValueOnce(new Response('ready'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchLambdaText('https://example.test', {
      ...input,
      timeoutMs: 10000,
      retrySafeRead: true,
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).payloadText).toBe('ready');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves HTTP error when Retry-After exceeds the remaining deadline', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '30' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchLambdaText('https://example.test', {
      ...input,
      retrySafeRead: true,
    });
    expect(result.response.status).toBe(429);
    expect(result.payloadText).toBe('rate limited');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps retries and preserves the final HTTP response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async () => new Response('upstream', { status: 502 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pending = fetchLambdaText('https://example.test', {
      ...input,
      retrySafeRead: true,
    });
    await vi.advanceTimersByTimeAsync(750);
    expect((await pending).response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 409, 500])('does not retry HTTP %s', async (status) => {
    const fetchMock = vi.fn(async () => new Response('error', { status }));
    vi.stubGlobal('fetch', fetchMock);
    expect(
      (
        await fetchLambdaText('https://example.test', {
          ...input,
          retrySafeRead: true,
        })
      ).response.status,
    ).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries an ambiguous mutating network failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('connection lost');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchLambdaText('https://example.test', input),
    ).rejects.toThrow('connection lost');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries a mutating transient HTTP response', async () => {
    const fetchMock = vi.fn(
      async () => new Response('rate limited', { status: 429 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(
      (await fetchLambdaText('https://example.test', input)).response.status,
    ).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the same total deadline across retries and a stalled body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(
        new Response(new ReadableStream<Uint8Array>({ cancel })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const pending = fetchLambdaText('https://example.test', {
      ...input,
      retrySafeRead: true,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('decodes UTF-8 sequences split between chunks', async () => {
    const bytes = new TextEncoder().encode('árvore');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(bytes.slice(0, 1));
                controller.enqueue(bytes.slice(1));
                controller.close();
              },
            }),
          ),
      ),
    );
    expect(
      (await fetchLambdaText('https://example.test', input)).payloadText,
    ).toBe('árvore');
  });

  it('bounds response memory and cancels an oversized body without retry', async () => {
    const cancel = vi.fn();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
              controller.enqueue(new Uint8Array(1));
            },
            cancel,
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchLambdaText('https://example.test', {
        ...input,
        retrySafeRead: true,
      }),
    ).rejects.toBeInstanceOf(LambdaResponseTooLargeError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancels retry backoff without starting another request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      throw new TypeError('network');
    });
    vi.stubGlobal('fetch', fetchMock);
    const pending = fetchLambdaText('https://example.test', {
      ...input,
      retrySafeRead: true,
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never sends a request whose caller already aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchLambdaText('https://example.test', {
        ...input,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('endpoint timeout and cancellation contracts', () => {
  const common = {
    baseUrl: 'https://backups.example.test',
    environment: 'main',
    lambdaAuthSecret: 'secret',
  };
  const endpoints = [
    {
      name: 'health',
      timeoutMs: 8000,
      call: (signal?: AbortSignal) =>
        verifyLambdaHealth({ ...common, phase: 'config_mount', signal }),
    },
    {
      name: 'status',
      timeoutMs: 10000,
      call: (signal?: AbortSignal) =>
        fetchLambdaBackupStatus({ ...common, signal }),
    },
    {
      name: 'backup-now',
      timeoutMs: 60000,
      call: (signal?: AbortSignal) =>
        triggerLambdaBackupNow({ ...common, scope: 'daily', signal }),
    },
  ];

  it.each(endpoints)(
    '$name deadline includes consuming the body',
    async ({ call, timeoutMs }) => {
      vi.useFakeTimers();
      const cancel = vi.fn();
      const fetchMock = vi.fn(
        async () => new Response(new ReadableStream<Uint8Array>({ cancel })),
      );
      vi.stubGlobal('fetch', fetchMock);
      const pending = expect(call()).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(timeoutMs);
      await pending;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(endpoints)(
    '$name propagates caller abort instead of a timeout',
    async ({ call }) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const fetchMock = vi.fn(
        async () => new Response(new ReadableStream<Uint8Array>()),
      );
      vi.stubGlobal('fetch', fetchMock);
      const pending = expect(call(controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
      await vi.advanceTimersByTimeAsync(1);
      controller.abort();
      await pending;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('health rejects null JSON as a contract error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('null')),
    );
    await expect(
      verifyLambdaHealth({ ...common, phase: 'config_mount' }),
    ).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });

  it('backup-now remains a single attempt after response body failure', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error('truncated response'));
            },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      triggerLambdaBackupNow({ ...common, scope: 'daily' }),
    ).rejects.toMatchObject({ code: 'NETWORK' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(endpoints)(
    '$name creates no timeout for a missing auth secret',
    async ({ name }) => {
      vi.useFakeTimers();
      const blank = { ...common, lambdaAuthSecret: '' };
      const pending =
        name === 'health'
          ? verifyLambdaHealth({ ...blank, phase: 'config_mount' })
          : name === 'status'
            ? fetchLambdaBackupStatus(blank)
            : triggerLambdaBackupNow({ ...blank, scope: 'daily' });
      await expect(pending).rejects.toMatchObject({
        code: 'MISSING_AUTH_SECRET',
      });
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe('lambda HTTP pure validators', () => {
  it('parses seconds and HTTP dates for Retry-After', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    expect(parseRetryAfterMs('2', now)).toBe(2000);
    expect(parseRetryAfterMs('Fri, 02 Oct 2026 12:00:03 GMT', now)).toBe(3000);
    expect(parseRetryAfterMs('Fri, 02 Oct 2026 11:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfterMs('invalid', now)).toBeNull();
    expect(parseRetryAfterMs(null, now)).toBeNull();
  });

  it.each([
    '2026-10-02T02:05:00.000Z',
    '2024-02-29T12:00:00Z',
    '2026-10-02T04:05:00+02:00',
  ])('accepts valid ISO timestamp %s', (value) => {
    expect(isValidLambdaTimestamp(value)).toBe(true);
  });

  it.each([
    '',
    'yesterday',
    '2026-02-30T00:00:00Z',
    '2026-10-02T24:00:00Z',
    '2026-10-02',
    null,
  ])('rejects malformed timestamp %s', (value) => {
    expect(isValidLambdaTimestamp(value)).toBe(false);
  });
});
