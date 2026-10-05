import type { CheckResult, PreparedUrl } from '../types';
import {
  type Attempt,
  classifyAttempt,
  isSuccessful,
  needsBody,
} from './classify';

const PROXY_URL = 'https://cors-proxy.datocms.com/';
const ATTEMPT_TIMEOUT_MS = 10_000;
/** Enough of a page to recognize a bot challenge or an error page. */
const SNIPPET_LENGTH = 16_384;
const SNIPPET_TIMEOUT_MS = 3_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;
/** Longer server hints are respected by ending this check without an early retry. */
const MAX_RETRY_DELAY_MS = 30_000;

export type CheckOptions = {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** May reduce the production retry budget, but never increase it. */
  maxRetries?: number;
  /** Lets the queue honor a host's waiting period across different URLs. */
  onBackoff?: (backoff: { until: number; httpStatus: number }) => void;
};

class AttemptError extends Error {
  constructor(readonly kind: 'timeout' | 'network' | 'cancelled') {
    super(kind);
  }
}

function cancelBody(response: Response): void {
  // A clear status needs no page: don't download the target page or binary asset.
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // A response whose stream is already closed requires no cleanup.
  }
}

/** Reads the start of an unclear answer; a stream that stalls or fails leaves what already arrived. */
async function readSnippet(
  response: Response,
  signal: AbortSignal,
): Promise<string | undefined> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    cancelBody(response);
    return undefined;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytesRead = 0;
  let stopped = false;
  let stopReading = () => {};
  const stoppedReading = new Promise<undefined>((resolve) => {
    stopReading = () => {
      stopped = true;
      resolve(undefined);
    };
  });
  const stop = setTimeout(stopReading, SNIPPET_TIMEOUT_MS);
  signal.addEventListener('abort', stopReading, { once: true });
  if (signal.aborted) stopReading();
  try {
    while (!stopped && bytesRead < SNIPPET_LENGTH) {
      // biome-ignore lint/performance/noAwaitInLoops: A stream is read chunk by chunk, and only until the snippet is long enough.
      const chunk = await Promise.race([reader.read(), stoppedReading]);
      if (!chunk) break;
      const { done, value } = chunk;
      if (done) break;
      const prefix = value.subarray(0, SNIPPET_LENGTH - bytesRead);
      bytesRead += prefix.byteLength;
      text += decoder.decode(prefix, { stream: true });
    }
  } catch {
    // A cancelled or failed stream still leaves the text read so far.
  } finally {
    clearTimeout(stop);
    signal.removeEventListener('abort', stopReading);
    void reader.cancel().catch(() => undefined);
  }
  return text;
}

/** RFC 9110 §10.2.3: Retry-After is either nonnegative seconds or an HTTP date. */
function retryAfter(value: string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const delay = Number(trimmed) * 1_000;
    return Number.isFinite(delay) ? delay : Number.POSITIVE_INFINITY;
  }
  // Reject numeric variants such as -1/1.5 instead of parsing them as dates.
  if (!/[a-z]/i.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (cancelled: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (cancelled) reject(new AttemptError('cancelled'));
      else resolve();
    };
    const onAbort = () => finish(true);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else timer = setTimeout(() => finish(false), delay);
  });
}

function transientStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function retryDelay(attempt: Attempt | undefined, retries: number): number {
  return Math.max(RETRY_DELAY_MS * 2 ** retries, attempt?.retryAfterMs ?? 0);
}

function publishBackoff(
  attempt: Attempt | undefined,
  retries: number,
  onBackoff: CheckOptions['onBackoff'],
): void {
  if (!onBackoff || !attempt || !transientStatus(attempt.status)) return;
  if (attempt.status !== 429 && attempt.retryAfterMs === undefined) return;
  try {
    onBackoff({
      until: Date.now() + retryDelay(attempt, retries),
      httpStatus: attempt.status,
    });
  } catch {
    // A progress consumer cannot change the request's classification or retry budget.
  }
}

function requestStatus(
  url: string,
  method: 'HEAD' | 'GET',
  signal: AbortSignal,
  fetchRequest: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<Attempt> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (attempt?: Attempt, error?: AttemptError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      // Stop any remaining transfer, including a stream adapter whose cancel stalls.
      controller.abort();
      if (error) reject(error);
      else if (attempt !== undefined) resolve(attempt);
    };
    const onAbort = () => {
      finish(undefined, new AttemptError('cancelled'));
      controller.abort();
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    timeout = setTimeout(() => {
      finish(undefined, new AttemptError('timeout'));
      controller.abort();
    }, timeoutMs);

    // Promise.resolve also catches a synchronous exception from a fetch adapter.
    void Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw new AttemptError('cancelled');
        return fetchRequest(`${PROXY_URL}?url=${encodeURIComponent(url)}`, {
          method,
          signal: controller.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
      })
      .then(
        (response) => {
          const { status } = response;
          const retryAfterMs = retryAfter(response.headers?.get('Retry-After'));
          if (method === 'HEAD' || settled || !needsBody(status)) {
            cancelBody(response);
            finish({ status, retryAfterMs });
            return;
          }
          // The answer is in: the page it came with gets its own, shorter limit.
          void readSnippet(response, controller.signal).then(
            (body) => finish({ status, body, retryAfterMs }),
            () => finish({ status, retryAfterMs }),
          );
        },
        () => finish(undefined, new AttemptError('network')),
      );
  });
}

async function checkHead(
  prepared: PreparedUrl,
  signal: AbortSignal,
  fetchRequest: typeof globalThis.fetch,
  timeoutMs: number,
  maxRetries: number,
  onBackoff: CheckOptions['onBackoff'],
): Promise<CheckResult | undefined> {
  try {
    const attempt = await requestStatus(
      prepared.url,
      'HEAD',
      signal,
      fetchRequest,
      timeoutMs,
    );
    if (isSuccessful(attempt.status)) {
      return classifyAttempt(prepared, attempt, 'HEAD');
    }
    publishBackoff(attempt, 0, onBackoff);
    // The proxy also uses 500 for permanent refusals. Read the GET body before retrying those.
    if (attempt.status === 500 && attempt.retryAfterMs === undefined)
      return undefined;
    if (
      transientStatus(attempt.status) &&
      (maxRetries > 0 || attempt.retryAfterMs !== undefined)
    ) {
      const delay = retryDelay(attempt, 0);
      if (delay > MAX_RETRY_DELAY_MS)
        return classifyAttempt(prepared, attempt, 'HEAD');
      await waitForRetry(delay, signal);
    }
  } catch {
    // Sites may reject HEAD, so make one GET attempt unless the scan stopped.
  }
  return undefined;
}

function canRetry(
  prepared: PreparedUrl,
  attempt: Attempt,
  retries: number,
  maxRetries: number,
): boolean {
  if (retries >= maxRetries || !transientStatus(attempt.status)) return false;
  if (retryDelay(attempt, retries) > MAX_RETRY_DELAY_MS) return false;
  const result = classifyAttempt(prepared, attempt, 'GET');
  return result.status !== 'blocked' || result.reason === 'rate-limited';
}

async function checkGet(
  prepared: PreparedUrl,
  signal: AbortSignal,
  fetchRequest: typeof globalThis.fetch,
  timeoutMs: number,
  maxRetries: number,
  onBackoff: CheckOptions['onBackoff'],
): Promise<Attempt> {
  for (let retries = 0; ; retries += 1) {
    let lastAttempt: Attempt | undefined;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Each safe GET retry waits for the previous attempt and its backoff.
      lastAttempt = await requestStatus(
        prepared.url,
        'GET',
        signal,
        fetchRequest,
        timeoutMs,
      );
    } catch (error) {
      // A host that didn't answer in time is unlikely to answer a retry.
      const timedOut =
        error instanceof AttemptError && error.kind === 'timeout';
      if (signal.aborted || timedOut || retries >= maxRetries) throw error;
    }
    publishBackoff(lastAttempt, retries, onBackoff);
    if (lastAttempt && !canRetry(prepared, lastAttempt, retries, maxRetries))
      return lastAttempt;
    await waitForRetry(retryDelay(lastAttempt, retries), signal);
  }
}

/**
 * A failure to verify is not proof of a broken link: only a GET 404 or 410, or
 * a domain that doesn't exist, is broken. See classifyAttempt.
 */
export async function checkUrl(
  prepared: PreparedUrl,
  signal: AbortSignal,
  options: CheckOptions = {},
): Promise<CheckResult> {
  const base = { key: prepared.key, url: prepared.url };
  const cancelled = (): CheckResult => ({
    ...base,
    status: 'cancelled',
    message: 'The link check was cancelled.',
  });
  if (signal.aborted) return cancelled();
  if (prepared.status !== 'queued')
    return { ...base, status: prepared.status, message: prepared.message };

  const fetchRequest = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const maxRetries = Number.isFinite(options.maxRetries)
    ? Math.max(
        0,
        Math.min(MAX_RETRIES, Math.floor(options.maxRetries ?? MAX_RETRIES)),
      )
    : MAX_RETRIES;
  const headResult = await checkHead(
    prepared,
    signal,
    fetchRequest,
    timeoutMs,
    maxRetries,
    options.onBackoff,
  );
  if (signal.aborted) return cancelled();
  if (headResult) return headResult;
  try {
    const attempt = await checkGet(
      prepared,
      signal,
      fetchRequest,
      timeoutMs,
      maxRetries,
      options.onBackoff,
    );
    return signal.aborted
      ? cancelled()
      : classifyAttempt(prepared, attempt, 'GET');
  } catch (error) {
    if (signal.aborted) return cancelled();
    return {
      ...base,
      method: 'GET',
      checkedAt: new Date().toISOString(),
      status: 'unverified',
      message:
        error instanceof AttemptError && error.kind === 'timeout'
          ? 'The request timed out. The link could not be verified.'
          : 'The request failed. The link could not be verified.',
    };
  }
}
