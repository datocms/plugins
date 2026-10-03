import { afterEach, describe, expect, it, vi } from 'vitest';
import { bulkChangeCreator } from '../actions/bulkChangeCreator';
import { fetchWithDeadline, makeClient, REQUEST_TIMEOUT_MS } from './cmaClient';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CMA transport', () => {
  it('updates creator without traversing schema/content and confirms raw creator metadata', async () => {
    vi.useFakeTimers();
    const response = {
      data: {
        type: 'item',
        id: 'record',
        attributes: {
          title: Object.fromEntries(
            Array.from({ length: 50 }, (_, i) => [`locale-${i}`, 'Title']),
          ),
          gallery: Array.from({ length: 10_000 }, (_, i) => ({
            upload_id: `asset-${i}`,
          })),
          blocks: [
            {
              type: 'item',
              id: 'block',
              attributes: { text: 'Nested content' },
            },
          ],
        },
        relationships: {
          creator: { data: { id: 'new-user', type: 'user' } },
          item_type: { data: { id: 'model', type: 'item_type' } },
        },
      },
    };
    const fetchMock = vi.fn(async (_input: unknown, init: RequestInit) => {
      if (init.method === 'PUT')
        throw new TypeError('Lost response after accepted update');
      return new Response(JSON.stringify(response), {
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    let now = 0;
    const result = await bulkChangeCreator({
      apiToken: 'fake-test-token',
      itemIds: ['record'],
      userId: 'new-user',
      userType: 'user',
      runtime: {
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        random: () => 0,
      },
    });
    expect(result).toMatchObject({ succeeded: 1, uncertain: 0, failed: 0 });
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual([
      'PUT',
      'GET',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      data: {
        type: 'item',
        id: 'record',
        relationships: { creator: { data: { id: 'new-user', type: 'user' } } },
      },
    });
    expect(response.data.attributes.gallery).toHaveLength(10_000);
    expect(response.data.attributes.title['locale-0']).toBe('Title');
    await vi.runAllTimersAsync();
  });
  it('sends only creator metadata and preserves environment/base URL', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              type: 'item',
              id: 'record',
              attributes: {
                title: { en: 'Hello', pt: 'Olá' },
                nested_content: ['block'],
              },
              relationships: {
                creator: { data: { id: 'new-user', type: 'user' } },
                item_type: { data: { id: 'model', type: 'item_type' } },
              },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await makeClient(
      'fake-test-token',
      'sandbox',
      'https://example.invalid/cma',
    ).items.update('record', {
      creator: { id: 'new-user', type: 'user' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://example.invalid/cma/items/record');
    expect(init.method).toBe('PUT');
    expect(new Headers(init.headers).get('x-environment')).toBe('sandbox');
    expect(JSON.parse(String(init.body))).toEqual({
      data: {
        id: 'record',
        type: 'item',
        relationships: { creator: { data: { id: 'new-user', type: 'user' } } },
      },
    });
  });

  it('disables SDK automatic mutation retries', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('', {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Reset': '3',
          },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      makeClient('fake-test-token').items.update('record', {
        creator: { id: 'new-user', type: 'user' },
      }),
    ).rejects.toMatchObject({ response: { status: 429 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts an actual fetch after the deadline and releases its timer', async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: unknown, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );
    const request = fetchWithDeadline('https://example.invalid');
    const assertion = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await assertion;
    expect(aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps its deadline until a stalled response body is aborted', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: unknown, init: RequestInit) =>
          new Response(
            new ReadableStream({
              start(controller) {
                init.signal?.addEventListener('abort', () =>
                  controller.error(new DOMException('Aborted', 'AbortError')),
                );
              },
            }),
          ),
      ),
    );
    const request = fetchWithDeadline('https://example.invalid');
    const assertion = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not resend a rejected fetch and releases the transport timers', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Mock offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      makeClient('fake-test-token').items.update('record', {
        creator: { id: 'new-user', type: 'user' },
      }),
    ).rejects.toThrow('Mock offline');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // CMA 6 clears its request timeout on rejection as well as success.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 5000);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
