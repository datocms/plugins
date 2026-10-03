import { isRateLimitError } from './TranslationCore';
import { ProviderError, type VendorId } from './types';

export function retryAfterMs(headers?: Headers): number | undefined {
  const value = headers?.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}

/** Gemini publishes retry durations in RetryInfo instead of HTTP headers. */
export function providerRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const details = error as {
    retryAfterMs?: number;
    headers?: Headers;
    errorDetails?: unknown[];
  };
  const direct = details.retryAfterMs ?? retryAfterMs(details.headers);
  if (direct !== undefined) return direct;
  for (const value of details.errorDetails ?? []) {
    if (!value || typeof value !== 'object') continue;
    const retry = value as { retryDelay?: string };
    if (
      typeof retry.retryDelay === 'string' &&
      /^\d+(\.\d+)?s$/.test(retry.retryDelay)
    )
      return Number.parseFloat(retry.retryDelay) * 1000;
  }
  return undefined;
}

export function waitForRequest(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** One gate per memoized provider: all records and field chunks share cooldown. */
export class ProviderRequestControl {
  private startQueue: Promise<void> = Promise.resolve();
  private nextStartAt = 0;
  private cooldownUntil = 0;
  private active = 0;
  private readonly waiting = new Set<() => void>();

  constructor(
    private readonly vendor: VendorId,
    private readonly spacingMs = vendor === 'google' ? 200 : 55,
    private readonly concurrency = vendor === 'google' ? 2 : 4,
    private readonly maxRetries = 5,
  ) {}

  private async acquire(signal?: AbortSignal): Promise<void> {
    while (this.active >= this.concurrency) {
      signal?.throwIfAborted();
      // biome-ignore lint/performance/noAwaitInLoops: This is a bounded concurrency gate.
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          this.waiting.delete(wake);
          signal?.removeEventListener('abort', abort);
        };
        const wake = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
        };
        this.waiting.add(wake);
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
    signal?.throwIfAborted();
    this.active += 1;
  }

  private async start(signal?: AbortSignal): Promise<void> {
    const turn = this.startQueue.then(async () => {
      signal?.throwIfAborted();
      // A different request may extend the cooldown while this one is waiting.
      while (Date.now() < Math.max(this.nextStartAt, this.cooldownUntil)) {
        // biome-ignore lint/performance/noAwaitInLoops: Respect a shared provider cooldown.
        await waitForRequest(
          Math.max(this.nextStartAt, this.cooldownUntil) - Date.now(),
          signal,
        );
      }
      signal?.throwIfAborted();
      this.nextStartAt = Date.now() + this.spacingMs;
    });
    this.startQueue = turn.catch(() => undefined);
    await turn;
  }

  private canRetry(error: unknown): boolean {
    if (this.vendor === 'yandex') return false;
    if (!error || typeof error !== 'object') return false;
    const details = error as {
      status?: number;
      message?: string;
      errorDetails?: unknown[];
      code?: string;
    };
    const description = `${details.message ?? ''} ${details.code ?? ''} ${JSON.stringify(details.errorDetails ?? [])}`;
    if (
      /insufficient_quota|enforced_spend_limit_reached|per.?day|daily (?:quota|limit)/i.test(
        description,
      )
    )
      return false;
    if (isRateLimitError(error)) return true;
    return (
      details.status === 429 &&
      providerRetryAfterMs(error) !== undefined &&
      !/insufficient_quota|enforced_spend_limit_reached|per.?day|daily (?:quota|limit)/i.test(
        description,
      )
    );
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      for (let attempt = 0; ; attempt += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: Retries must be sequential to avoid duplicate billable requests.
        await this.start(signal);
        try {
          return await fn();
        } catch (error) {
          signal?.throwIfAborted();
          // Transport errors/timeouts are ambiguous billable outcomes; replay
          // only an explicit rate-limit rejection, never a completed chunk.
          if (!this.canRetry(error)) throw error;
          const details = error as {
            status?: number;
            message?: string;
            retryAfterMs?: number;
            headers?: Headers;
          };
          if (attempt >= this.maxRetries) {
            throw new ProviderError(
              details.message ?? 'Rate limit reached',
              details.status ?? 429,
              this.vendor,
              {
                cause: error,
                retryExhausted: true,
                retryAfterMs: providerRetryAfterMs(error),
              },
            );
          }
          const backoff = Math.min(1000 * 2 ** attempt, 30_000);
          const retryDelay = providerRetryAfterMs(error);
          // The response delay is a minimum; never cap it below provider advice.
          this.cooldownUntil = Math.max(
            this.cooldownUntil,
            Date.now() + Math.max(backoff, retryDelay ?? 0),
          );
        }
      }
    } finally {
      this.active -= 1;
      for (const wake of this.waiting) wake();
    }
  }
}
