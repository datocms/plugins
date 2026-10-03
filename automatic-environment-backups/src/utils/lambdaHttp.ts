export const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error as { name?: string }).name === 'AbortError';

export const truncateResponseSnippet = (
  value: string,
  maxLength: number,
): string => {
  if (!value) {
    return '';
  }

  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength)}...`;
};

const abortError = (): DOMException =>
  new DOMException('The request was aborted.', 'AbortError');

export const createTimeoutController = (
  timeoutMs: number,
  parentSignal?: AbortSignal,
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort(abortError());
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    controller,
    clear: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
};

const withAbort = <T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> => {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(operation)
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
};

const waitForRetry = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

export class LambdaResponseTooLargeError extends Error {
  constructor() {
    super('Lambda endpoint response exceeded the 1 MiB response limit.');
    this.name = 'LambdaResponseTooLargeError';
  }
}

const RESPONSE_MAX_BYTES = 1024 * 1024;

const readResponseText = async (
  response: Response,
  signal: AbortSignal,
): Promise<string> => {
  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let pendingText = '';
  let totalBytes = 0;
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  try {
    if (signal.aborted) {
      onAbort();
      throw abortError();
    }
    signal.addEventListener('abort', onAbort, { once: true });
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: Stream chunks must stay ordered and incremental to bound response memory.
      const { done, value } = await reader.read();
      if (done) {
        parts.push(pendingText, decoder.decode());
        return parts.join('');
      }
      totalBytes += value.byteLength;
      if (totalBytes > RESPONSE_MAX_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new LambdaResponseTooLargeError();
      }
      pendingText += decoder.decode(value, { stream: true });
      if (pendingText.length >= 16384) {
        parts.push(pendingText);
        pendingText = '';
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
};

export const parseRetryAfterMs = (
  value: string | null,
  nowMs = Date.now(),
): number | null => {
  if (!value?.trim()) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const delay = Number(trimmed) * 1000;
    return Number.isFinite(delay) ? delay : null;
  }
  const dateMs = Date.parse(trimmed);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : null;
};

const READ_RETRY_STATUSES = new Set([408, 429, 502, 503, 504]);
const READ_MAX_ATTEMPTS = 3;

/** One total deadline covers fetch, body consumption, and safe-read retries. */
export const fetchLambdaText = async (
  endpoint: string,
  {
    timeoutMs,
    signal,
    retrySafeRead = false,
    ...request
  }: {
    timeoutMs: number;
    signal?: AbortSignal;
    retrySafeRead?: boolean;
    headers: Record<string, string>;
    body: string;
  },
): Promise<{ response: Response; payloadText: string }> => {
  const timeout = createTimeoutController(timeoutMs, signal);
  const deadline = Date.now() + timeoutMs;
  const requestSignal = timeout.controller.signal;
  const maxAttempts = retrySafeRead ? READ_MAX_ATTEMPTS : 1;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let result: { response: Response; payloadText: string };
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Each safe-read retry depends on the previous outcome and its backoff; concurrent retries would multiply requests.
        result = await withAbort(async () => {
          const response = await fetch(endpoint, {
            ...request,
            method: 'POST',
            signal: requestSignal,
          });
          const payloadText = await readResponseText(response, requestSignal);
          return { response, payloadText };
        }, requestSignal);
      } catch (error) {
        if (
          requestSignal.aborted ||
          isAbortError(error) ||
          error instanceof LambdaResponseTooLargeError ||
          attempt === maxAttempts
        ) {
          throw error;
        }
        await waitForRetry(250 * 2 ** (attempt - 1), requestSignal);
        continue;
      }

      if (
        attempt === maxAttempts ||
        !READ_RETRY_STATUSES.has(result.response.status)
      ) {
        return result;
      }

      const delayMs = Math.max(
        250 * 2 ** (attempt - 1),
        parseRetryAfterMs(result.response.headers.get('Retry-After')) ?? 0,
      );
      // Preserve HTTP details when Retry-After cannot fit; never retry early.
      if (delayMs >= deadline - Date.now()) {
        return result;
      }
      await waitForRetry(delayMs, requestSignal);
    }
    throw new Error('Lambda request exhausted its attempt limit.');
  } finally {
    timeout.clear();
  }
};

export const isValidLambdaTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) {
    return false;
  }
  const [, year, month, day, hour, minute, second] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  return (
    calendar.getUTCMonth() === Number(month) - 1 &&
    calendar.getUTCDate() === Number(day) &&
    Number(hour) < 24 &&
    Number(minute) < 60 &&
    Number(second) < 60
  );
};
