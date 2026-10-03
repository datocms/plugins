import { ApiError, buildClient } from '@datocms/cma-client-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CmaReadTimeoutError, readCma } from './cmaRead';

vi.mock('@datocms/cma-client-browser', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@datocms/cma-client-browser')>();
  return { ...actual, buildClient: vi.fn(actual.buildClient) };
});

const options = {
  apiToken: 'synthetic-token',
  environment: 'main',
  baseUrl: 'https://cma.example.test',
};

const response = (status = 200, headers: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({
      data:
        status === 200
          ? [
              {
                id: 'main',
                type: 'environment',
                attributes: { name: 'Main', primary: true },
              },
            ]
          : [],
    }),
    { status, headers: { 'Content-Type': 'application/json', ...headers } },
  );

const successfulResponse = response();

const readEnvironments = (signal?: AbortSignal) =>
  readCma({ ...options, signal }, async (client) => {
    // Exercise the SDK transport/body handling without its lazy environment
    // deserializer; this suite tests the wrapper, not generated serializers.
    const result = await client.request<{ data: Array<{ id: string }> }>({
      method: 'GET',
      url: '/environments',
    });
    return result.data;
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(buildClient).mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readCma', () => {
  it('targets the requested environment with SDK retries disabled and a fetch signal', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(successfulResponse);
    vi.stubGlobal('fetch', fetchMock);

    expect(
      (await readEnvironments()).map((environment) => environment.id),
    ).toEqual(['main']);
    expect(buildClient).toHaveBeenCalledWith({
      ...options,
      autoRetry: false,
      requestTimeout: 10000,
      fetchFn: expect.any(Function),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://cma.example.test/environments',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      signal: expect.any(AbortSignal),
      headers: { 'x-environment': 'main' },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for both rate limit headers before retrying a 429', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(429, { 'X-RateLimit-Reset': '2', 'Retry-After': '3' }),
      )
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetchMock);

    const promise = readEnvironments();
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await promise).map((environment) => environment.id)).toEqual([
      'main',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors HTTP-date Retry-After values', async () => {
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(429, { 'Retry-After': 'Fri, 02 Oct 2026 12:00:04 GMT' }),
      )
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetchMock);

    const promise = readEnvironments();
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([429, 503])(
    'preserves HTTP %s and its cooldown when the required wait exceeds the total deadline',
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response(status, { 'X-RateLimit-Reset': '20', 'Retry-After': '30' }),
        );
      vi.stubGlobal('fetch', fetchMock);

      const promise = readEnvironments();
      await expect(promise).rejects.toBeInstanceOf(ApiError);
      await expect(promise).rejects.toMatchObject({
        response: { status },
        retryAfterMs: 30000,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([502, 503, 504])(
    'retries a transient HTTP %s at most three times',
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => response(status));
      vi.stubGlobal('fetch', fetchMock);

      const assertion = expect(readEnvironments()).rejects.toMatchObject({
        response: { status },
      });
      await vi.advanceTimersByTimeAsync(750);
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it.each([401, 403, 404, 409, 422, 500])(
    'does not retry HTTP %s',
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response(status));
      vi.stubGlobal('fetch', fetchMock);

      await expect(readEnvironments()).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('retries a fetch network error but not a callback programming error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetchMock);

    const promise = readEnvironments();
    await vi.advanceTimersByTimeAsync(250);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const error = new TypeError('Programming error');
    const operation = vi.fn(async () => {
      throw error;
    });
    await expect(readCma(options, operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not retry invalid JSON in a successful response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('invalid-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(readEnvironments()).rejects.toBeInstanceOf(SyntaxError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds a stalled fetch even when it ignores its AbortSignal', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);

    const assertion = expect(readEnvironments()).rejects.toBeInstanceOf(
      CmaReadTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds SDK body consumption after response headers arrive', async () => {
    let finishBody: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        finishBody = () => controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const assertion = expect(readEnvironments()).rejects.toBeInstanceOf(
      CmaReadTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    finishBody?.();
  });

  it('uses one shared deadline across retries rather than 10 seconds per attempt', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(503))
      .mockImplementation(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);

    const assertion = expect(readEnvironments()).rejects.toBeInstanceOf(
      CmaReadTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('does not start an already cancelled read', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(readEnvironments(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(buildClient).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels a pending read immediately and stops retry backoff', async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(429, { 'X-RateLimit-Reset': '3' }));
    vi.stubGlobal('fetch', fetchMock);

    const assertion = expect(
      readEnvironments(controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects mutations before sending any request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      readCma(options, (client) => client.environments.destroy('backup')),
    ).rejects.toThrow('readCma only permits GET requests.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
