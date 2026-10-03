import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDatoCMSClient } from './clients';

describe('cancellable DatoCMS reads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('aborts an in-flight CMA read and prevents further network requests', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Cancelled', 'AbortError'));
            },
            { once: true },
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = buildDatoCMSClient(
      'test-token',
      'sandbox',
      undefined,
      controller.signal,
    );
    const read = client.items.list({ version: 'current' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

    controller.abort();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    await expect(client.items.list()).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not issue a CMA request when already cancelled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const client = buildDatoCMSClient(
      'test-token',
      'sandbox',
      undefined,
      controller.signal,
    );
    await expect(client.items.rawList()).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a rejected read with bounded backoff and preserves its page query', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(
        new Response('{"data":[]}', {
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = buildDatoCMSClient('test-token', 'sandbox');
    const read = client.items.rawList({
      page: { offset: 199_900, limit: 100 },
    });
    await vi.runAllTimersAsync();
    expect(await read).toEqual({ data: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
    expect(String(fetchMock.mock.calls[1][0])).toContain('199900');
  });

  it('does not replay an ambiguous mutation transport error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const client = buildDatoCMSClient('test-token', 'sandbox');
    await expect(
      client.request({ method: 'POST', url: '/items', body: {} }),
    ).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('lets an accepted write settle after user cancellation', async () => {
    const controller = new AbortController();
    let complete: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = buildDatoCMSClient(
      'test-token',
      'sandbox',
      undefined,
      controller.signal,
    );
    const write = client.request({ method: 'POST', url: '/items', body: {} });
    controller.abort();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    complete?.(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
    expect(await write).toEqual({});
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('bounds an accepted job polling loop without resubmitting its mutation', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        if (init?.method === 'POST')
          return new Response('{"data":{"id":"synthetic-job","type":"job"}}', {
            status: 202,
            headers: { 'content-type': 'application/json' },
          });
        return new Response('{"data":[]}', {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      });
    vi.stubGlobal('fetch', fetchMock);
    const client = buildDatoCMSClient('test-token', 'sandbox');
    const write = client
      .request({ method: 'POST', url: '/items/bulk-publish', body: {} })
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(await write).toMatchObject({
      message: expect.stringContaining('did not finish within 15 minutes'),
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  });
});
