import {
  type ApiTypes,
  buildClient,
  LogLevel,
} from '@datocms/cma-client-browser';
import type { CMAClient } from '../types';

export interface SafeFetchOptions {
  maxRetries?: number;
  requestIntervalMs?: number;
  attemptTimeoutMs?: number;
  maxDurationMs?: number;
  now?: () => number;
  random?: () => number;
  wait?: (milliseconds: number, signal?: AbortSignal | null) => Promise<void>;
}

export interface JobPollingOptions {
  maxDurationMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

function abortError(): Error {
  // The installed CMA transport assumes error.code, when present, is a string.
  // DOMException has a numeric code, so do not let it mask cancellation.
  const error = new Error('DatoCMS request was cancelled');
  error.name = 'AbortError';
  return error;
}

function timeoutError(): Error {
  const error = new Error(
    'DatoCMS request timed out. A write may have completed; it was not repeated automatically.',
  );
  error.name = 'TimeoutError';
  return error;
}

function throwIfCancelled(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw abortError();
}

function wait(
  milliseconds: number,
  signal?: AbortSignal | null,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryDelay(response: Response, fallback: number, now: number): number {
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  const date = retryAfter === null ? Number.NaN : Date.parse(retryAfter);
  return Math.max(
    fallback,
    Number.isFinite(reset) && reset >= 0 ? reset * 1000 : 0,
    Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : Number.isFinite(date)
        ? Math.max(0, date - now)
        : 0,
  );
}

type FetchSettings = Required<SafeFetchOptions>;

class RequestScheduler {
  private nextRequestAt = 0;
  private cooldownUntil = 0;
  private tail = Promise.resolve();

  constructor(private readonly settings: FetchSettings) {}

  beforeRequest(
    signal: AbortSignal | null | undefined,
    deadline: number,
  ): Promise<void> {
    const reservation = this.tail.then(() => this.reserve(signal, deadline));
    this.tail = reservation.catch(() => undefined);
    return reservation;
  }

  onRateLimit(delay: number): void {
    this.cooldownUntil = Math.max(
      this.cooldownUntil,
      this.settings.now() + delay,
    );
  }

  private async reserve(
    signal: AbortSignal | null | undefined,
    deadline: number,
  ): Promise<void> {
    throwIfCancelled(signal);
    for (;;) {
      const reservedAt = Math.max(
        this.settings.now(),
        this.nextRequestAt,
        this.cooldownUntil,
      );
      if (reservedAt >= deadline) throw timeoutError();
      if (reservedAt <= this.settings.now()) break;
      // biome-ignore lint/performance/noAwaitInLoops: Dispatch waits must recheck the shared rate-limit cooldown before sending.
      await this.settings.wait(reservedAt - this.settings.now(), signal);
      // Check again: another in-flight request may have extended the cooldown.
    }
    throwIfCancelled(signal);
    this.nextRequestAt = this.settings.now() + this.settings.requestIntervalMs;
  }
}

async function bufferResponse(response: Response): Promise<Response> {
  if (!response.body) return response;
  // Complete the transfer inside the attempt timeout. Buffer only this response,
  // as a Blob, so an interrupted body can retry safely on reads and a stalled
  // transfer cannot outlive the request budget. The SDK parses the same page.
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function fetchAttempt(
  fetchFn: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  signal: AbortSignal | null | undefined,
  settings: FetchSettings,
  deadline: number,
): Promise<Response> {
  throwIfCancelled(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.min(settings.attemptTimeoutMs, Math.max(1, deadline - settings.now())),
  );
  try {
    return await bufferResponse(
      await fetchFn(input, { ...init, signal: controller.signal }),
    );
  } catch (error) {
    throwIfCancelled(signal);
    if (timedOut) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function backoff(attempt: number, settings: FetchSettings): number {
  return (
    Math.min(1000 * 2 ** attempt, 30_000) * (0.8 + settings.random() * 0.4)
  );
}

function canRetry(
  attempt: number,
  deadline: number,
  delay: number,
  settings: FetchSettings,
): boolean {
  return attempt < settings.maxRetries && settings.now() + delay < deadline;
}

async function performRequest(
  fetchFn: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  settings: FetchSettings,
  scheduler: RequestScheduler,
): Promise<Response> {
  const request =
    typeof Request !== 'undefined' && input instanceof Request
      ? input
      : undefined;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  const signal = init?.signal ?? request?.signal;
  const deadline = settings.now() + settings.maxDurationMs;

  for (let attempt = 0; ; attempt++) {
    // biome-ignore lint/performance/noAwaitInLoops: A retry depends on the preceding response and must respect request pacing.
    await scheduler.beforeRequest(signal, deadline);
    let response: Response;
    try {
      // Clone a Request body to preserve it after an explicit 429 rejection.
      response = await fetchAttempt(
        fetchFn,
        request ? request.clone() : input,
        init,
        signal,
        settings,
        deadline,
      );
    } catch (error) {
      await waitForReadRetry(
        error,
        isRead,
        attempt,
        deadline,
        signal,
        settings,
      );
      continue;
    }
    if (
      !(await waitForHttpRetry(
        response,
        isRead,
        attempt,
        deadline,
        signal,
        settings,
        scheduler,
      ))
    ) {
      return response;
    }
  }
}

async function waitForReadRetry(
  error: unknown,
  isRead: boolean,
  attempt: number,
  deadline: number,
  signal: AbortSignal | null | undefined,
  settings: FetchSettings,
): Promise<void> {
  throwIfCancelled(signal);
  const delay = backoff(attempt, settings);
  if (!isRead || !canRetry(attempt, deadline, delay, settings)) throw error;
  await settings.wait(delay, signal);
}

async function waitForHttpRetry(
  response: Response,
  isRead: boolean,
  attempt: number,
  deadline: number,
  signal: AbortSignal | null | undefined,
  settings: FetchSettings,
  scheduler: RequestScheduler,
): Promise<boolean> {
  const retryable =
    response.status === 429 ||
    (isRead && (response.status === 408 || response.status >= 500));
  if (!retryable) return false;
  const delay = retryDelay(
    response,
    backoff(attempt, settings),
    settings.now(),
  );
  if (response.status === 429) scheduler.onRateLimit(delay);
  if (!canRetry(attempt, deadline, delay, settings)) return false;
  await response.body?.cancel().catch(() => undefined);
  await settings.wait(delay, signal);
  return true;
}

/**
 * Paces this client's requests below the CMA's 60 requests / 3 seconds quota.
 * Reads can be repeated after transport/server failures. Writes are repeated
 * only after an explicit 429 rejection, never after an uncertain response.
 */
export function createSafeFetch(
  fetchFn: typeof fetch = globalThis.fetch,
  options: SafeFetchOptions = {},
): typeof fetch {
  const settings: FetchSettings = {
    maxRetries: options.maxRetries ?? 5,
    requestIntervalMs: options.requestIntervalMs ?? 75,
    attemptTimeoutMs: options.attemptTimeoutMs ?? 60_000,
    maxDurationMs: options.maxDurationMs ?? 10 * 60_000,
    now: options.now ?? Date.now,
    random: options.random ?? Math.random,
    wait: options.wait ?? wait,
  };
  const scheduler = new RequestScheduler(settings);
  return (input, init) =>
    performRequest(fetchFn, input, init, settings, scheduler);
}

function jobTimeoutError(): Error {
  const error = new Error(
    'DatoCMS job confirmation timed out. Its final outcome is unknown; the operation was not submitted again.',
  );
  error.name = 'TimeoutError';
  return error;
}

function isPendingJob(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('response' in error))
    return false;
  const response = error.response;
  return (
    response !== null &&
    typeof response === 'object' &&
    'status' in response &&
    response.status === 404
  );
}

async function readJobWithinBudget(
  client: Pick<CMAClient, 'jobResults'>,
  jobId: string,
  remainingMs: number,
): Promise<ApiTypes.JobResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(jobTimeoutError()), remainingMs);
  });
  try {
    // A read that outlives the polling deadline is harmless; never resubmit the
    // original mutation when its asynchronous result remains uncertain.
    return await Promise.race([client.jobResults.find(jobId), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Polls the existing job only, with a deadline and at most five seconds between reads. */
export async function boundedJobResult(
  client: Pick<CMAClient, 'jobResults'>,
  jobId: string,
  options: JobPollingOptions = {},
): Promise<ApiTypes.JobResult> {
  const now = options.now ?? Date.now;
  const sleep = options.wait ?? wait;
  const deadline = now() + (options.maxDurationMs ?? 20 * 60_000);
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) throw jobTimeoutError();
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Pending asynchronous jobs must be polled without resubmitting their mutation.
      return await readJobWithinBudget(client, jobId, remaining);
    } catch (error) {
      if (!isPendingJob(error)) throw error;
    }
    const delay = Math.min(
      1000 * 2 ** Math.min(attempt, 3),
      5000,
      deadline - now(),
    );
    if (delay <= 0) throw jobTimeoutError();
    await sleep(delay);
  }
}

export function createClient(
  apiToken: string,
  environment: string,
  baseUrl?: string,
): CMAClient {
  const client = buildClient({
    apiToken,
    environment,
    baseUrl,
    autoRetry: false,
    fetchFn: createSafeFetch(),
    // The transport wrapper owns attempt timeouts and a bounded retry budget.
    requestTimeout: 11 * 60_000,
    logLevel: LogLevel.NONE,
  });
  client.jobResultsFetcher = (jobId) => boundedJobResult(client, jobId);
  return client;
}
