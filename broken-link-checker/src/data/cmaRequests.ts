import { ApiError, TimeoutError } from '@datocms/cma-client-browser';

export const CMA_READ_TIMEOUT_MS = 30_000;
const READ_ATTEMPTS = 4;

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('The scan was cancelled.', 'AbortError');
}

export function waitForRead(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (!Number.isFinite(ms) || ms > 2_147_483_647) {
    return Promise.reject(
      new Error(
        'The API requested a wait longer than the browser can schedule; some records could not be loaded.',
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('The scan was cancelled.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Bound host/SDK promises too: late outcomes remain observed after cancellation. */
export function cancellableRead<T>(
  request: Promise<T>,
  signal?: AbortSignal,
  timeoutMs = CMA_READ_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('The scan was cancelled.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The content request timed out. Scan again to retry.'));
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    request.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
    if (signal?.aborted) abort();
  });
}

/** 75ms between requests leaves headroom below CMA's 60 requests / 3 seconds. */
export class CmaReadScheduler {
  private nextAt = 0;
  private cooldownUntil = 0;

  async beforeRead(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const at = Math.max(Date.now(), this.nextAt, this.cooldownUntil);
    this.nextAt = at + 75;
    if (at > Date.now()) await waitForRead(at - Date.now(), signal);
    while (Date.now() < this.cooldownUntil) {
      // biome-ignore lint/performance/noAwaitInLoops: A concurrent count request can extend the shared rate-limit cooldown.
      await waitForRead(this.cooldownUntil - Date.now(), signal);
    }
    throwIfAborted(signal);
  }

  rateLimited(delayMs: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delayMs);
  }
}

export function retryDelay(error: unknown, attempt: number): number {
  if (error instanceof ApiError) {
    const header = error.response.headers['retry-after'];
    const seconds = Number(
      header ?? error.response.headers['x-ratelimit-reset'],
    );
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = header ? Date.parse(header) : Number.NaN;
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(1_000 * 2 ** attempt, 30_000);
}

/** Retry read requests only; permission, authentication and malformed data fail immediately. */
function transientReadFailure(error: unknown): boolean {
  if (error instanceof ApiError) {
    return (
      error.response.status === 429 ||
      error.response.status >= 500 ||
      error.errors.some((entry) => entry.attributes.transient)
    );
  }
  return (
    error instanceof TimeoutError ||
    error instanceof TypeError ||
    (error instanceof Error && error.name === 'CmaReadTimeoutError')
  );
}

export async function retryCmaRead<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
  scheduler?: CmaReadScheduler,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    throwIfAborted(signal);
    if (scheduler) {
      // biome-ignore lint/performance/noAwaitInLoops: Automatic retries are bounded and must honor the shared CMA pacing.
      await scheduler.beforeRead(signal);
    }
    try {
      const value = await operation();
      throwIfAborted(signal);
      return value;
    } catch (error) {
      throwIfAborted(signal);
      const status =
        error instanceof ApiError ? error.response.status : undefined;
      const delay = retryDelay(error, attempt);
      if (status === 429) scheduler?.rateLimited(delay);
      if (!transientReadFailure(error) || attempt >= READ_ATTEMPTS - 1)
        throw error;
      await waitForRead(delay, signal);
    }
  }
}

/** The SDK timeout only covers response headers; consume the body under the same deadline. */
export function createCmaReadFetch(
  signal?: AbortSignal,
  fetchFn: typeof fetch = (...args) => fetch(...args),
  timeoutMs = CMA_READ_TIMEOUT_MS,
): typeof fetch {
  return async (input, init) => {
    throwIfAborted(signal);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const read = (async () => {
        const response = await fetchFn(input, {
          ...init,
          signal: controller.signal,
        });
        const body = await response.arrayBuffer();
        return new Response(response.status === 204 ? null : body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      })();
      // Even an injected transport that ignores AbortSignal has a bounded lifetime.
      return await cancellableRead(read, controller.signal, timeoutMs + 1);
    } catch (error) {
      throwIfAborted(signal);
      if (timedOut) {
        const failure = new Error(
          'The content request timed out. Scan again to retry.',
        );
        failure.name = 'CmaReadTimeoutError';
        throw failure;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}
