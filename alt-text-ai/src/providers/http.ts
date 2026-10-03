import { AltTextProviderError, isAltTextProviderError } from './errors';
import type { AltTextProviderId } from './types';

const REQUEST_TIMEOUT_MS = 60_000;
const RETRY_BUDGET_MS = 120_000;
const MAX_REQUEST_ATTEMPTS = 4;
const providerCooldowns = new Map<string, number>();

function abortError(): DOMException {
  return new DOMException('Request canceled.', 'AbortError');
}

export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

function waitForRetry(
  delayMs: number,
  signal?: AbortSignal | null,
): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function withRequestTimeout<T>(
  provider: AltTextProviderId,
  externalSignal: AbortSignal | null | undefined,
  timeoutMs: number,
  operation: (
    signal: AbortSignal,
    preserveFailure: (failure: AltTextProviderError) => void,
  ) => Promise<T>,
): Promise<T> {
  throwIfAborted(externalSignal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  let timeoutFailure = new AltTextProviderError(
    provider,
    'timeout',
    'The request timed out.',
  );
  const deadline = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(abortError());
      controller.abort();
    };
    externalSignal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      reject(timeoutFailure);
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      operation(controller.signal, (failure) => {
        timeoutFailure = failure;
      }),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

function canRetryFailure(error: unknown, readOnly: boolean): boolean {
  if (!isAltTextProviderError(error)) {
    return false;
  }
  if (error.code === 'rate_limit' && error.status === 429) {
    return true;
  }
  return (
    readOnly &&
    (error.code === 'network' ||
      error.code === 'timeout' ||
      [408, 500, 502, 503, 504].includes(error.status ?? 0))
  );
}

function retryDelay(error: unknown, attempt: number): number {
  const serverDelay = isAltTextProviderError(error)
    ? error.retryAfterMs
    : undefined;
  const backoff = Math.min(1000 * 2 ** attempt, 30_000);
  return Math.max(serverDelay ?? 0, backoff) + Math.floor(Math.random() * 250);
}

async function waitForProviderCooldown(
  provider: AltTextProviderId,
  key: string | undefined,
  startedAt: number,
  signal: AbortSignal | null | undefined,
): Promise<void> {
  while (key) {
    const delayMs = (providerCooldowns.get(key) ?? 0) - Date.now();
    if (delayMs <= 0) {
      providerCooldowns.delete(key);
      return;
    }
    if (Date.now() - startedAt + delayMs >= RETRY_BUDGET_MS) {
      throw new AltTextProviderError(
        provider,
        'rate_limit',
        'The provider retry delay exceeds the automatic retry deadline.',
        { status: 429, retryAfterMs: delayMs },
      );
    }
    // biome-ignore lint/performance/noAwaitInLoops: A server cooldown must elapse before any following request.
    await waitForRetry(delayMs, signal);
  }
}

function setProviderCooldown(key: string, delayMs: number): void {
  const current = providerCooldowns.get(key) ?? 0;
  providerCooldowns.set(key, Math.max(current, Date.now() + delayMs));
}

async function waitAfterRetryableFailure(
  error: unknown,
  attempt: number,
  readOnly: boolean,
  cooldownKey: string | undefined,
  startedAt: number,
  signal: AbortSignal | null | undefined,
): Promise<void> {
  throwIfAborted(signal);
  if (
    attempt + 1 >= MAX_REQUEST_ATTEMPTS ||
    !canRetryFailure(error, readOnly)
  ) {
    throw error;
  }
  const delayMs = retryDelay(error, attempt);
  const sharedCooldown =
    cooldownKey && isAltTextProviderError(error) && error.code === 'rate_limit';
  if (sharedCooldown) {
    setProviderCooldown(cooldownKey, delayMs);
  }
  // Never shorten Retry-After to fit the budget: surface the HTTP failure.
  if (Date.now() - startedAt + delayMs >= RETRY_BUDGET_MS) {
    throw error;
  }
  if (!sharedCooldown) {
    await waitForRetry(delayMs, signal);
  }
}

/** Only explicit rate-limit rejections may repeat a paid generation request. */
export async function withHttpRetries<T>(
  provider: AltTextProviderId,
  signal: AbortSignal | null | undefined,
  readOnly: boolean,
  operation: (
    requestSignal: AbortSignal,
    preserveFailure: (failure: AltTextProviderError) => void,
  ) => Promise<T>,
  cooldownKey?: string,
): Promise<T> {
  const startedAt = Date.now();
  let lastFailure: unknown;
  for (let attempt = 0; ; attempt += 1) {
    throwIfAborted(signal);
    // biome-ignore lint/performance/noAwaitInLoops: Later attempts must respect a shared provider cooldown.
    await waitForProviderCooldown(provider, cooldownKey, startedAt, signal);
    const remainingMs = RETRY_BUDGET_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw (
        lastFailure ??
        new AltTextProviderError(
          provider,
          'timeout',
          'The request retry deadline expired.',
        )
      );
    }
    try {
      return await withRequestTimeout(
        provider,
        signal,
        Math.min(REQUEST_TIMEOUT_MS, remainingMs),
        operation,
      );
    } catch (error) {
      lastFailure = error;
      await waitAfterRetryableFailure(
        error,
        attempt,
        readOnly,
        cooldownKey,
        startedAt,
        signal,
      );
    }
  }
}

export class ResponseTooLargeError extends Error {}

/** Check both declared and actual bytes; Content-Length may be missing or wrong. */
export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new ResponseTooLargeError('The response exceeds the size limit.');
  }
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  let bytes = new Uint8Array();
  let totalBytes = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      // biome-ignore lint/performance/noAwaitInLoops: Stream reads must be sequential to enforce a bounded response size.
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) {
        break;
      }
      const nextSize = totalBytes + value.byteLength;
      if (nextSize > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new ResponseTooLargeError('The response exceeds the size limit.');
      }
      if (nextSize > bytes.byteLength) {
        const capacity = Math.min(
          maxBytes,
          Math.max(nextSize, bytes.byteLength * 2, 1024),
        );
        const grown = new Uint8Array(capacity);
        grown.set(bytes);
        bytes = grown;
      }
      bytes.set(value, totalBytes);
      totalBytes = nextSize;
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }

  return bytes.subarray(0, totalBytes);
}
