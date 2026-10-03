import { buildClient } from '@datocms/cma-client-browser';

export const CMA_REQUEST_TIMEOUT_MS = 120_000;
export const CMA_MAX_ATTEMPTS = 6;
export const CMA_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Export cancelled.', 'AbortError');
  }
}

export function waitForExport(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Export cancelled.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function yieldToBrowser(): Promise<void> {
  return waitForExport(0);
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Concurrency must be a positive integer.');
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  async function worker() {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Each worker must finish one job before consuming another to bound concurrency.
        results[index] = await mapper(items[index], index);
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  if (failed) {
    throw failure;
  }
  return results;
}

// Await revocation so a long export never keeps hundreds of object URLs alive.
// The browser accepts the download independently; this cannot verify disk writes.
export async function downloadBlob(
  blob: Blob,
  filename: string,
): Promise<void> {
  const url = URL.createObjectURL(blob);
  const element = document.createElement('a');
  try {
    element.href = url;
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    await waitForExport(1000);
  } finally {
    element.remove();
    URL.revokeObjectURL(url);
  }
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const reset = response?.headers.get('x-ratelimit-reset');
  const retryAfter = response?.headers.get('retry-after');
  let delay = reset ? Number(reset) * 1000 : Number.NaN;
  if (!Number.isFinite(delay) && retryAfter) {
    delay = /^\d+(\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Date.parse(retryAfter) - Date.now();
  }
  return Math.min(
    60_000,
    Math.max(1000, Number.isFinite(delay) ? delay : 1000 * 2 ** attempt),
  );
}

export class ResponseSizeError extends Error {}

async function bufferResponse(response: Response): Promise<Response> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > CMA_MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ResponseSizeError(
      'An API response exceeds the browser export limit (32 MiB).',
    );
  }
  if (!response.body) {
    return response;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      // biome-ignore lint/performance/noAwaitInLoops: Consume only one streamed body chunk at a time.
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > CMA_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ResponseSizeError(
          'An API response exceeds the browser export limit (32 MiB).',
        );
      }
      parts.push(new Uint8Array(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(new Blob(parts), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function fetchAttempt(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  throwIfAborted(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const inputSignal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  inputSignal?.addEventListener('abort', abort, { once: true });
  signal?.addEventListener('abort', abort, { once: true });
  if (inputSignal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    // Consume the body while the deadline is still active, including slow bodies.
    const response = await fetch(input, { ...init, signal: controller.signal });
    return await bufferResponse(response);
  } finally {
    clearTimeout(timer);
    inputSignal?.removeEventListener('abort', abort);
    signal?.removeEventListener('abort', abort);
  }
}

async function readAttempt(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  lastAttempt: boolean,
): Promise<Response | undefined> {
  try {
    return await fetchAttempt(input, init, signal, timeoutMs);
  } catch (error) {
    throwIfAborted(signal);
    if (
      error instanceof ResponseSizeError ||
      init?.signal?.aborted ||
      lastAttempt
    )
      throw error;
    return undefined;
  }
}

export function createExportFetch(
  signal?: AbortSignal,
  options: {
    timeoutMs?: number;
    maxAttempts?: number;
    intervalMs?: number;
  } = {},
): typeof fetch {
  let gate = Promise.resolve();
  let lastStart = -Infinity;
  const interval = options.intervalMs ?? 100;
  async function rateLimit() {
    const previous = gate;
    const next = previous.then(async () => {
      await waitForExport(
        Math.max(0, lastStart + interval - Date.now()),
        signal,
      );
      lastStart = Date.now();
    });
    gate = next.catch(() => undefined);
    await next;
  }
  return async (input, init) => {
    const method =
      init?.method ?? (input instanceof Request ? input.method : 'GET');
    const attempts =
      method === 'GET' ? (options.maxAttempts ?? CMA_MAX_ATTEMPTS) : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      // biome-ignore lint/performance/noAwaitInLoops: Retry requests sequentially and obey the shared rate limit.
      await rateLimit();
      const response = await readAttempt(
        input,
        init,
        signal,
        options.timeoutMs ?? CMA_REQUEST_TIMEOUT_MS,
        attempt === attempts - 1,
      );
      if (
        response &&
        (![408, 429, 500, 502, 503, 504].includes(response.status) ||
          attempt === attempts - 1)
      )
        return response;
      await waitForExport(retryDelay(response, attempt), signal);
    }
    throw new Error('API request failed after automatic retries.');
  };
}

export function createExportClient(
  options: { apiToken: string; environment?: string; baseUrl?: string },
  signal?: AbortSignal,
) {
  return buildClient({
    ...options,
    autoRetry: false,
    // The bounded wrapper owns request deadlines and retries, including bodies.
    requestTimeout: CMA_MAX_ATTEMPTS * (CMA_REQUEST_TIMEOUT_MS + 60_000) + 5000,
    fetchFn: createExportFetch(signal),
  });
}
