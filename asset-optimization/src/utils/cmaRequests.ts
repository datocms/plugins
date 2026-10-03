import { ApiError, TimeoutError } from '@datocms/cma-client-browser';

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('Operation cancelled', 'AbortError');
}

export function waitForRequest(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Operation cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function waitForScheduledTurn(
  turn: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return turn;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(new DOMException('Operation cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    turn.then(
      () => {
        signal.removeEventListener('abort', abort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

// Reserve one slot at a time and share a 429 cooldown across all workers.
// 150ms leaves headroom below CMA's 60 requests / 3 seconds for the CMS itself.
export class CmaRequestScheduler {
  private nextRequestAt = 0;
  private cooldownUntil = 0;
  private scheduledTurns: Promise<void> = Promise.resolve();

  constructor(private readonly intervalMs = 150) {}

  async beforeRequest(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const turn = this.scheduledTurns.then(async () => {
      throwIfAborted(signal);
      const reservedAt = Math.max(
        Date.now(),
        this.nextRequestAt,
        this.cooldownUntil,
      );
      await waitForRequest(Math.max(0, reservedAt - Date.now()), signal);
      while (Date.now() < this.cooldownUntil) {
        // Another worker can extend the cooldown while this turn is waiting.
        // biome-ignore lint/performance/noAwaitInLoops: Cooldown extensions must be awaited sequentially.
        await waitForRequest(this.cooldownUntil - Date.now(), signal);
      }
      throwIfAborted(signal);
      this.nextRequestAt = Date.now() + this.intervalMs;
    });
    // A cancelled queued turn stays behind its predecessor until it can be
    // discarded, so successors cannot bypass the active reservation.
    this.scheduledTurns = turn.then(
      () => undefined,
      () => undefined,
    );
    await waitForScheduledTurn(turn, signal);
  }

  onRateLimit(delayMs: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delayMs);
  }
}

function delayFromSeconds(header?: string): number | undefined {
  if (!header?.trim()) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function delayFromRetryAfter(header?: string): number | undefined {
  const delay = delayFromSeconds(header);
  if (delay !== undefined) return delay;
  if (!header?.trim() || Number.isFinite(Number(header))) return undefined;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function rateLimitDelay(error: ApiError, attempt: number): number {
  const delay =
    delayFromRetryAfter(error.response.headers['retry-after']) ??
    delayFromSeconds(error.response.headers['x-ratelimit-reset']);
  if (delay !== undefined) {
    // Fail this read rather than retrying before a long server-mandated wait.
    // This also keeps timers and the duration of one retry sequence bounded.
    if (!Number.isFinite(delay) || delay > 120_000) throw error;
    return delay;
  }
  return Math.min(1000 * 2 ** attempt, 30_000);
}

function isTransientReadError(error: unknown): boolean {
  const status = error instanceof ApiError ? error.response.status : undefined;
  return (
    status === 429 ||
    (status !== undefined && status >= 500) ||
    error instanceof TimeoutError ||
    (error instanceof Error && error.name === 'CmaRequestTimeoutError') ||
    error instanceof TypeError
  );
}

// This wrapper is only for reads; uncertain mutations must be reconciled.
export async function retryCmaRead<T>(
  operation: () => Promise<T>,
  scheduler: CmaRequestScheduler,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    // biome-ignore lint/performance/noAwaitInLoops: Read retries must preserve scheduler ordering.
    await scheduler.beforeRequest(signal);
    try {
      const value = await operation();
      throwIfAborted(signal);
      return value;
    } catch (error) {
      throwIfAborted(signal);
      if (!isTransientReadError(error) || attempt >= 3) throw error;
      const delay =
        error instanceof ApiError
          ? rateLimitDelay(error, attempt)
          : 1000 * 2 ** attempt;
      if (error instanceof ApiError && error.response.status === 429)
        scheduler.onRateLimit(delay);
      await waitForRequest(delay, signal);
    }
  }
}
