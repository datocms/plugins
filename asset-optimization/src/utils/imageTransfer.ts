/** One image is held at a time; never buffer an unbounded CDN response. */
export const MAX_OPTIMIZED_IMAGE_BYTES = 32 * 1024 * 1024;

const DOWNLOAD_TIMEOUT_MS = 90_000;
const MAX_DOWNLOAD_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 120_000;
const SIGNATURE_BYTES = 256;
const BUFFER_PAGE_BYTES = 64 * 1024;

interface ImageFormat {
  mime: string;
  extension: string;
}

const verifiedFormats = new WeakMap<Blob, ImageFormat>();

class InvalidImageError extends Error {}

/** The caller may treat a larger-than-useful conversion as a skipped asset. */
export class ImageSizeLimitError extends InvalidImageError {}

class TransientDownloadError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Download cancelled', 'AbortError');
  }
}

function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(
        signal?.reason ?? new DOMException('Download cancelled', 'AbortError'),
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  // Cancellation is best effort: a stalled underlying source must not block us.
  if (body) void body.cancel().catch(() => {});
}

class ImageBodyBuffer {
  private readonly pages: BlobPart[] = [];
  private page: Uint8Array<ArrayBuffer>;
  private pageLength = 0;

  constructor(private readonly pageSize: number) {
    this.page = new Uint8Array(pageSize);
  }

  append(value: Uint8Array): void {
    // Coalesce tiny network chunks so chunk bookkeeping is bounded as well.
    let offset = 0;
    while (offset < value.byteLength) {
      const length = Math.min(
        this.pageSize - this.pageLength,
        value.byteLength - offset,
      );
      this.page.set(value.subarray(offset, offset + length), this.pageLength);
      offset += length;
      this.pageLength += length;
      if (this.pageLength === this.pageSize) {
        this.pages.push(this.page);
        this.page = new Uint8Array(this.pageSize);
        this.pageLength = 0;
      }
    }
  }

  toBlob(): Blob {
    if (this.pageLength) this.pages.push(this.page.slice(0, this.pageLength));
    return new Blob(this.pages);
  }
}

async function readBoundedBlob(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Blob> {
  const declaredLength = response.headers.get('content-length')?.trim();
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maxBytes
  ) {
    cancelBody(response.body);
    throw new ImageSizeLimitError(
      `Optimized image exceeds the ${maxBytes}-byte download limit`,
    );
  }
  if (!response.body)
    throw new InvalidImageError('Optimized image response has no body');

  const reader = response.body.getReader();
  const buffer = new ImageBodyBuffer(Math.min(maxBytes, BUFFER_PAGE_BYTES));
  let receivedBytes = 0;
  const cancelReader = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancelReader, { once: true });
  try {
    for (;;) {
      throwIfAborted(signal);
      // biome-ignore lint/performance/noAwaitInLoops: Streaming must remain sequential to bound memory.
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        throw new ImageSizeLimitError(
          `Optimized image exceeds the ${maxBytes}-byte download limit`,
        );
      }
      buffer.append(value);
    }
    if (!receivedBytes)
      throw new InvalidImageError('Optimized image response is empty');
    return buffer.toBlob();
  } catch (error) {
    cancelReader();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }
}

function hasBytes(bytes: Uint8Array, expected: number[], offset = 0): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function hasText(bytes: Uint8Array, text: string, offset = 0): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function isPng(header: Uint8Array, tail: Uint8Array, size: number): boolean {
  if (size < 45 || !hasBytes(header, [137, 80, 78, 71, 13, 10, 26, 10]))
    return false;
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  return (
    view.getUint32(8) === 13 &&
    hasText(header, 'IHDR', 12) &&
    view.getUint32(16) > 0 &&
    view.getUint32(20) > 0 &&
    hasBytes(tail, [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
  );
}

function isWebp(header: Uint8Array, size: number): boolean {
  if (size < 26 || !hasText(header, 'RIFF') || !hasText(header, 'WEBP', 8))
    return false;
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  const chunkSize = view.getUint32(16, true);
  const recognizedChunk =
    (hasText(header, 'VP8 ', 12) &&
      chunkSize >= 10 &&
      hasBytes(header, [157, 1, 42], 23)) ||
    (hasText(header, 'VP8L', 12) && chunkSize >= 5 && header[20] === 47) ||
    (hasText(header, 'VP8X', 12) && chunkSize === 10);
  return (
    recognizedChunk &&
    view.getUint32(4, true) + 8 === size &&
    chunkSize > 0 &&
    20 + chunkSize + (chunkSize % 2) <= size
  );
}

function isGif(header: Uint8Array, tail: Uint8Array, size: number): boolean {
  if (size < 29 || (!hasText(header, 'GIF87a') && !hasText(header, 'GIF89a')))
    return false;
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  return (
    view.getUint16(6, true) > 0 &&
    view.getUint16(8, true) > 0 &&
    tail[tail.length - 1] === 59
  );
}

function isJpeg(header: Uint8Array, tail: Uint8Array, size: number): boolean {
  return (
    size >= 10 &&
    hasBytes(header, [255, 216, 255]) &&
    header[3] >= 192 &&
    header[3] !== 216 &&
    header[3] !== 217 &&
    header[3] !== 255 &&
    hasBytes(tail, [255, 217], tail.length - 2)
  );
}

function isAvif(header: Uint8Array, size: number): boolean {
  if (size < 24 || !hasText(header, 'ftyp', 4)) return false;
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  const boxSize = view.getUint32(0);
  if (boxSize < 16 || boxSize % 4 !== 0 || boxSize + 8 > size) return false;
  if (hasText(header, 'avif', 8) || hasText(header, 'avis', 8)) return true;
  for (
    let offset = 16;
    offset + 4 <= Math.min(boxSize, header.length);
    offset += 4
  ) {
    if (hasText(header, 'avif', offset) || hasText(header, 'avis', offset))
      return true;
  }
  return false;
}

/** Inspect only a small prefix and suffix; do not decode a potentially huge image. */
async function inspectImageFormat(blob: Blob): Promise<ImageFormat> {
  const cached = verifiedFormats.get(blob);
  if (cached) return cached;
  if (!blob.size)
    throw new InvalidImageError('Optimized image response is empty');
  const header = new Uint8Array(
    await blob.slice(0, SIGNATURE_BYTES).arrayBuffer(),
  );
  const tail = new Uint8Array(
    await blob.slice(Math.max(0, blob.size - 12)).arrayBuffer(),
  );
  let format: ImageFormat | undefined;
  if (isPng(header, tail, blob.size))
    format = { mime: 'image/png', extension: 'png' };
  else if (isJpeg(header, tail, blob.size)) {
    format = { mime: 'image/jpeg', extension: 'jpg' };
  } else if (isGif(header, tail, blob.size)) {
    format = { mime: 'image/gif', extension: 'gif' };
  } else if (isWebp(header, blob.size))
    format = { mime: 'image/webp', extension: 'webp' };
  else if (isAvif(header, blob.size))
    format = { mime: 'image/avif', extension: 'avif' };
  if (!format) {
    throw new InvalidImageError(
      'Optimized response is unsupported or malformed; expected PNG, JPEG, GIF, WebP or AVIF',
    );
  }
  verifiedFormats.set(blob, format);
  return format;
}

async function fetchImage(
  url: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: 'omit' });
  } catch (error) {
    throwIfAborted(signal);
    throw new TransientDownloadError(
      `Optimized image download failed: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }
  if (!response.ok) {
    cancelBody(response.body);
    const message = `Optimized image download returned HTTP ${response.status}`;
    if (response.status === 429 || response.status >= 500) {
      throw new TransientDownloadError(
        message,
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }
    throw new InvalidImageError(message);
  }
  let blob: Blob;
  try {
    blob = await readBoundedBlob(response, maxBytes, signal);
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof InvalidImageError) throw error;
    throw new TransientDownloadError(
      `Optimized image body download failed: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }
  const format = await inspectImageFormat(blob);
  throwIfAborted(signal);
  const typedBlob = blob.slice(0, blob.size, format.mime);
  verifiedFormats.set(typedBlob, format);
  return typedBlob;
}

async function downloadAttempt(
  url: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfAborted(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(
      new TransientDownloadError(
        'Optimized image download timed out after 90 seconds',
      ),
    );
  }, DOWNLOAD_TIMEOUT_MS);
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAttemptAbort = () => rejectAbort?.(controller.signal.reason);
  controller.signal.addEventListener('abort', onAttemptAbort, { once: true });
  try {
    // The race also bounds implementations where fetch/body cancellation stalls.
    return await Promise.race([
      fetchImage(url, maxBytes, controller.signal),
      abortPromise,
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
    controller.signal.removeEventListener('abort', onAttemptAbort);
    controller.abort();
  }
}

/** Retry only safe GET transfers. Never repeat an upload or replacement here. */
export async function downloadOptimizedImage(
  url: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new InvalidImageError(
      'The image download limit must be a positive integer',
    );
  }
  const limit = Math.min(maxBytes, MAX_OPTIMIZED_IMAGE_BYTES);
  for (let attempt = 0; attempt < MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Only start another attempt after this one fails.
      return await downloadAttempt(url, limit, signal);
    } catch (error) {
      throwIfAborted(signal);
      if (
        !(error instanceof TransientDownloadError) ||
        attempt === MAX_DOWNLOAD_ATTEMPTS - 1
      )
        throw error;
      const delay = Math.max(1000 * 2 ** attempt, error.retryAfterMs ?? 0);
      if (delay > MAX_RETRY_WAIT_MS) {
        throw new Error(
          `${error.message}; Retry-After exceeds the automatic retry wait limit`,
        );
      }
      await abortableDelay(delay, signal);
    }
  }
  throw new Error('Optimized image download exhausted all attempts');
}

export async function getOptimizedFilename(
  asset: { basename: string; path: string },
  blob: Blob,
): Promise<string> {
  const format = await inspectImageFormat(blob);
  const candidate =
    asset.basename || asset.path.split(/[\\/]/).pop() || 'optimized';
  const leaf = candidate.split(/[\\/]/).pop() || 'optimized';
  const base =
    leaf
      .replace(/\.(?:png|jpe?g|gif|webp|avif|svg|heic|heif|tiff?|bmp)$/i, '')
      .slice(0, 180)
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\p{Cc}/gu, '_')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .replace(/[\uD800-\uDBFF]$/, '') || 'optimized';
  return `${base}.${format.extension}`;
}
