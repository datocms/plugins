import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createExportFetch,
  downloadBlob,
  mapWithConcurrency,
  waitForExport,
} from './exportRuntime';

describe('bounded export runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Blob', NodeBlob);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('bounds concurrency, preserves order and drains active workers on failure', async () => {
    let active = 0;
    let max = 0;
    const promise = mapWithConcurrency(
      Array.from({ length: 300 }, (_, i) => i),
      4,
      async (value) => {
        active++;
        max = Math.max(max, active);
        await waitForExport(1);
        active--;
        return value * 2;
      },
    );
    await vi.runAllTimersAsync();
    expect(await promise).toEqual(Array.from({ length: 300 }, (_, i) => i * 2));
    expect(max).toBe(4);
    let started = 0;
    const failure = mapWithConcurrency([0, 1, 2, 3, 4], 2, async (value) => {
      started++;
      if (value === 0) throw new Error('failed');
      await waitForExport(1);
      return value;
    });
    const rejection = expect(failure).rejects.toThrow('failed');
    await vi.runAllTimersAsync();
    await rejection;
    expect(started).toBe(2);
  });

  test('retries GET 429 with server reset and 503, then returns the full body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 429,
          headers: { 'x-ratelimit-reset': '3' },
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"data":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const promise = createExportFetch(undefined, { intervalMs: 0 })(
      'https://example.test/items',
    );
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(await (await promise).json()).toEqual({ data: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('does not retry authorization failures or writes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = createExportFetch(undefined, { intervalMs: 0 })(
      'https://example.test/items',
    );
    await vi.runAllTimersAsync();
    expect((await first).status).toBe(403);
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    const second = createExportFetch(undefined, { intervalMs: 0 })(
      'https://example.test/items',
      { method: 'POST' },
    );
    await vi.runAllTimersAsync();
    expect((await second).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('cancels retry backoff without launching another request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const promise = createExportFetch(controller.signal, { intervalMs: 0 })(
      'https://example.test/items',
    );
    const rejection = expect(promise).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('keeps deadline active through a stalled response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener('abort', () =>
                  controller.error(new DOMException('Timeout', 'AbortError')),
                );
              },
            }),
          ),
        ),
      ),
    );
    const promise = createExportFetch(undefined, {
      timeoutMs: 10,
      maxAttempts: 2,
      intervalMs: 0,
    })('https://example.test/items');
    const rejection = expect(promise).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.runAllTimersAsync();
    await rejection;
  });

  test('rejects oversized API responses without retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'content-length': String(33 * 1024 * 1024) },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const promise = createExportFetch(undefined, { intervalMs: 0 })(
      'https://example.test/items',
    );
    const rejection = expect(promise).rejects.toThrow('32 MiB');
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('removes download links and revokes object URLs after browser handoff', async () => {
    const create = vi.fn(() => 'blob:export');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: create,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revoke,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      () => undefined,
    );
    const promise = downloadBlob(new Blob(['file']), 'file.json');
    expect(document.querySelectorAll('a')).toHaveLength(1);
    await vi.runAllTimersAsync();
    await promise;
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(revoke).toHaveBeenCalledWith('blob:export');
  });
});
