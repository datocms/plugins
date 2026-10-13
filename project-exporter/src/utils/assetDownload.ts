import { createMD5 } from 'hash-wasm';
import { throwIfAborted } from './exportRuntime';
import type { ExportWorkspace } from './exportWorkspace';

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

export type AssetDownloadOptions = {
  signal?: AbortSignal;
  /** The size the upload's metadata gives, checked when positive. */
  expectedBytes?: number | null;
  /** The upload's MD5, checked when present. */
  md5?: string | null;
  onRetry?: (attempt: number) => void;
};

/**
 * The URL of an asset's original file: default image optimizations and SVG
 * sanitizing would otherwise change its bytes.
 */
export function originalFileUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('skip-default-optimizations', 'true');
  parsed.searchParams.set('svg-sanitize', 'false');
  return parsed.toString();
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

async function writeAssetBody(
  response: Response,
  target: WritableStream<Uint8Array>,
  resetIdleTimeout: () => void,
  options: AssetDownloadOptions,
): Promise<void> {
  if (!response.body) {
    throw new AssetDownloadError(
      'This browser cannot stream asset downloads; use a browser with Fetch response streaming support',
    );
  }
  const hash = options.md5 ? (await createMD5()).init() : undefined;
  const reader = response.body.getReader();
  const writer = target.getWriter();
  let receivedBytes = 0;
  try {
    while (true) {
      throwIfAborted(options.signal);
      resetIdleTimeout();
      // biome-ignore lint/performance/noAwaitInLoops: Each chunk goes to disk before the next is read.
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      hash?.update(value);
      await writer.write(value);
    }
    throwIfAborted(options.signal);
    if (
      options.expectedBytes &&
      options.expectedBytes > 0 &&
      receivedBytes !== options.expectedBytes
    ) {
      throw new AssetDownloadError(
        `Asset size does not match its metadata (${receivedBytes} bytes received; ${options.expectedBytes} expected)`,
        true,
      );
    }
    if (hash && hash.digest('hex') !== options.md5?.toLowerCase()) {
      throw new AssetDownloadError(
        'Asset content does not match its MD5 checksum',
      );
    }
    await writer.close();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await writer.abort(error).catch(() => undefined);
    throw error;
  }
}

async function downloadAttempt(
  url: string,
  target: WritableStream<Uint8Array>,
  options: AssetDownloadOptions,
): Promise<void> {
  const { signal } = options;
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
    await writeAssetBody(response, target, resetIdleTimeout, options);
  } catch (error) {
    await target.abort(error).catch(() => undefined);
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

/**
 * Downloads an asset into the workspace file `name`, on disk rather than in
 * memory, and resolves with the complete, checked file. Transient failures
 * start the file over, up to `ASSET_DOWNLOAD_MAX_ATTEMPTS` times.
 */
export async function downloadAssetFile(
  url: string,
  workspace: ExportWorkspace,
  name: string,
  options: AssetDownloadOptions = {},
): Promise<File> {
  for (let attempt = 1; attempt <= ASSET_DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Retry GET attempts sequentially after discarding incomplete bodies.
      await downloadAttempt(url, await workspace.writable(name), options);
      return await workspace.file(name);
    } catch (error) {
      throwIfAborted(options.signal);
      if (!isRetryable(error) || attempt === ASSET_DOWNLOAD_MAX_ATTEMPTS)
        throw error;
      options.onRetry?.(attempt + 1);
      // Respect backoff before starting the next safe GET attempt.
      await waitForRetry(retryDelay(error, attempt), options.signal);
    }
  }
  throw new AssetDownloadError('Asset download exhausted its retry attempts');
}
