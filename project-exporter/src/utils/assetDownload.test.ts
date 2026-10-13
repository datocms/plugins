// @vitest-environment node

import { createHash } from 'node:crypto';
import { MemoryWorkspace } from '../test/memoryWorkspace';
import {
  ASSET_DOWNLOAD_MAX_ATTEMPTS,
  ASSET_REQUEST_IDLE_TIMEOUT_MS,
  type AssetDownloadOptions,
  downloadAssetFile,
  originalFileUrl,
} from './assetDownload';

const url = 'https://www.datocms-assets.com/synthetic.bin';

let workspace: MemoryWorkspace;

beforeEach(() => {
  workspace = new MemoryWorkspace();
});

const download = (options?: AssetDownloadOptions) =>
  downloadAssetFile(url, workspace.asWorkspace(), 'asset', options);

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
  const file = await download();
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3, 4]),
  );
});

test('checks the MD5 of what it wrote', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const md5 = createHash('md5').update(bytes).digest('hex');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes)));
  const file = await download({ md5: md5.toUpperCase() });
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
});

test('refuses content that does not match its MD5, without retrying', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', fetchMock);
  await expect(download({ md5: 'f'.repeat(32) })).rejects.toThrow(
    'does not match its MD5',
  );
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(workspace.files.has('asset')).toBe(false);
});

test('asks for the original file', () => {
  const original = new URL(originalFileUrl(`${url}?w=10`));
  expect(original.searchParams.get('w')).toBe('10');
  expect(original.searchParams.get('skip-default-optimizations')).toBe('true');
  expect(original.searchParams.get('svg-sanitize')).toBe('false');
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
  const result = download({ onRetry });
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
  const result = download();
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
  await expect(download()).rejects.toThrow('HTTP 404');
  expect(fetchMock).toHaveBeenCalledOnce();
});

test('known source sizes detect incomplete content and retry before declaring success', async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(new Uint8Array([1])))
    .mockResolvedValueOnce(new Response(new Uint8Array([2, 3])));
  vi.stubGlobal('fetch', fetchMock);
  const result = download({ expectedBytes: 2 });
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
  const result = expect(download()).rejects.toThrow('stalled');
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
    download({ signal: signal.signal }),
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
    download({ signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  controller.abort();
  await result;
  expect(fetchMock).toHaveBeenCalledOnce();
});
