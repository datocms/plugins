import { throwIfAborted } from './exportRuntime';

export const ASSET_REQUEST_IDLE_TIMEOUT_MS = 60_000;
export const ASSET_DOWNLOAD_MAX_ATTEMPTS = 4;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_BASE_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 60_000;

export class AssetDownloadError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AssetDownloadError';
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Asset export cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readAssetBody(
  response: Response,
  maxBytes: number,
  resetIdleTimeout: () => void,
  signal?: AbortSignal,
  expectedBytes?: number,
): Promise<Blob> {
  const contentLengthHeader = response.headers.get('Content-Length');
  const contentLength =
    contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AssetDownloadError(
      `Asset exceeds this ZIP's remaining ${maxBytes} byte budget (${contentLength} bytes reported by server)`,
    );
  }

  if (!response.body) {
    // A blob() fallback could allocate an unbounded response before checking it.
    throw new AssetDownloadError(
      'This browser cannot stream asset downloads safely; use a browser with Fetch response streaming support',
    );
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      resetIdleTimeout();
      // biome-ignore lint/performance/noAwaitInLoops: Read incrementally to enforce the actual byte budget.
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        throw new AssetDownloadError(
          `Asset exceeds this ZIP's remaining ${maxBytes} byte budget (${receivedBytes} bytes received)`,
        );
      }
      chunks.push(new Uint8Array(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  throwIfAborted(signal);
  if (
    expectedBytes !== undefined &&
    expectedBytes > 0 &&
    receivedBytes !== expectedBytes
  ) {
    throw new AssetDownloadError(
      `Asset size does not match its metadata (${receivedBytes} bytes received; ${expectedBytes} expected)`,
      true,
    );
  }
  return new Blob(chunks, {
    type: response.headers.get('Content-Type') ?? 'application/octet-stream',
  });
}

async function downloadAttempt(
  url: string,
  maxBytes: number,
  signal?: AbortSignal,
  expectedBytes?: number,
): Promise<Blob> {
  throwIfAborted(signal);
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const onAbort = () => controller.abort();
  const resetIdleTimeout = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ASSET_REQUEST_IDLE_TIMEOUT_MS);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  resetIdleTimeout();

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AssetDownloadError(
        `HTTP ${response.status} while downloading asset`,
        RETRYABLE_STATUSES.has(response.status),
        retryAfterMs(response.headers.get('Retry-After')),
      );
    }

    return await readAssetBody(
      response,
      maxBytes,
      resetIdleTimeout,
      signal,
      expectedBytes,
    );
  } catch (error) {
    throwIfAborted(signal);
    if (timedOut) {
      throw new AssetDownloadError(
        `Asset download stalled for ${ASSET_REQUEST_IDLE_TIMEOUT_MS / 1000} seconds`,
        true,
      );
    }
    throw error;
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof AssetDownloadError
    ? error.retryable
    : error instanceof TypeError;
}

function retryDelay(error: unknown, attempt: number): number {
  const requestedDelay =
    error instanceof AssetDownloadError ? error.retryAfterMs : undefined;
  return Math.min(
    MAX_RETRY_DELAY_MS,
    Math.max(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), requestedDelay ?? 0),
  );
}

/** Retry only GET requests; no ZIP is added or downloaded before a full response. */
export async function downloadAssetFile(
  url: string,
  maxBytes: number,
  signal?: AbortSignal,
  onRetry?: (attempt: number) => void,
  expectedBytes?: number,
): Promise<Blob> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new AssetDownloadError(
      'Asset download byte budget must be non-negative',
    );
  }

  for (let attempt = 1; attempt <= ASSET_DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Retry GET attempts sequentially after discarding incomplete bodies.
      return await downloadAttempt(url, maxBytes, signal, expectedBytes);
    } catch (error) {
      throwIfAborted(signal);
      if (!isRetryable(error) || attempt === ASSET_DOWNLOAD_MAX_ATTEMPTS)
        throw error;
      onRetry?.(attempt + 1);
      // Respect backoff before starting the next safe GET attempt.
      await waitForRetry(retryDelay(error, attempt), signal);
    }
  }
  throw new AssetDownloadError('Asset download exhausted its retry attempts');
}
