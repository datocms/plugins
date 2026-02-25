import type { ApiError } from '@datocms/cma-client-browser';
import type { RetryOptions } from './types';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function jitter(baseDelay: number): number {
  const randomFactor = 0.5 + Math.random();
  return Math.floor(baseDelay * randomFactor);
}

function pickStatus(error: unknown): number | null {
  const apiError = error as ApiError & {
    statusCode?: number;
    response?: { status?: number };
  };

  return (
    apiError?.statusCode ??
    apiError?.response?.status ??
    null
  );
}

export function isRetryableError(error: unknown): boolean {
  const status = pickStatus(error);
  if (status && [408, 409, 423, 425, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';

  if (!message) {
    return false;
  }

  const retryablePatterns = [
    'STALE_ITEM_VERSION',
    'rate limit',
    'timeout',
    'temporarily unavailable',
    'ECONNRESET',
    'ENOTFOUND',
    'network',
  ];

  return retryablePatterns.some((pattern) =>
    message.toLowerCase().includes(pattern.toLowerCase()),
  );
}

export async function withRetry<T>(args: {
  operationName: string;
  options: RetryOptions;
  fn: (attempt: number) => Promise<T>;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}): Promise<T> {
  let attempt = 1;
  const shouldRetry = args.shouldRetry ?? isRetryableError;

  for (;;) {
    try {
      return await args.fn(attempt);
    } catch (error) {
      if (attempt >= args.options.maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const exponential = Math.min(
        args.options.maxDelayMs,
        args.options.baseDelayMs * 2 ** (attempt - 1),
      );
      const delayMs = jitter(exponential);

      args.onRetry?.({
        attempt,
        delayMs,
        error,
      });

      await wait(delayMs);
      attempt += 1;
    }
  }
}
