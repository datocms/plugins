const REQUEST_INTERVAL_MS = 100;
const MAX_CONCURRENT_REQUESTS = 3;
const ATTEMPT_TIMEOUT_MS = 30_000;
const OPERATION_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;

function namedError(message: string, name: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function timeoutError(): Error {
  return namedError('The CMA request timed out.', 'TimeoutError');
}

function sdkCompatibleError(error: unknown): unknown {
  // The installed SDK calls error.code.includes() whenever the property exists.
  // DOMException has a numeric .code, so preserve its meaning in a plain Error.
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code !== 'string'
  ) {
    if (error instanceof Error || error instanceof DOMException) {
      return namedError(error.message, error.name);
    }
    return new Error('The CMA request failed.');
  }
  return error;
}

function abortReason(signal: AbortSignal): unknown {
  return sdkCompatibleError(
    signal.reason ?? namedError('The CMA request was cancelled.', 'AbortError'),
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function relayAbort(
  signal: AbortSignal | null | undefined,
  controller: AbortController,
): () => void {
  const onAbort = () =>
    controller.abort(signal ? abortReason(signal) : undefined);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return () => signal?.removeEventListener('abort', onAbort);
}

// The race also bounds a fetch mock or a body reader that ignores AbortSignal.
// The controller still aborts the actual browser network request.
function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.min(ms, OPERATION_TIMEOUT_MS),
    );
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

type QueuedRequest = { start: () => void };

function createScheduler() {
  let active = 0;
  let nextStartAt = 0;
  let cooldownUntil = 0;
  let wakeTimer: ReturnType<typeof setTimeout> | undefined;
  const queue: QueuedRequest[] = [];

  const pump = () => {
    clearTimeout(wakeTimer);
    wakeTimer = undefined;
    while (active < MAX_CONCURRENT_REQUESTS && queue.length > 0) {
      const delay = Math.max(nextStartAt, cooldownUntil) - Date.now();
      if (delay > 0) {
        wakeTimer = setTimeout(pump, Math.min(delay, OPERATION_TIMEOUT_MS));
        return;
      }
      const entry = queue.shift();
      if (!entry) return;
      nextStartAt = Date.now() + REQUEST_INTERVAL_MS;
      entry.start();
    }
  };

  return {
    onRateLimit(delayMs: number) {
      cooldownUntil = Math.max(cooldownUntil, Date.now() + delayMs);
      pump();
    },
    run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
      throwIfAborted(signal);
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          reject(abortReason(signal));
          pump();
        };
        const entry: QueuedRequest = {
          start: () => {
            signal.removeEventListener('abort', onAbort);
            active += 1;
            Promise.resolve()
              .then(task)
              .then(resolve, reject)
              .finally(() => {
                active -= 1;
                pump();
              });
          },
        };
        signal.addEventListener('abort', onAbort, { once: true });
        queue.push(entry);
        pump();
      });
    },
  };
}

function retryDelay(headers: Headers | undefined, attempt: number): number {
  const reset = headers?.get('x-ratelimit-reset');
  const retryAfter = headers?.get('retry-after');
  const delays: number[] = [];
  if (reset?.trim()) {
    const seconds = Number(reset);
    if (Number.isFinite(seconds) && seconds >= 0) delays.push(seconds * 1000);
  }
  if (retryAfter?.trim()) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) delays.push(seconds * 1000);
    else {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) delays.push(Math.max(0, date - Date.now()));
    }
  }
  return delays.length > 0 ? Math.max(...delays) : 1000 * 2 ** attempt;
}

function isReadFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    ((error instanceof Error || error instanceof DOMException) &&
      ['NetworkError', 'TimeoutError'].includes(error.name))
  );
}

function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

function bufferedResponse(response: Response, body: string | null): Response {
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
  operationSignal: AbortSignal,
  retryServerErrors: boolean,
): Promise<Response> {
  throwIfAborted(operationSignal);
  const controller = new AbortController();
  const removeAbortRelay = relayAbort(operationSignal, controller);
  const timer = setTimeout(
    () => controller.abort(timeoutError()),
    ATTEMPT_TIMEOUT_MS,
  );
  try {
    const response = await abortable(
      fetchFn(input instanceof Request ? input.clone() : input, {
        ...init,
        signal: controller.signal,
      }),
      controller.signal,
    );
    // A confirmed rejection can be retried even for PUT. Do not spend the
    // entire body deadline on a rate-limit page, and release its connection.
    if (
      response.status === 429 ||
      (retryServerErrors && response.status >= 500)
    ) {
      discardBody(response);
      return bufferedResponse(response, null);
    }
    const body = [204, 205, 304].includes(response.status)
      ? null
      : await abortable(response.text(), controller.signal);
    // The SDK's own timeout stops at response headers, before response.json().
    // Returning a buffered body keeps that later JSON read bounded as well.
    return bufferedResponse(response, body);
  } finally {
    clearTimeout(timer);
    removeAbortRelay();
  }
}

type CmaRequest = {
  fetchFn: typeof fetch;
  input: RequestInfo | URL;
  init: RequestInit | undefined;
  method: string;
  signal: AbortSignal;
  scheduler: ReturnType<typeof createScheduler>;
};

async function requestWithRetries(
  request: CmaRequest,
  attempt = 0,
): Promise<Response> {
  const { fetchFn, input, init, method, signal, scheduler } = request;
  const retryAvailable = attempt < MAX_ATTEMPTS - 1;
  let response: Response;
  try {
    response = await scheduler.run(
      () =>
        fetchAttempt(
          fetchFn,
          input,
          init,
          signal,
          method === 'GET' && retryAvailable,
        ),
      signal,
    );
  } catch (error) {
    throwIfAborted(signal);
    // A write with a lost response may already have succeeded. Its caller
    // must read the latest metadata to reconcile it, without replaying it.
    if (method !== 'GET' || !isReadFailure(error) || !retryAvailable)
      throw error;
    await wait(retryDelay(undefined, attempt), signal);
    return requestWithRetries(request, attempt + 1);
  }
  const rateLimited = response.status === 429;
  const retryRead = method === 'GET' && response.status >= 500;
  const delay = retryDelay(response.headers, attempt);
  if (rateLimited) scheduler.onRateLimit(delay);
  if ((!rateLimited && !retryRead) || !retryAvailable) return response;
  await wait(delay, signal);
  return requestWithRetries(request, attempt + 1);
}

/**
 * Supply with autoRetry:false and requestTimeout >= 120_000 on buildClient.
 * One instance shares pacing and 429 cooldown across its callers. It leaves
 * headroom below CMA's documented 60 requests / 3 seconds for the dashboard.
 */
export function createCmaFetch(): typeof fetch {
  const scheduler = createScheduler();
  return async (input, init) => {
    const controller = new AbortController();
    const removeAbortRelay = relayAbort(
      init?.signal ?? (input instanceof Request ? input.signal : undefined),
      controller,
    );
    const timer = setTimeout(
      () => controller.abort(timeoutError()),
      OPERATION_TIMEOUT_MS,
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    try {
      return await requestWithRetries({
        fetchFn: globalThis.fetch.bind(globalThis),
        input,
        init,
        method,
        signal: controller.signal,
        scheduler,
      });
    } catch (error) {
      throw sdkCompatibleError(error);
    } finally {
      clearTimeout(timer);
      removeAbortRelay();
    }
  };
}
