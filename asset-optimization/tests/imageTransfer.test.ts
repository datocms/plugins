/* biome-ignore-all lint/performance/noAwaitInLoops: Tests change global fetch and virtual time sequentially. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import {
  downloadOptimizedImage,
  getOptimizedFilename,
  ImageSizeLimitError,
  MAX_OPTIMIZED_IMAGE_BYTES,
} from '../src/utils/imageTransfer.ts';

const url = 'https://images.example.test/image?fm=avif';
const png = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQtMAAAAASUVORK5CYII=',
    'base64',
  ),
);
const gif = new Uint8Array(
  Buffer.from(
    'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
    'base64',
  ),
);
// These two container fixtures exercise signature checks, not image decoding.
const jpeg = new Uint8Array([
  255, 216, 255, 224, 0, 8, 74, 70, 73, 70, 0, 0, 255, 217,
]);
const webp = new Uint8Array(26);
webp.set(new TextEncoder().encode('RIFF'), 0);
new DataView(webp.buffer).setUint32(4, 18, true);
webp.set(new TextEncoder().encode('WEBPVP8L'), 8);
new DataView(webp.buffer).setUint32(16, 5, true);
webp[20] = 47;
const avif = new Uint8Array(32);
new DataView(avif.buffer).setUint32(0, 24);
avif.set(new TextEncoder().encode('ftypavif'), 4);
avif.set(new TextEncoder().encode('mif1avif'), 16);
new DataView(avif.buffer).setUint32(24, 8);
avif.set(new TextEncoder().encode('mdat'), 28);

function imageResponse(
  bytes = png,
  headers?: Record<string, string>,
): Response {
  return new Response(new Uint8Array(bytes), { headers });
}

test('uses actual image signatures for MIME and filename, regardless of CDN content type', async (t) => {
  const formats = [
    { bytes: png, mime: 'image/png', extension: 'png' },
    { bytes: jpeg, mime: 'image/jpeg', extension: 'jpg' },
    { bytes: gif, mime: 'image/gif', extension: 'gif' },
    { bytes: webp, mime: 'image/webp', extension: 'webp' },
    { bytes: avif, mime: 'image/avif', extension: 'avif' },
  ];
  for (const format of formats) {
    t.mock.method(
      globalThis,
      'fetch',
      async (_url: string, options?: RequestInit) => {
        assert.equal(options?.credentials, 'omit');
        assert.equal(options?.headers, undefined);
        return imageResponse(format.bytes, {
          'content-type': 'application/octet-stream',
        });
      },
    );
    const blob = await downloadOptimizedImage(url, 1024);
    assert.equal(blob.type, format.mime);
    assert.equal(blob.size, format.bytes.length);
    assert.equal(
      await getOptimizedFilename(
        { basename: 'photo.jpeg', path: '/folder/photo.jpeg' },
        blob,
      ),
      `photo.${format.extension}`,
    );
    t.mock.restoreAll();
  }
});

test('rejects empty, HTML, SVG, unsupported and visibly truncated image responses without retry', async (t) => {
  const malformedPng = png.slice(0, png.length - 1);
  const malformedWebp = webp.slice();
  new DataView(malformedWebp.buffer).setUint32(4, 1000, true);
  for (const bytes of [
    new Uint8Array(),
    new TextEncoder().encode('<html>error</html>'),
    new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    new Uint8Array([255, 216, 255, 217]),
    malformedPng,
    malformedWebp,
  ]) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
      imageResponse(bytes, { 'content-type': 'image/png' }),
    );
    await assert.rejects(
      downloadOptimizedImage(url, 1024),
      /empty|unsupported or malformed/,
    );
    assert.equal(fetchMock.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test('rejects an oversized Content-Length before reading and cancels the body', async (t) => {
  let pulls = 0;
  let cancelled = false;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull() {
              pulls += 1;
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
        { headers: { 'content-length': '1000' } },
      ),
  );
  await assert.rejects(downloadOptimizedImage(url, 100), ImageSizeLimitError);
  assert.equal(pulls, 0);
  assert.equal(cancelled, true);
});

test('enforces the absolute 32 MiB limit even if the caller supplies a larger budget', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    imageResponse(png, {
      'content-length': String(MAX_OPTIMIZED_IMAGE_BYTES + 1),
    }),
  );
  await assert.rejects(
    downloadOptimizedImage(url, MAX_OPTIMIZED_IMAGE_BYTES * 2),
    /download limit/,
  );
});

test('bounds actual bytes without Content-Length or when the header understates them', async (t) => {
  const headerCases: Record<string, string>[] = [{}, { 'content-length': '1' }];
  for (const headers of headerCases) {
    let cancelled = false;
    let reads = 0;
    t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                reads += 1;
                controller.enqueue(new Uint8Array(64));
              },
              cancel() {
                cancelled = true;
              },
            },
            { highWaterMark: 0 },
          ),
          { headers },
        ),
    );
    await assert.rejects(downloadOptimizedImage(url, 100), /download limit/);
    assert.equal(reads, 2);
    assert.equal(cancelled, true);
    t.mock.restoreAll();
  }
});

test('handles tiny streaming chunks and accepts a body exactly at its limit', async (t) => {
  let offset = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (offset === png.length) controller.close();
              else controller.enqueue(png.slice(offset, ++offset));
            },
          },
          { highWaterMark: 0 },
        ),
      ),
  );
  const blob = await downloadOptimizedImage(url, png.length);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), png);
});

test('coalesces 10,000 one-byte network chunks into a bounded number of buffer pages', async (t) => {
  // A synthetic PNG envelope isolates transfer/memory behavior from decoding.
  const bytes = new Uint8Array(10_000);
  bytes.set(png.slice(0, 33));
  bytes.set(png.slice(-12), bytes.length - 12);
  const blobPartCounts: number[] = [];
  const NativeBlob = Blob;
  class ObservedBlob extends NativeBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      blobPartCounts.push(parts?.length ?? 0);
    }
  }
  t.mock.method(globalThis, 'Blob', ObservedBlob);
  let offset = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (offset === bytes.length) controller.close();
              else controller.enqueue(bytes.slice(offset, ++offset));
            },
          },
          { highWaterMark: 0 },
        ),
      ),
  );
  const blob = await downloadOptimizedImage(url, bytes.length);
  assert.equal(blob.size, 10_000);
  assert.deepEqual(blobPartCounts, [1]);
});

test('rejects missing bodies, permanent HTTP errors and invalid byte budgets without retries', async (t) => {
  for (const status of [400, 401, 403, 404, 415]) {
    const fetchMock = t.mock.method(
      globalThis,
      'fetch',
      async () => new Response('error', { status }),
    );
    await assert.rejects(
      downloadOptimizedImage(url, 1024),
      new RegExp(`HTTP ${status}`),
    );
    assert.equal(fetchMock.mock.callCount(), 1);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(null));
  await assert.rejects(downloadOptimizedImage(url, 1024), /no body/);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    imageResponse(),
  );
  for (const budget of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    await assert.rejects(
      downloadOptimizedImage(url, budget),
      /positive integer/,
    );
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('retries network and server errors automatically with finite backoff', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('network offline');
    if (attempts === 2) return new Response('unavailable', { status: 503 });
    return imageResponse();
  });
  const result = downloadOptimizedImage(url, 1024);
  await nextTurn();
  assert.equal(attempts, 1);
  t.mock.timers.tick(1000);
  await nextTurn();
  assert.equal(attempts, 2);
  t.mock.timers.tick(2000);
  assert.equal((await result).type, 'image/png');
  assert.equal(attempts, 3);
});

test('stops after three retryable HTTP failures', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('unavailable', { status: 502 }),
  );
  const result = assert.rejects(downloadOptimizedImage(url, 1024), /HTTP 502/);
  await nextTurn();
  t.mock.timers.tick(1000);
  await nextTurn();
  t.mock.timers.tick(2000);
  await result;
  assert.equal(fetchMock.mock.callCount(), 3);
});

test('honors Retry-After seconds and HTTP dates before retrying 429', async (t) => {
  const now = Date.UTC(2026, 9, 2, 10);
  for (const retryAfter of ['3', new Date(now + 3000).toUTCString()]) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
    let attempts = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      attempts += 1;
      return attempts === 1
        ? new Response('rate limited', {
            status: 429,
            headers: { 'retry-after': retryAfter },
          })
        : imageResponse();
    });
    const result = downloadOptimizedImage(url, 1024);
    await nextTurn();
    t.mock.timers.tick(2999);
    await nextTurn();
    assert.equal(attempts, 1);
    t.mock.timers.tick(1);
    await result;
    assert.equal(attempts, 2);
    t.mock.restoreAll();
    t.mock.timers.reset();
  }
});

test('never retries earlier than an excessively long Retry-After', async (t) => {
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '3600' },
      }),
  );
  await assert.rejects(
    downloadOptimizedImage(url, 1024),
    /automatic retry wait limit/,
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('timeout includes a stalled response body even if cancellation never settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  let cancellations = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts += 1;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull: () => new Promise(() => {}),
        cancel: () => {
          cancellations += 1;
          return new Promise(() => {});
        },
      }),
    );
  });
  const result = assert.rejects(downloadOptimizedImage(url, 1024), /timed out/);
  await nextTurn();
  for (const backoff of [1000, 2000]) {
    t.mock.timers.tick(90_000);
    await nextTurn();
    t.mock.timers.tick(backoff);
    await nextTurn();
  }
  t.mock.timers.tick(90_000);
  await result;
  assert.equal(attempts, 3);
  assert.equal(cancellations, 3);
});

test('timeout also bounds fetch implementations that ignore AbortSignal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    () => new Promise<Response>(() => {}),
  );
  const result = assert.rejects(downloadOptimizedImage(url, 1024), /timed out/);
  for (const backoff of [1000, 2000]) {
    t.mock.timers.tick(90_000);
    await nextTurn();
    t.mock.timers.tick(backoff);
    await nextTurn();
  }
  t.mock.timers.tick(90_000);
  await result;
  assert.equal(fetchMock.mock.callCount(), 3);
});

test('abort cancels a stalled body immediately without retry', async (t) => {
  const controller = new AbortController();
  let cancelled = false;
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull: () => new Promise(() => {}),
          cancel: () => {
            cancelled = true;
          },
        }),
      ),
  );
  const result = assert.rejects(
    downloadOptimizedImage(url, 1024, controller.signal),
    { name: 'AbortError' },
  );
  await nextTurn();
  controller.abort();
  await result;
  assert.equal(cancelled, true);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('abort during backoff stops continuous retries and pre-aborted signals never fetch', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('rate limited', { status: 429 }),
  );
  const result = assert.rejects(
    downloadOptimizedImage(url, 1024, controller.signal),
    { name: 'AbortError' },
  );
  await nextTurn();
  controller.abort();
  await result;
  t.mock.timers.tick(10_000);
  assert.equal(fetchMock.mock.callCount(), 1);
  await assert.rejects(downloadOptimizedImage(url, 1024, controller.signal), {
    name: 'AbortError',
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('filename inspection reads only a small prefix/suffix and sanitizes path-like names', async (t) => {
  const blob = new Blob([
    png.slice(0, 33),
    new Uint8Array(2 * 1024 * 1024),
    png.slice(-12),
  ]);
  const inspectedSizes: number[] = [];
  const read = Blob.prototype.arrayBuffer;
  t.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) {
    inspectedSizes.push(this.size);
    return read.call(this);
  });
  const filename = await getOptimizedFilename(
    { basename: '../../photo<1>.jpeg', path: '' },
    blob,
  );
  assert.equal(filename, 'photo_1_.png');
  assert.deepEqual(inspectedSizes, [256, 12]);
  assert.equal(
    await getOptimizedFilename(
      { basename: '', path: '/folder/source.gif' },
      blob,
    ),
    'source.png',
  );
  assert.equal(
    await getOptimizedFilename({ basename: '..', path: '' }, blob),
    'optimized.png',
  );
  assert.equal(
    await getOptimizedFilename(
      { basename: 'name'.repeat(100), path: '' },
      blob,
    ),
    `${'name'.repeat(45)}.png`,
  );
  assert.deepEqual(inspectedSizes, [256, 12]);
});
