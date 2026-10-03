// @vitest-environment node

import {
  ASSET_DOWNLOAD_MAX_ATTEMPTS,
  ASSET_REQUEST_IDLE_TIMEOUT_MS,
  downloadAssetFile,
} from './assetDownload';

const url = 'https://www.datocms-assets.com/synthetic.bin';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('reads the complete response incrementally without requiring size metadata', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  const file = await downloadAssetFile(url, 4);
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3, 4]),
  );
});

test('refuses oversized Content-Length before reading the body and does not retry', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(body, { headers: { 'Content-Length': '100' } }),
    );
  vi.stubGlobal('fetch', fetchMock);
  await expect(downloadAssetFile(url, 10)).rejects.toThrow(
    '100 bytes reported',
  );
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce();
});

test('enforces the actual byte limit when Content-Length is missing or inaccurate', async () => {
  const cancel = vi.fn();
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(4));
    },
    cancel,
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(body, { headers: { 'Content-Length': '1' } }),
    );
  vi.stubGlobal('fetch', fetchMock);
  await expect(downloadAssetFile(url, 10)).rejects.toThrow('12 bytes received');
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(reads).toBeLessThanOrEqual(4);
});

test('retries transient GET errors using Retry-After and emits a single complete result', async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('busy', {
        status: 429,
        headers: { 'Retry-After': '2' },
      }),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array([7, 8])));
  vi.stubGlobal('fetch', fetchMock);
  const onRetry = vi.fn();
  const result = downloadAssetFile(url, 10, undefined, onRetry);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(new Uint8Array(await (await result).arrayBuffer())).toEqual(
    new Uint8Array([7, 8]),
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(onRetry).toHaveBeenCalledWith(2);
});

test('a failed body is discarded before a safe GET retry', async () => {
  vi.useFakeTimers();
  let reads = 0;
  const interrupted = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reads++ === 0) controller.enqueue(new Uint8Array([1, 2]));
      else controller.error(new TypeError('connection lost'));
    },
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(interrupted))
    .mockResolvedValueOnce(new Response(new Uint8Array([3, 4])));
  vi.stubGlobal('fetch', fetchMock);
  const result = downloadAssetFile(url, 10);
  await vi.runAllTimersAsync();
  expect(new Uint8Array(await (await result).arrayBuffer())).toEqual(
    new Uint8Array([3, 4]),
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('non-transient HTTP errors are not retried', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response('missing', { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(downloadAssetFile(url, 10)).rejects.toThrow('HTTP 404');
  expect(fetchMock).toHaveBeenCalledOnce();
});

test('known source sizes detect incomplete content and retry before declaring success', async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(new Uint8Array([1])))
    .mockResolvedValueOnce(new Response(new Uint8Array([2, 3])));
  vi.stubGlobal('fetch', fetchMock);
  const result = downloadAssetFile(url, 10, undefined, undefined, 2);
  await vi.runAllTimersAsync();
  expect(new Uint8Array(await (await result).arrayBuffer())).toEqual(
    new Uint8Array([2, 3]),
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('stalled downloads time out and exhaust a bounded retry count', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(
    (_input, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const result = expect(downloadAssetFile(url, 10)).rejects.toThrow('stalled');
  await vi.runAllTimersAsync();
  await result;
  expect(fetchMock).toHaveBeenCalledTimes(ASSET_DOWNLOAD_MAX_ATTEMPTS);
});

test('the timeout covers a stalled body after successful response headers', async () => {
  vi.useFakeTimers();
  const signal = new AbortController();
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      bodyController = controller;
    },
  });
  const fetchMock = vi.fn((_input, init: RequestInit) => {
    init.signal?.addEventListener('abort', () =>
      bodyController?.error(new DOMException('aborted', 'AbortError')),
    );
    return Promise.resolve(new Response(stream));
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = expect(
    downloadAssetFile(url, 10, signal.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(ASSET_REQUEST_IDLE_TIMEOUT_MS);
  // Cancel during automatic backoff; neither the user nor tests need to resume.
  signal.abort();
  await result;
  expect(fetchMock).toHaveBeenCalledOnce();
});

test('cancel stops an active fetch and never schedules another attempt', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn(
    (_input, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const result = expect(
    downloadAssetFile(url, 10, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await result;
  expect(fetchMock).toHaveBeenCalledOnce();
});
