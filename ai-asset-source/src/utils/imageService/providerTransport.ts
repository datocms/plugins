import {
  MAX_GENERATED_IMAGE_BASE64_LENGTH,
  MAX_GENERATED_IMAGES,
} from './generationValidation';
import type { ImageServiceOptions } from './types';

export const MAX_GENERATION_RESPONSE_BYTES =
  MAX_GENERATED_IMAGE_BASE64_LENGTH * MAX_GENERATED_IMAGES + 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 30_000;

export function createProviderFetch(
  options: ImageServiceOptions,
): typeof fetch {
  const fetchRequest = options.fetch ?? globalThis.fetch;

  return async (input, init) => {
    const signal = options.signal ?? init?.signal ?? undefined;

    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted();
      // biome-ignore lint/performance/noAwaitInLoops: A retry depends on the previous rejection and must never run concurrently.
      const response = await fetchRequest(input, { ...init, signal });
      const bounded = limitResponseBody(response, signal);

      // Only an explicit rejection with a server-supplied wait is retried.
      // Network errors, empty responses and 5xx may already have generated a
      // charged image; neither this transport nor the AI SDK retries them.
      if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) {
        return bounded;
      }

      const delay = readRetryDelay(response.headers.get('retry-after'));

      if (delay === undefined) {
        return bounded;
      }

      const errorBody = await bounded.text();

      if (isExhaustedQuota(errorBody)) {
        return new Response(errorBody, responseOptions(response));
      }

      await waitForRetry(delay, signal);
    }
  };
}

function limitResponseBody(response: Response, signal?: AbortSignal): Response {
  const maximumBytes = response.ok
    ? MAX_GENERATION_RESPONSE_BYTES
    : MAX_ERROR_RESPONSE_BYTES;
  const contentLength = Number(response.headers.get('content-length'));

  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw responseSizeError();
  }

  if (!response.body) {
    return response;
  }

  const reader = response.body.getReader();
  let totalBytes = 0;
  let done = false;
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  const cleanup = () => {
    done = true;
    signal?.removeEventListener('abort', cancelReader);
  };

  signal?.addEventListener('abort', cancelReader, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal?.throwIfAborted();
        const chunk = await reader.read();
        signal?.throwIfAborted();

        if (chunk.done) {
          cleanup();
          controller.close();
          return;
        }

        totalBytes += chunk.value.byteLength;

        if (totalBytes > maximumBytes) {
          cancelReader();
          throw responseSizeError();
        }

        controller.enqueue(chunk.value);
      } catch (error) {
        cleanup();
        cancelReader();
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (!done) {
        cleanup();
        await reader.cancel(reason);
      }
    },
  });

  return new Response(body, responseOptions(response));
}

function responseOptions(response: Response): ResponseInit {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  };
}

function responseSizeError(): Error {
  return new Error(
    "The provider response exceeds this plugin's memory limit. The request may have been charged; it was not repeated automatically.",
  );
}

function readRetryDelay(value: string | null): number | undefined {
  if (value === null || !value.trim()) {
    return undefined;
  }

  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();

  return Number.isFinite(delay) && delay >= 0 && delay <= MAX_RETRY_DELAY_MS
    ? delay
    : undefined;
}

function isExhaustedQuota(errorBody: string): boolean {
  return /insufficient_quota|billing|payment|credits?|daily|per day|per_day/i.test(
    errorBody,
  );
}

function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(
        signal?.reason ?? new DOMException('Request cancelled.', 'AbortError'),
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);

    signal?.addEventListener('abort', abort, { once: true });

    if (signal?.aborted) {
      abort();
    }
  });
}
