export type DiscoveryHttpOptions = {
  signal?: AbortSignal;
  fetch?: typeof fetch;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  requestTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxResponseBytes?: number;
};

const REQUEST_TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

class DiscoveryHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter: string | null,
  ) {
    super(message);
  }
}

export function createDiscoveryHttpClient(options: DiscoveryHttpOptions) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(cancelledError());
  options.signal?.addEventListener('abort', onAbort, { once: true });

  if (options.signal?.aborted) {
    onAbort();
  }

  const timeout = setTimeout(
    () => controller.abort(timeoutError('Model discovery timed out.')),
    options.totalTimeoutMs ?? TOTAL_TIMEOUT_MS,
  );

  return {
    async readJson(
      provider: string,
      url: string | URL,
      headers: HeadersInit,
    ): Promise<unknown> {
      for (let attempt = 0; ; attempt += 1) {
        try {
          // biome-ignore lint/performance/noAwaitInLoops: a retry depends on the preceding attempt failing.
          return await requestJson(
            provider,
            url,
            headers,
            controller.signal,
            options,
          );
        } catch (error: unknown) {
          if (controller.signal.aborted) {
            throw abortReason(controller.signal);
          }

          const delay = retryDelay(error, attempt);
          if (attempt >= MAX_RETRIES || delay === undefined) {
            throw error;
          }

          await abortable(
            () => (options.wait ?? wait)(delay, controller.signal),
            controller.signal,
          );
        }
      }
    },
    dispose() {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    },
  };
}

async function requestJson(
  provider: string,
  url: string | URL,
  headers: HeadersInit,
  signal: AbortSignal,
  options: DiscoveryHttpOptions,
): Promise<unknown> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(abortReason(signal));
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) {
    onAbort();
  }

  const timeout = setTimeout(
    () =>
      controller.abort(timeoutError(`${provider} model request timed out.`)),
    options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await abortable(
      () =>
        (options.fetch ?? fetch)(url, { headers, signal: controller.signal }),
      controller.signal,
    );
    const payload = await readResponseBody(
      response,
      provider,
      controller.signal,
      options.maxResponseBytes ?? MAX_RESPONSE_BYTES,
    );
    if (!response.ok) {
      throw new DiscoveryHttpError(
        readProviderErrorMessage(payload) ||
          `${provider} returned ${response.status}.`,
        response.status,
        response.headers.get('Retry-After'),
      );
    }
    return payload;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

async function readResponseBody(
  response: Response,
  provider: string,
  signal: AbortSignal,
  maxBytes: number,
): Promise<unknown> {
  try {
    return JSON.parse(
      await readBoundedBody(response, provider, signal, maxBytes),
    );
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    if (!response.ok) {
      return undefined;
    }
    throw new Error(`${provider} returned an invalid model catalog response.`);
  }
}

async function readBoundedBody(
  response: Response,
  provider: string,
  signal: AbortSignal,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw responseLimitError(provider);
  }
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const sections: string[] = [];
  let chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: read incrementally to bound response memory and support cancellation.
      const chunk = await abortable(() => reader.read(), signal);
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        throw responseLimitError(provider);
      }
      if (chunk.value.byteLength === 0) {
        continue;
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
      // Compact tiny chunks so transport fragmentation cannot grow the array unboundedly.
      if (chunks.length === 256) {
        sections.push(chunks.join(''));
        chunks = [];
      }
    }
    chunks.push(decoder.decode());
    sections.push(chunks.join(''));
    return sections.join('');
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function responseLimitError(provider: string): Error {
  return new Error(
    `${provider} model catalog response exceeded the size safety limit.`,
  );
}

function retryDelay(error: unknown, attempt: number): number | undefined {
  if (error instanceof DiscoveryHttpError) {
    if (error.status !== 429 && (error.status < 500 || error.status > 599)) {
      return undefined;
    }

    const requestedDelay = parseRetryAfter(error.retryAfter);
    if (requestedDelay !== undefined) {
      // Never retry before the provider's deadline. Very long waits fail explicitly.
      return requestedDelay <= MAX_RETRY_DELAY_MS ? requestedDelay : undefined;
    }
  } else if (
    !(error instanceof TypeError) &&
    !(error instanceof Error && error.name === 'TimeoutError')
  ) {
    return undefined;
  }

  return Math.min(500 * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function abortable<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal.aborted) {
          throw abortReason(signal);
        }
        return operation();
      })
      .then(
        (result) => {
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
  });
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : cancelledError();
}

function cancelledError(): DOMException {
  return new DOMException('Model discovery was cancelled.', 'AbortError');
}

function timeoutError(message: string): Error {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

function readProviderErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}
