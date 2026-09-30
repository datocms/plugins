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
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);

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
});
