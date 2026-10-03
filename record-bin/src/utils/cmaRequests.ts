const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function getStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.response)) return undefined;
  return typeof error.response.status === 'number'
    ? error.response.status
    : undefined;
}

export function isRetryableError(error: unknown): boolean {
  const status = getStatus(error);
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (error instanceof TypeError) return true;
  if (!isRecord(error)) return false;
  if (error.name === 'TimeoutError') return true;
  const response = error.response;
  const body = isRecord(response) ? response.body : undefined;
  return (
    isRecord(body) &&
    Array.isArray(body.data) &&
    body.data.some(
      (entry: unknown) =>
        isRecord(entry) &&
        isRecord(entry.attributes) &&
        entry.attributes.transient === true,
    )
  );
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('Deletion cancelled.', 'AbortError');
}

export async function waitForRequest(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Deletion cancelled.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// Ten starts/second leaves headroom below the CMA's shared 60 requests/3 seconds.
export class CmaRequestScheduler {
  private nextRequestAt = 0;
  private cooldownUntil = 0;
  constructor(private readonly intervalMs = 100) {}

  async beforeRequest(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const reservedAt = Math.max(
      Date.now(),
      this.nextRequestAt,
      this.cooldownUntil,
    );
    this.nextRequestAt = reservedAt + this.intervalMs;
    await waitForRequest(reservedAt - Date.now(), signal);
    while (Date.now() < this.cooldownUntil) {
      await waitForRequest(this.cooldownUntil - Date.now(), signal);
    }
    throwIfAborted(signal);
  }

  onRateLimit(delayMs: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delayMs);
  }
}

export function retryDelay(error: unknown, attempt: number): number {
  const response =
    isRecord(error) && isRecord(error.response) ? error.response : undefined;
  const headers =
    response && isRecord(response.headers) ? response.headers : {};
  const retryAfter = headers['retry-after'];
  const seconds = Number(retryAfter ?? headers['x-ratelimit-reset']);
  if (Number.isFinite(seconds) && seconds >= 0)
    return boundedCooldown(seconds * 1000);
  const date =
    typeof retryAfter === 'string' ? Date.parse(retryAfter) : Number.NaN;
  if (Number.isFinite(date))
    return boundedCooldown(Math.max(0, date - Date.now()));
  return Math.min(1000 * 2 ** attempt, 30_000);
}

function boundedCooldown(milliseconds: number): number {
  if (milliseconds > 300000)
    throw new Error(
      'CMA rate-limit cooldown exceeds the automated request budget; further requests were stopped.',
    );
  return milliseconds;
}

// Mutations passed here MUST reconcile a stable ID before repeating a write.
export async function retryCmaOperation<T>(
  operation: () => Promise<T>,
  scheduler: CmaRequestScheduler,
  signal?: AbortSignal,
  shouldRetry: (error: unknown) => boolean = () => true,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await scheduler.beforeRequest(signal);
    try {
      return await operation();
    } catch (error) {
      throwIfAborted(signal);
      if (!isRetryableError(error) || !shouldRetry(error) || attempt >= 4)
        throw error;
      const delay = retryDelay(error, attempt);
      if (getStatus(error) === 429) scheduler.onRateLimit(delay);
      await waitForRequest(delay, signal);
    }
  }
}

export const retryCmaRead = retryCmaOperation;

// The SDK's own timeout does not abort fetch, and excludes response-body reads.
// This fetch wrapper bounds both the connection and body, with real cancellation.
async function bufferResponse(response: Response): Promise<Response> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  if (reader) {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('CMA response exceeded the bounded capture buffer.');
      }
      chunks.push(chunk.value);
    }
  }
  return new Response(
    response.status === 204 || response.status === 304
      ? null
      : new Blob(chunks),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  );
}

export function createBoundedFetch(
  signal?: AbortSignal,
  timeoutMs = 30_000,
): typeof fetch {
  return async (input, init) => {
    throwIfAborted(signal);
    const controller = new AbortController();
    const abort = () =>
      controller.abort(new DOMException('Deletion cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException('CMA request timed out.', 'TimeoutError'),
        ),
      timeoutMs,
    );
    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
      return await bufferResponse(response);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}

export async function runWithConcurrency<T>(
  inputs: readonly T[],
  limit: number,
  operation: (input: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex++;
      await operation(inputs[index]);
    }
  };
  const outcomes = await Promise.allSettled(
    Array.from({ length: Math.min(limit, inputs.length) }, worker),
  );
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') throw outcome.reason;
  }
}
