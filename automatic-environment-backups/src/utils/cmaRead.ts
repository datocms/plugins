import {
  ApiError,
  buildClient,
  TimeoutError,
} from '@datocms/cma-client-browser';
import { parseRetryAfterMs } from './lambdaHttp';

const READ_TIMEOUT_MS = 10000;
const READ_MAX_ATTEMPTS = 3;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

type CmaReadOptions = {
  apiToken: string;
  environment: string;
  baseUrl?: string;
  signal?: AbortSignal;
};

export class CmaReadTimeoutError extends Error {
  constructor() {
    super('The DatoCMS read exceeded its 10-second deadline.');
    this.name = 'CmaReadTimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class CmaReadNetworkError extends Error {
  constructor() {
    super('The DatoCMS read failed because of a network error.');
    this.name = 'CmaReadNetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const abortError = (): Error => {
  // The SDK checks error.code as a string. DOMException.code is numeric.
  const error = new Error('The DatoCMS read was cancelled.');
  error.name = 'AbortError';
  return error;
};

const throwIfCancelled = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw signal.reason;
  }
};

const readHeader = (
  headers: Record<string, string>,
  name: string,
): string | null => {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      return value;
    }
  }
  return null;
};

const retryDelayMs = (error: unknown, attempt: number): number | null => {
  const backoff = 250 * 2 ** (attempt - 1);
  if (error instanceof CmaReadNetworkError || error instanceof TimeoutError) {
    return backoff;
  }
  if (
    !(error instanceof ApiError) ||
    !RETRY_STATUSES.has(error.response.status)
  ) {
    return null;
  }

  const reset = readHeader(error.response.headers, 'x-ratelimit-reset');
  const resetSeconds = reset?.trim() ? Number(reset) : Number.NaN;
  const resetMs =
    Number.isFinite(resetSeconds) && resetSeconds >= 0
      ? resetSeconds * 1000
      : 0;
  return Math.max(
    backoff,
    resetMs,
    parseRetryAfterMs(readHeader(error.response.headers, 'retry-after')) ?? 0,
  );
};

const preserveRetryCooldown = (
  error: unknown,
  delayMs: number | null,
): void => {
  if (
    error instanceof ApiError &&
    delayMs !== null &&
    Number.isFinite(delayMs)
  ) {
    // The surrounding continuous poller also needs the cooldown when this
    // short metadata read cannot accommodate it itself.
    Object.assign(error, { retryAfterMs: delayMs });
  }
};

const waitForRetry = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

/**
 * Run one idempotent CMA read. Retries repeat the entire callback, so it must
 * contain only reads; the fetch guard rejects writes before sending them.
 * One deadline covers retries, fetching, and SDK response-body consumption.
 */
export const readCma = async <T>(
  { apiToken, environment, baseUrl, signal }: CmaReadOptions,
  operation: (client: ReturnType<typeof buildClient>) => Promise<T>,
): Promise<T> => {
  if (signal?.aborted) {
    throw abortError();
  }

  const controller = new AbortController();
  const requestSignal = controller.signal;
  const deadline = Date.now() + READ_TIMEOUT_MS;
  const abortFromParent = () => controller.abort(abortError());
  signal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new CmaReadTimeoutError()),
    READ_TIMEOUT_MS,
  );
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(requestSignal.reason);
    requestSignal.addEventListener('abort', onAbort, { once: true });
  });

  const fetchFn: typeof fetch = async (input, init) => {
    if (requestSignal.aborted) {
      throw requestSignal.reason;
    }
    const method =
      init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method.toUpperCase() !== 'GET') {
      throw new Error('readCma only permits GET requests.');
    }
    try {
      return await fetch(input, { ...init, signal: requestSignal });
    } catch (error) {
      if (requestSignal.aborted) {
        throw requestSignal.reason;
      }
      // Only fetch TypeErrors indicate network failures. Do not retry a
      // callback TypeError, JSON SyntaxError, or an authentication failure.
      if (error instanceof TypeError) {
        throw new CmaReadNetworkError();
      }
      throw error;
    }
  };

  const completed = async (): Promise<T> => {
    const client = buildClient({
      apiToken,
      environment,
      baseUrl,
      autoRetry: false,
      requestTimeout: READ_TIMEOUT_MS,
      fetchFn,
    });
    for (let attempt = 1; attempt <= READ_MAX_ATTEMPTS; attempt++) {
      throwIfCancelled(requestSignal);
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Safe read retries must remain sequential.
        return await operation(client);
      } catch (error) {
        throwIfCancelled(requestSignal);
        const delayMs = retryDelayMs(error, attempt);
        if (
          attempt === READ_MAX_ATTEMPTS ||
          delayMs === null ||
          delayMs >= deadline - Date.now()
        ) {
          // Preserve the API error if its mandated delay cannot fit. Never
          // retry early just to stay inside the deadline.
          preserveRetryCooldown(error, delayMs);
          throw error;
        }
        await waitForRetry(delayMs, requestSignal);
      }
    }
    throw new Error('The DatoCMS read exhausted its attempt limit.');
  };

  try {
    // The envelope also bounds a fetch mock/SDK body reader ignoring abort.
    return await Promise.race([completed(), interrupted]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
    if (onAbort) {
      requestSignal.removeEventListener('abort', onAbort);
    }
  }
};
