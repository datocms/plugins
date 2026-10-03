import { ApiError, buildClient } from '@datocms/cma-client-browser';

const MAX_CONCURRENCY = 4;
const REQUEST_INTERVAL_MS = 100;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REQUEST_DURATION_MS = 240_000;
const MAX_ATTEMPTS = 5;
const JOB_TIMEOUT_MS = 30 * 60_000;

export class RequestTimeoutError extends Error {
  constructor() {
    super('The request timed out; a write may have completed on the server.');
    this.name = 'RequestTimeoutError';
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof RequestTimeoutError
    ? signal.reason
    : new DOMException('Operation canceled', 'AbortError');
}

function checkAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError(signal);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
    if (signal.aborted) onAbort();
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal ? abortError(signal) : new Error('Operation canceled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

type Timing = {
  now?: () => number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

type FetchOptions = Timing & {
  fetchFn?: typeof fetch;
  random?: () => number;
};

function retryDelay(
  response: Response | undefined,
  attempt: number,
  now: number,
  random: number,
) {
  let result = 1000 * 2 ** attempt + random * 250;
  const reset = response?.headers.get('x-ratelimit-reset');
  const retryAfter = response?.headers.get('retry-after');
  for (const header of [reset, retryAfter]) {
    if (!header?.trim()) continue;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      result = Math.max(result, seconds * 1000);
    }
  }
  if (retryAfter && !Number.isFinite(Number(retryAfter))) {
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) result = Math.max(result, date - now);
  }
  return result;
}

function retryableResponse(method: string, response: Response) {
  return (
    response.status === 429 ||
    (method === 'GET' && response.status >= 500 && response.status <= 599)
  );
}

function retryableNetworkFailure(
  method: string,
  error: unknown,
  attempt: number,
) {
  return (
    method === 'GET' &&
    attempt + 1 < MAX_ATTEMPTS &&
    (error instanceof TypeError || error instanceof RequestTimeoutError)
  );
}

function requestMethod(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
) {
  return (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
}

/** Buffer the CMA JSON body so the timeout also covers a stalled response body. */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  signal: AbortSignal,
  fetchFn: typeof fetch,
): Promise<Response> {
  checkAborted(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new RequestTimeoutError()),
    REQUEST_TIMEOUT_MS,
  );
  try {
    return await abortable(
      (async () => {
        const response = await fetchFn(
          input instanceof Request ? input.clone() : input,
          {
            ...init,
            signal: controller.signal,
          },
        );
        const body = await response.text();
        return new Response(
          [204, 205, 304].includes(response.status) ? null : body,
          {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          },
        );
      })(),
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** One admission queue and rate-limit cooldown cover every request and retry. */
export function createControlledFetch({
  fetchFn = (input, init) => globalThis.fetch(input, init),
  now = Date.now,
  wait = delay,
  random = Math.random,
}: FetchOptions = {}): typeof fetch {
  let active = 0;
  let nextRequestAt = 0;
  let cooldownUntil = 0;
  let admission = Promise.resolve();
  const available = new Set<() => void>();

  const acquire = (signal: AbortSignal) => {
    let acquired = false;
    const requestAdmission = admission.then(async () => {
      checkAborted(signal);
      if (active >= MAX_CONCURRENCY) {
        let wake = () => {};
        const slot = new Promise<void>((resolve) => {
          wake = resolve;
          available.add(wake);
        });
        try {
          await abortable(slot, signal);
        } finally {
          available.delete(wake);
        }
      }
      while (true) {
        checkAborted(signal);
        const waiting = Math.max(nextRequestAt, cooldownUntil) - now();
        if (waiting <= 0) break;
        // biome-ignore lint/performance/noAwaitInLoops: The shared cooldown must be rechecked before admission.
        await wait(waiting, signal);
      }
      active += 1;
      acquired = true;
      nextRequestAt = now() + REQUEST_INTERVAL_MS;
    });
    admission = requestAdmission.catch(() => {});
    return abortable(requestAdmission, signal).catch((error) => {
      if (acquired) release();
      throw error;
    });
  };

  const release = () => {
    active -= 1;
    for (const wake of available) wake();
  };

  const performAttempt = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    signal: AbortSignal,
    method: string,
    attempt: number,
  ) => {
    await acquire(signal);
    try {
      return await fetchWithTimeout(input, init, signal, fetchFn);
    } catch (error) {
      checkAborted(signal);
      // A lost write response is ambiguous; the operation must reconcile it.
      if (!retryableNetworkFailure(method, error, attempt)) throw error;
      return undefined;
    } finally {
      release();
    }
  };

  const execute = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    signal: AbortSignal,
  ): Promise<Response> => {
    const method = requestMethod(input, init);
    for (let attempt = 0; ; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: Retries must follow the completed attempt and shared admission.
      const response = await performAttempt(
        input,
        init,
        signal,
        method,
        attempt,
      );
      const rateLimited = response?.status === 429;
      if (response && !retryableResponse(method, response)) return response;
      const waiting = retryDelay(response, attempt, now(), random());
      if (rateLimited) cooldownUntil = Math.max(cooldownUntil, now() + waiting);
      if (attempt + 1 >= MAX_ATTEMPTS && response) return response;
      await wait(waiting, signal);
    }
  };

  return async (input, init) => {
    const controller = new AbortController();
    const sourceSignal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const onAbort = () => controller.abort(sourceSignal?.reason);
    sourceSignal?.addEventListener('abort', onAbort, { once: true });
    if (sourceSignal?.aborted) onAbort();
    const timer = setTimeout(
      () => controller.abort(new RequestTimeoutError()),
      MAX_REQUEST_DURATION_MS,
    );
    try {
      return await execute(input, init, controller.signal);
    } finally {
      clearTimeout(timer);
      sourceSignal?.removeEventListener('abort', onAbort);
    }
  };
}

/** A 404 means the accepted job is still running; never resubmit its mutation. */
export async function pollAsyncJob<T>(
  fetcher: () => Promise<T>,
  { now = Date.now, wait = delay }: Timing = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new RequestTimeoutError()),
    JOB_TIMEOUT_MS,
  );
  const deadline = now() + JOB_TIMEOUT_MS;
  try {
    for (let attempt = 1; ; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: Only one poll should be outstanding for each accepted job.
      await wait(
        Math.min(attempt * 1000, 5000, deadline - now()),
        controller.signal,
      );
      checkAborted(controller.signal);
      if (now() >= deadline) throw new RequestTimeoutError();
      try {
        return await abortable(fetcher(), controller.signal);
      } catch (error) {
        checkAborted(controller.signal);
        if (!(error instanceof ApiError) || error.response.status !== 404)
          throw error;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

// Share the scheduler across hook invocations and clients in this plugin frame.
const controlledFetch = createControlledFetch();

type ClientContext = {
  currentUserAccessToken: string | null | undefined;
  environment: string;
  cmaBaseUrl: string;
};

export function createClient(ctx: ClientContext) {
  const client = buildClient({
    apiToken: ctx.currentUserAccessToken ?? null,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
    autoRetry: false,
    logLevel: 0,
    // Longer than the wrapper's entire retry/queue budget, including HTTP abort.
    requestTimeout: 300_000,
    fetchFn: controlledFetch,
  });
  client.jobResultsFetcher = (jobId) =>
    pollAsyncJob(() => client.jobResults.find(jobId));
  return client;
}
