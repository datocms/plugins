import {
  buildClient,
  LogLevel,
  TimeoutError,
} from '@datocms/cma-client-browser';

export const RETRY_ATTEMPTS = 6;

export type RetryOptions = {
  wait?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
  random?: () => number;
};

export type PacedFetchOptions = {
  fetchFn?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object'
    ? (value as UnknownRecord)
    : undefined;
}

function namedError(name: string, message: string): Error {
  // Plain Errors avoid the DOMException numeric `code`, which this CMA
  // transport expects to be a string when present.
  const error = new Error(message);
  error.name = name;
  return error;
}

function abortError(): Error {
  return namedError('AbortError', 'The operation was cancelled.');
}

function timeoutError(): Error {
  return namedError('TimeoutError', 'The DatoCMS request timed out.');
}

function normalizedFetchError(
  error: unknown,
  signal: AbortSignal | null | undefined,
  timedOut: boolean,
): unknown {
  if (signal?.aborted) return abortError();
  if (timedOut) return timeoutError();
  const name = asRecord(error)?.name;
  if (name === 'AbortError') return abortError();
  if (name === 'TimeoutError') return timeoutError();
  return error;
}

export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw abortError();
}

async function wait(
  milliseconds: number,
  signal?: AbortSignal | null,
): Promise<void> {
  throwIfAborted(signal);
  // setTimeout overflows above this value and otherwise retries immediately.
  const interval = Math.min(milliseconds, 2_147_483_647);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, interval);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  if (milliseconds > interval) await wait(milliseconds - interval, signal);
}

function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    // Attach both handlers even when already cancelled, so a later rejection
    // from a request that is still settling cannot become unhandled.
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(signal.aborted ? abortError() : error);
      },
    );
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestWithTimeout(
  fetchFn: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const originalSignal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  throwIfAborted(originalSignal);
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(abortError());
      controller.abort();
    };
    originalSignal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      reject(timeoutError());
      controller.abort();
    }, timeoutMs);
  });

  const completed = (async () => {
    const response = await fetchFn(input, {
      ...init,
      signal: controller.signal,
    });
    // The CMA transport clears its timer before response.json(). Buffering
    // here keeps a stalled/truncated response body inside our timeout.
    const body = await response.arrayBuffer();
    const noBody = [204, 205, 304].includes(response.status);
    return new Response(noBody ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  })().catch((error: unknown) => {
    throw normalizedFetchError(error, originalSignal, timedOut);
  });

  try {
    return await Promise.race([completed, interrupted]);
  } finally {
    clearTimeout(timer);
    if (onAbort) originalSignal?.removeEventListener('abort', onAbort);
  }
}

/** Spaces request starts without serializing their network responses. */
export function createPacedFetch(
  options: PacedFetchOptions = {},
): typeof fetch {
  const fetchFn =
    options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 100;
  const timeoutMs = options.timeoutMs ?? 45_000;
  let nextStartAt = 0;
  let starts: Promise<void> = Promise.resolve();

  return async (input, init) => {
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    throwIfAborted(signal);
    const start = starts.then(async () => {
      throwIfAborted(signal);
      const delay = Math.max(0, nextStartAt - now());
      if (delay > 0) {
        if (options.wait) await abortable(options.wait(delay), signal);
        else await wait(delay, signal);
      }
      throwIfAborted(signal);
      // Use the actual wake time: timer throttling must not bunch later starts.
      nextStartAt = now() + intervalMs;
      // Start inside the queue, then release it while the response is pending.
      const response = requestWithTimeout(fetchFn, input, init, timeoutMs);
      // Cancellation can win between starting fetch and returning this promise.
      // Keep that abandoned response observed while preserving its rejection.
      void response.catch(() => undefined);
      return { response };
    });
    starts = start.then(
      () => undefined,
      () => undefined,
    );
    const { response } = await abortable(start, signal);
    return response;
  };
}

// All clients in this plugin share their start pacing, including hook reads
// and descendant updates. Retries are owned by the read/write callers.
const treeFetch = createPacedFetch();

export function buildTreeClient(options: {
  apiToken: string;
  environment: string;
  baseUrl?: string;
}) {
  return buildClient({
    ...options,
    autoRetry: false,
    requestTimeout: 60_000,
    fetchFn: treeFetch,
    logLevel: LogLevel.NONE,
  });
}

function responseOf(error: unknown): UnknownRecord | undefined {
  return asRecord(asRecord(error)?.response);
}

function errorAttributes(error: unknown): UnknownRecord[] {
  const record = asRecord(error);
  const body = asRecord(responseOf(error)?.body);
  const entities = Array.isArray(record?.errors)
    ? record.errors
    : Array.isArray(body?.data)
      ? body.data
      : [];
  return entities.flatMap((entity) => {
    const attributes = asRecord(asRecord(entity)?.attributes);
    return attributes ? [attributes] : [];
  });
}

export function isStaleVersionError(error: unknown): boolean {
  if (
    errorAttributes(error).some(({ code }) => code === 'STALE_ITEM_VERSION')
  ) {
    return true;
  }
  const findError = asRecord(error)?.findError;
  if (typeof findError !== 'function') return false;
  try {
    return Boolean(findError.call(error, 'STALE_ITEM_VERSION'));
  } catch {
    return false;
  }
}

export function isRetryableError(error: unknown): boolean {
  const status = responseOf(error)?.status;
  if (typeof status === 'number') {
    if ([401, 403, 404, 422].includes(status)) return false;
    return (
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      errorAttributes(error).some(({ transient }) => transient === true)
    );
  }
  if (error instanceof TypeError || error instanceof TimeoutError) return true;
  const record = asRecord(error);
  if (record?.name === 'TimeoutError' || record?.name === 'AbortError')
    return true;
  return (
    typeof record?.code === 'string' &&
    /^(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)$/.test(
      record.code,
    )
  );
}

function headerValue(error: unknown, name: string): string | undefined {
  const headers = responseOf(error)?.headers;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const record = asRecord(headers);
  const value = record
    ? Object.entries(record).find(([key]) => key.toLowerCase() === name)?.[1]
    : undefined;
  return typeof value === 'string' ? value : undefined;
}

function secondsDelay(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 0;
}

export function retryDelay(
  error: unknown,
  attempt: number,
  random: () => number = Math.random,
): number {
  const jitter = 0.8 + Math.max(0, Math.min(1, random())) * 0.4;
  const backoff = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt)) * jitter;
  const retryAfter = headerValue(error, 'retry-after');
  const retryDate =
    retryAfter && !Number.isFinite(Number(retryAfter))
      ? Date.parse(retryAfter)
      : Number.NaN;
  return Math.max(
    backoff,
    secondsDelay(headerValue(error, 'x-ratelimit-reset')),
    secondsDelay(retryAfter),
    Number.isFinite(retryDate) ? Math.max(0, retryDate - Date.now()) : 0,
  );
}

export async function waitForRetry(
  error: unknown,
  attempt: number,
  options: RetryOptions = {},
): Promise<void> {
  throwIfAborted(options.signal);
  const delay = retryDelay(error, attempt, options.random);
  if (options.wait) await abortable(options.wait(delay), options.signal);
  else await wait(delay, options.signal);
  throwIfAborted(options.signal);
}

/** Six bounded attempts for reads only; writes must reconcile before retrying. */
export async function readWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(options.signal);
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Each retry must settle before another read starts.
      return await abortable(operation(), options.signal);
    } catch (error) {
      throwIfAborted(options.signal);
      if (!isRetryableError(error) || attempt >= RETRY_ATTEMPTS - 1)
        throw error;
      await waitForRetry(error, attempt, options);
    }
  }
}
