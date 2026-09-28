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

export type CheckOptions = {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
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
async function readSnippet(response: Response): Promise<string | undefined> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    cancelBody(response);
    return undefined;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const stop = setTimeout(
    () => void reader.cancel().catch(() => undefined),
    SNIPPET_TIMEOUT_MS,
  );
  let text = '';
  try {
    while (text.length < SNIPPET_LENGTH) {
      // biome-ignore lint/performance/noAwaitInLoops: A stream is read chunk by chunk, and only until the snippet is long enough.
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // A cancelled or failed stream still leaves the text read so far.
  } finally {
    clearTimeout(stop);
    void reader.cancel().catch(() => undefined);
  }
  return text;
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
          if (method === 'HEAD' || settled || !needsBody(status)) {
            if (method === 'GET' || settled) cancelBody(response);
            finish({ status });
            return;
          }
          // The answer is in: the page it came with gets its own, shorter limit.
          clearTimeout(timeout);
          void readSnippet(response).then((body) => finish({ status, body }));
        },
        () => finish(undefined, new AttemptError('network')),
      );
  });
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
  if (prepared.status !== 'queued') {
    return { ...base, status: prepared.status, message: prepared.message };
  }

  const fetchRequest = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? ATTEMPT_TIMEOUT_MS;

  try {
    const attempt = await requestStatus(
      prepared.url,
      'HEAD',
      signal,
      fetchRequest,
      timeoutMs,
    );
    if (signal.aborted) return cancelled();
    if (isSuccessful(attempt.status)) {
      return classifyAttempt(prepared, attempt, 'HEAD');
    }
  } catch {
    // Sites may reject HEAD, so make one GET attempt unless the scan stopped.
  }
  if (signal.aborted) return cancelled();

  try {
    const attempt = await requestStatus(
      prepared.url,
      'GET',
      signal,
      fetchRequest,
      timeoutMs,
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
