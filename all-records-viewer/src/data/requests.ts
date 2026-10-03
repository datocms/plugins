export const CMA_REQUEST_INTERVAL_MS = 150;
export const CMA_REQUEST_TIMEOUT_MS = 30_000;
export const CMA_JOB_TIMEOUT_MS = 30 * 60_000;
export const CMA_MAX_RATE_LIMIT_WAIT_MS = 60_000;

export class CmaRateLimitWaitError extends Error {
  readonly code = 'RATE_LIMIT_WAIT_EXCEEDED';
  readonly status = 429;
  readonly response = { status: 429 as const };

  constructor(readonly retryAfterMs: number) {
    super(
      'Rate limit exceeded. The server requested a wait longer than 60 seconds; no further attempt was sent.',
    );
    this.name = 'CmaRateLimitWaitError';
  }
}

function abortError(): DOMException {
  return new DOMException('Operation cancelled', 'AbortError');
}

export function waitForRequest(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

type RequestSlot = {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abort: () => void;
};

// Keep request starts spaced even after a shared 429 cooldown. Reserving slots
// in advance would release many waiting workers together when that cooldown ends.
export class CmaRequestScheduler {
  private nextRequestAt = 0;
  private cooldownUntil = 0;
  private active = 0;
  private queue: RequestSlot[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly intervalMs = CMA_REQUEST_INTERVAL_MS,
    private readonly maxConcurrent = 4,
  ) {}

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    const cooldown = this.cooldownUntil - Date.now();
    if (cooldown > CMA_MAX_RATE_LIMIT_WAIT_MS) {
      return Promise.reject(new CmaRateLimitWaitError(cooldown));
    }
    return new Promise((resolve, reject) => {
      const slot: RequestSlot = {
        resolve,
        reject,
        signal,
        abort: () => {
          this.queue = this.queue.filter((queued) => queued !== slot);
          reject(abortError());
          this.drain();
        },
      };
      signal?.addEventListener('abort', slot.abort, { once: true });
      this.queue.push(slot);
      this.drain();
    });
  }

  onRateLimit(delayMs: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delayMs);
    this.drain();
  }

  private drain(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const cooldown = this.cooldownUntil - Date.now();
    if (cooldown > CMA_MAX_RATE_LIMIT_WAIT_MS) {
      for (const slot of this.queue) {
        slot.signal?.removeEventListener('abort', slot.abort);
        slot.reject(new CmaRateLimitWaitError(cooldown));
      }
      this.queue = [];
      return;
    }
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const delay =
        Math.max(this.nextRequestAt, this.cooldownUntil) - Date.now();
      if (delay > 0) {
        this.timer = setTimeout(() => this.drain(), delay);
        return;
      }

      const slot = this.queue.shift();
      if (!slot) return;
      slot.signal?.removeEventListener('abort', slot.abort);
      if (slot.signal?.aborted) {
        slot.reject(abortError());
        continue;
      }

      this.active += 1;
      this.nextRequestAt = Date.now() + this.intervalMs;
      let released = false;
      slot.resolve(() => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.drain();
      });
    }
  }
}

export class CmaRequestTimeoutError extends Error {
  readonly code = 'CMA_REQUEST_TIMEOUT';

  constructor() {
    super('The API request timed out.');
    this.name = 'CmaRequestTimeoutError';
  }
}

export class MutationOutcomeUnknownError extends Error {
  readonly code = 'MUTATION_OUTCOME_UNKNOWN';

  constructor(
    readonly originalError: unknown,
    readonly status: number | null = null,
    message = 'The result of this batch could not be confirmed. It may have been applied. Refresh records before trying it again.',
  ) {
    super(message);
    this.name = 'MutationOutcomeUnknownError';
  }
}

export class JobPollingError extends MutationOutcomeUnknownError {
  constructor(
    readonly jobId: string,
    error: unknown,
  ) {
    super(
      error,
      null,
      `Batch job ${jobId} was accepted, but its result could not be confirmed. Refresh records before trying it again.`,
    );
    this.name = 'JobPollingError';
  }
}

export function isMutationOutcomeUnknown(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'MUTATION_OUTCOME_UNKNOWN'
  );
}

function retryDelay(headers: Headers, attempt: number): number {
  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (retryAfter.trim() && !Number.isNaN(seconds) && seconds >= 0)
      return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }

  // DatoCMS documents this as seconds until refill, rather than a Unix timestamp.
  const reset = headers.get('x-ratelimit-reset');
  const seconds = reset !== null ? Number(reset) : Number.NaN;
  if (reset?.trim() && !Number.isNaN(seconds) && seconds >= 0)
    return seconds * 1000;
  return Math.min(1000 * 2 ** attempt, 30_000);
}

class InvalidResponseError extends Error {
  constructor(readonly status: number) {
    super('The API returned an invalid response.');
    this.name = 'InvalidResponseError';
  }
}

type CmaFetchOptions = {
  fetchFn?: typeof fetch;
  scheduler?: CmaRequestScheduler;
  requestTimeoutMs?: number;
  maxRetries?: number;
};

const sharedScheduler = new CmaRequestScheduler();

type RequestContext = {
  input: Parameters<typeof fetch>[0];
  init: Parameters<typeof fetch>[1];
  signal?: AbortSignal;
  read: boolean;
};

function requestContext(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): RequestContext {
  const request = input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  return {
    input,
    init,
    signal: init?.signal ?? request?.signal ?? undefined,
    read: method === 'GET' || method === 'HEAD',
  };
}

async function fetchBufferedResponse(
  context: RequestContext,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetchFn(context.input, { ...context.init, signal });
  const contentType = response.headers.get('content-type');
  if (
    response.status !== 429 &&
    contentType &&
    !contentType.includes('application/json')
  ) {
    throw new InvalidResponseError(response.status);
  }
  // Include response body consumption in the real abortable timeout. The SDK's
  // own timer covers only response headers and does not abort fetch.
  const body = response.status === 204 ? null : await response.text();
  if (body !== null && response.status !== 429) JSON.parse(body);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function requestAttempt(
  context: RequestContext,
  fetchFn: typeof fetch,
  scheduler: CmaRequestScheduler,
  timeoutMs: number,
): Promise<Response> {
  const release = await scheduler.acquire(context.signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  context.signal?.addEventListener('abort', abort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let dispatched = false;
  try {
    if (context.signal?.aborted) throw abortError();
    dispatched = true;
    return await Promise.race([
      fetchBufferedResponse(context, fetchFn, controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new CmaRequestTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (!context.read && dispatched) {
      throw new MutationOutcomeUnknownError(
        error,
        error instanceof InvalidResponseError ? error.status : null,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    context.signal?.removeEventListener('abort', abort);
    release();
  }
}

function errorRetryDelay(
  error: unknown,
  context: RequestContext,
  attempt: number,
  maxRetries: number,
): number {
  if (context.signal?.aborted || !context.read || attempt >= maxRetries)
    throw error;
  const transient =
    error instanceof TypeError ||
    error instanceof SyntaxError ||
    error instanceof CmaRequestTimeoutError ||
    error instanceof InvalidResponseError;
  if (!transient) throw error;
  return Math.min(1000 * 2 ** attempt, 30_000);
}

async function responseRetryDelay(
  response: Response,
  context: RequestContext,
  scheduler: CmaRequestScheduler,
  attempt: number,
  maxRetries: number,
): Promise<number | null> {
  if (response.status === 429) {
    const delay = retryDelay(response.headers, attempt);
    scheduler.onRateLimit(delay);
    await response.body?.cancel();
    if (delay > CMA_MAX_RATE_LIMIT_WAIT_MS) {
      // Do not cap an advertised delay and retry too early. This is a confirmed
      // 429 rejection, so it must not be classified as an uncertain mutation.
      throw new CmaRateLimitWaitError(delay);
    }
    return attempt >= maxRetries ? null : delay;
  }
  if (response.status < 500) return null;
  if (!context.read) {
    throw new MutationOutcomeUnknownError(
      new Error(`API responded with HTTP ${response.status}.`),
      response.status,
    );
  }
  return attempt >= maxRetries ? null : Math.min(1000 * 2 ** attempt, 30_000);
}

export function createCmaFetch(options: CmaFetchOptions = {}): typeof fetch {
  const fetchFn =
    options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  const scheduler = options.scheduler ?? sharedScheduler;
  const timeoutMs = options.requestTimeoutMs ?? CMA_REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? 3;

  return async (input, init) => {
    const context = requestContext(input, init);
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Retry only after the previous HTTP attempt finishes.
        response = await requestAttempt(context, fetchFn, scheduler, timeoutMs);
      } catch (error) {
        await waitForRequest(
          errorRetryDelay(error, context, attempt, maxRetries),
          context.signal,
        );
        continue;
      }
      const delay = await responseRetryDelay(
        response,
        context,
        scheduler,
        attempt,
        maxRetries,
      );
      if (delay === null) return response;
      await waitForRequest(delay, context.signal);
    }
  };
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return null;
  }
  const response = error.response;
  return typeof response === 'object' &&
    response !== null &&
    'status' in response &&
    typeof response.status === 'number'
    ? response.status
    : null;
}

export async function pollCmaJob<T>(
  fetchResult: () => Promise<T>,
  jobId: string,
  timeoutMs = CMA_JOB_TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: Poll one accepted job continuously without overlapping reads.
    await waitForRequest(
      Math.min(1000 * (attempt + 1), 5000, deadline - Date.now()),
    );
    if (Date.now() >= deadline) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fetchResult(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new CmaRequestTimeoutError()),
            deadline - Date.now(),
          );
        }),
      ]);
    } catch (error) {
      if (errorStatus(error) !== 404) throw new JobPollingError(jobId, error);
      attempt += 1;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new JobPollingError(jobId, new CmaRequestTimeoutError());
}
