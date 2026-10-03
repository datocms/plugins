import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAssetClient,
  createReliableFetch,
  waitForRetry,
} from './assetClient';
import { AssetOperationRejectedError } from './unusedAssets';

const API_URL = 'https://cma.example.test';

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function errorResponse(
  status: number,
  privateDetails = 'private-response-detail',
) {
  return jsonResponse(
    {
      data: [
        {
          id: 'error-1',
          type: 'api_error',
          attributes: {
            code: 'EXCEPTION',
            doc_url: 'https://example.test/error',
            details: { privateDetails },
          },
        },
      ],
    },
    status,
  );
}

function jobResponse() {
  return jsonResponse({ data: { id: 'job-1', type: 'job' } }, 202);
}

function completedJob(successful: number, failed: number) {
  return jsonResponse({
    data: {
      id: 'job-1',
      type: 'job_result',
      attributes: {
        status: 200,
        payload: { data: [], meta: { successful, failed } },
      },
    },
  });
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function mockAssetClient(fetchFn: typeof fetch) {
  vi.stubGlobal('fetch', fetchFn);
  return createAssetClient({
    apiToken: 'private-api-token',
    environment: 'sandbox',
    baseUrl: API_URL,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reliable asset transport', () => {
  it('bounds failed GET requests to five attempts with exponential backoff', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('offline'));
    const request = createReliableFetch(fetchFn)(`${API_URL}/uploads`);
    const assertion = expect(request).rejects.toThrow(
      'after automatic retries',
    );

    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it('retries a GET server failure and returns the next successful response', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const request = createReliableFetch(fetchFn)(`${API_URL}/uploads`);

    await vi.advanceTimersByTimeAsync(499);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await (await request).json()).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('honors X-RateLimit-Reset before retrying a rejected POST', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({}, 429, { 'X-RateLimit-Reset': '3' }),
      )
      .mockResolvedValueOnce(jsonResponse({ accepted: true }));
    const request = createReliableFetch(fetchFn)(
      `${API_URL}/uploads/bulk/destroy`,
      { method: 'POST' },
    );

    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await request).status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('prefers Retry-After over the rate reset header', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({}, 429, { 'Retry-After': '5', 'X-RateLimit-Reset': '1' }),
      )
      .mockResolvedValueOnce(jsonResponse({}));
    const request = createReliableFetch(fetchFn)(`${API_URL}/uploads`);

    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await request).status).toBe(200);
  });

  it('supports HTTP-date Retry-After values', async () => {
    const retryAt = new Date(Date.now() + 4000).toUTCString();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'Retry-After': retryAt }))
      .mockResolvedValueOnce(jsonResponse({}));
    const request = createReliableFetch(fetchFn)(`${API_URL}/uploads`);

    await vi.advanceTimersByTimeAsync(3999);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await request).status).toBe(200);
  });

  it('returns a definitive POST server failure without retrying it', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(503));
    const response = await createReliableFetch(fetchFn)(
      `${API_URL}/uploads/bulk/destroy`,
      { method: 'POST' },
    );

    expect(response.status).toBe(503);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a timed-out POST fetch and never replays the uncertain mutation', async () => {
    let fetchSignal: AbortSignal | null | undefined;
    const fetchFn = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          fetchSignal = init?.signal;
          fetchSignal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        }),
    );
    const request = createReliableFetch(fetchFn)(
      `${API_URL}/uploads/bulk/destroy`,
      { method: 'POST' },
    );
    const assertion = expect(request).rejects.toThrow(
      'outcome could not be confirmed',
    );

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(fetchSignal?.aborted).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps the timeout active while reading the POST response body', async () => {
    let fetchSignal: AbortSignal | null | undefined;
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      fetchSignal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          fetchSignal?.addEventListener(
            'abort',
            () => controller.error(new Error('body aborted')),
            { once: true },
          );
        },
      });
      return new Response(stream, {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const request = createReliableFetch(fetchFn)(
      `${API_URL}/uploads/bulk/destroy`,
      { method: 'POST' },
    );
    const assertion = expect(request).rejects.toThrow(
      'outcome could not be confirmed',
    );

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(fetchSignal?.aborted).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('cancels discovery during a retry delay before another GET starts', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(503));
    const request = createReliableFetch(
      fetchFn,
      controller.signal,
    )(`${API_URL}/uploads`);
    const assertion = expect(request).rejects.toThrow('cancelled');

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts an active discovery GET and does not retry the cancelled read', async () => {
    const controller = new AbortController();
    let fetchSignal: AbortSignal | null | undefined;
    const fetchFn = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          fetchSignal = init?.signal;
          fetchSignal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        }),
    );
    const request = createReliableFetch(
      fetchFn,
      controller.signal,
    )(`${API_URL}/uploads`);
    const assertion = expect(request).rejects.toThrow('cancelled');

    controller.abort();
    await assertion;
    expect(fetchSignal?.aborted).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a pre-cancelled wait without leaving timers behind', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(waitForRetry(5000, controller.signal)).rejects.toThrow(
      'cancelled',
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('asset client wire responses and jobs', () => {
  it('retains the raw total count, applies environment routing, and passes filters unchanged', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'upload-1',
            type: 'upload',
            attributes: {
              filename: 'asset.png',
              url: 'https://assets.example.test/asset.png',
            },
          },
        ],
        meta: { total_count: 10_000 },
      }),
    );
    const client = mockAssetClient(fetchFn);
    const result = await client.list({
      filter: { ids: 'upload-1', fields: { in_use: { eq: false } } },
      page: { offset: 0, limit: 100 },
    });

    expect(result).toEqual({
      total: 10_000,
      assets: [
        {
          id: 'upload-1',
          filename: 'asset.png',
          url: 'https://assets.example.test/asset.png',
        },
      ],
    });
    const [input, init] = fetchFn.mock.calls[0];
    const url = new URL(requestUrl(input));
    expect(url.origin).toBe(API_URL);
    expect(url.searchParams.get('filter[fields][in_use][eq]')).toBe('false');
    expect(url.searchParams.get('page[limit]')).toBe('100');
    expect(new Headers(init?.headers).get('X-Environment')).toBe('sandbox');
  });

  it('polls 404 until completion, preserves partial-job counters, and submits the POST once', async () => {
    let polls = 0;
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') return jobResponse();
      polls++;
      return polls === 1 ? errorResponse(404) : completedJob(2, 1);
    });
    const client = mockAssetClient(fetchFn);
    const operation = client.destroy(['upload-1', 'upload-2', 'upload-3']);

    await vi.advanceTimersByTimeAsync(4000);
    expect(await operation).toEqual({ successful: 2, failed: 1 });
    expect(
      fetchFn.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
    expect(
      fetchFn.mock.calls.filter(([, init]) => init?.method === 'GET'),
    ).toHaveLength(2);
    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      data: {
        type: 'upload_bulk_destroy_operation',
        relationships: {
          uploads: {
            data: ['upload-1', 'upload-2', 'upload-3'].map((id) => ({
              type: 'upload',
              id,
            })),
          },
        },
      },
    });
  });

  it('stops after bounded polling transport failures without re-submitting the accepted POST', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === 'POST' ? jobResponse() : errorResponse(503),
    );
    const client = mockAssetClient(fetchFn);
    const operation = client.destroy(['upload-1']);
    const assertion = expect(operation).rejects.toThrow(
      'Could not confirm deletion job job-1',
    );

    await vi.runAllTimersAsync();
    await assertion;
    expect(
      fetchFn.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
    expect(
      fetchFn.mock.calls.filter(([, init]) => init?.method === 'GET'),
    ).toHaveLength(5);
  });

  it('bounds the pending job wait to one hour without posting again', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === 'POST' ? jobResponse() : errorResponse(404),
    );
    const client = mockAssetClient(fetchFn);
    const operation = client.destroy(['upload-1']);
    const assertion = expect(operation).rejects.toThrow(
      'has not completed after one hour',
    );

    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(new Date(Date.now() + 60 * 60 * 1000));
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(
      fetchFn.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
    expect(
      fetchFn.mock.calls.filter(([, init]) => init?.method === 'GET'),
    ).toHaveLength(1);
  });

  it('sanitizes SDK read errors without exposing token, details, or request parameters', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(403, 'private-api-token'));
    const client = mockAssetClient(fetchFn);
    await expect(
      client.list({ filter: { ids: 'private-asset-id' } }),
    ).rejects.toMatchObject({
      message: 'The API returned HTTP 403. No further assets were deleted.',
    });
  });

  it.each([
    403, 422,
  ])('classifies a direct HTTP %s rejection without retrying or exposing private details', async (status) => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(status, 'private-api-token'));
    const client = mockAssetClient(fetchFn);
    const operation = client.destroy(['private-asset-id']);
    await expect(operation).rejects.toBeInstanceOf(AssetOperationRejectedError);
    await expect(operation).rejects.toMatchObject({
      message: `The deletion request was rejected (HTTP ${status}). No further assets were deleted.`,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('classifies an exhausted POST rate limit as a definite rejection after five attempts', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      errorResponse(429, 'private-api-token'),
    );
    const client = mockAssetClient(fetchFn);
    const operation = client.destroy(['private-asset-id']);
    const assertion = expect(operation).rejects.toBeInstanceOf(
      AssetOperationRejectedError,
    );

    await vi.runAllTimersAsync();
    await assertion;
    await expect(operation).rejects.toMatchObject({
      message:
        'The deletion request was rejected (HTTP 429). No further assets were deleted.',
    });
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(
      fetchFn.mock.calls.every(([, init]) => init?.method === 'POST'),
    ).toBe(true);
  });

  it('sanitizes a failed asynchronous job result without repeating the POST', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') return jobResponse();
      return jsonResponse({
        data: {
          id: 'job-1',
          type: 'job_result',
          attributes: {
            status: 422,
            payload: {
              data: [
                {
                  id: 'error-1',
                  type: 'api_error',
                  attributes: {
                    code: 'EXCEPTION',
                    details: { secret: 'private-api-token' },
                  },
                },
              ],
            },
          },
        },
      });
    });
    const client = mockAssetClient(fetchFn);
    const operation = client.destroy(['private-asset-id']);
    const assertion = expect(operation).rejects.toMatchObject({
      message: 'The API returned HTTP 422. No further assets were deleted.',
    });

    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    await expect(operation).rejects.not.toBeInstanceOf(
      AssetOperationRejectedError,
    );
    expect(
      fetchFn.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  });

  it('does not carry accepted-job state into a later rejected deletion', async () => {
    let postCount = 0;
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== 'POST') return completedJob(1, 0);
      postCount++;
      return postCount === 1 ? jobResponse() : errorResponse(422);
    });
    const client = mockAssetClient(fetchFn);
    const firstOperation = client.destroy(['upload-1']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await firstOperation).toEqual({ successful: 1, failed: 0 });

    await expect(client.destroy(['upload-2'])).rejects.toBeInstanceOf(
      AssetOperationRejectedError,
    );
    expect(postCount).toBe(2);
  });
});
