import {
  ApiError,
  buildClient,
  type Client,
} from '@datocms/cma-client-browser';

const REQUEST_INTERVAL_MS = 150;
const REQUEST_TIMEOUT_MS = 30_000;
const JOB_TIMEOUT_MS = 10 * 60_000;
const MAX_ATTEMPTS = 4;

export interface CmaClientOptions {
  checkCancellation?: () => boolean;
  onRetry?: () => void;
  fetchFn?: typeof fetch;
  intervalMs?: number;
  requestTimeoutMs?: number;
  jobTimeoutMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

/** A lost write response never establishes whether the server applied it. */
export class CmaUncertainOutcomeError extends Error {
  readonly uncertain = true;

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CmaUncertainOutcomeError';
  }
}

export class CmaRequestTimeoutError extends Error {
  constructor() {
    super('The CMA request timed out.');
    this.name = 'CmaRequestTimeoutError';
  }
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Serialize starts, including retries and job polls, while allowing requests to overlap. */
class RequestScheduler {
  private nextRequestAt = 0;
  private cooldownUntil = 0;
  private queue = Promise.resolve();

  constructor(
    private readonly options: Required<
      Pick<CmaClientOptions, 'now' | 'wait' | 'intervalMs'>
    >,
  ) {}

  beforeRequest(
    checkCancellation?: () => boolean,
    deadline?: number,
  ): Promise<void> {
    const turn = this.queue.then(async () => {
      for (;;) {
        if (checkCancellation?.()) {
          const error = new Error('Operation cancelled');
          error.name = 'AbortError';
          throw error;
        }
        const delay =
          Math.max(this.nextRequestAt, this.cooldownUntil) - this.options.now();
        if (delay <= 0) break;
        // Long server cooldowns remain respected, with regular cancellation checks.
        // biome-ignore lint/performance/noAwaitInLoops: Respect shared cooldowns before starting the next request.
        await this.options.wait(
          Math.min(
            delay,
            1000,
            deadline === undefined
              ? Number.POSITIVE_INFINITY
              : deadline - this.options.now(),
          ),
        );
      }
      this.nextRequestAt = this.options.now() + this.options.intervalMs;
    });
    this.queue = turn.catch(() => {});
    return turn;
  }

  cooldown(milliseconds: number): void {
    this.cooldownUntil = Math.max(
      this.cooldownUntil,
      this.options.now() + milliseconds,
    );
  }
}

function retryDelay(response: Response, attempt: number, now: number): number {
  const retryAfter = response.headers.get('retry-after');
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  const date = retryAfter === null ? Number.NaN : Date.parse(retryAfter);
  const retryAfterMs = Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Number.isFinite(date)
      ? Math.max(0, date - now)
      : 0;
  return Math.max(
    1000 * 2 ** attempt,
    retryAfterMs,
    Number.isFinite(reset) ? Math.max(0, reset * 1000) : 0,
  );
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const originalSignal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort();
  originalSignal?.addEventListener('abort', abort, { once: true });
  if (originalSignal?.aborted) controller.abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchFn(input, {
          ...init,
          signal: controller.signal,
        });
        // Include response-body transfer in the timeout. The SDK stops its timer
        // at response headers, which otherwise allows a stalled body to hang.
        const body =
          response.status === 204 ? null : await response.arrayBuffer();
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new CmaRequestTimeoutError());
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    originalSignal?.removeEventListener('abort', abort);
  }
}

/** Central transport for all SDK requests, including asynchronous job results. */
function checkJobDeadline(
  jobId: string,
  deadline: number | undefined,
  now: () => number,
): void {
  if (deadline !== undefined && now() >= deadline) {
    throw new CmaUncertainOutcomeError(
      `Timed out while observing CMA job ${jobId}; the accepted write may still complete.`,
    );
  }
}

function requestContext(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  jobDeadlines: ReadonlyMap<string, number>,
  options: CmaClientOptions,
  now: () => number,
) {
  const method = (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  const url = input instanceof Request ? input.url : String(input);
  const jobId = new URL(url, 'https://site-api.datocms.com').pathname.match(
    /\/job-results\/([^/]+)$/,
  )?.[1];
  const deadline = jobId ? jobDeadlines.get(jobId) : undefined;
  return {
    read: method === 'GET' || method === 'HEAD',
    deadline,
    // Observe accepted asynchronous writes even after cancellation.
    checkCancellation: jobId
      ? () => {
          checkJobDeadline(jobId, deadline, now);
          return false;
        }
      : options.checkCancellation,
  };
}

type RequestContext = ReturnType<typeof requestContext>;
type RequestAttempt =
  | { response: Response; delay?: number }
  | { error: unknown; delay: number };

function responseDelay(
  response: Response,
  read: boolean,
  attempt: number,
  now: number,
): number | undefined {
  if (response.status === 429) return retryDelay(response, attempt, now);
  const transient = response.status >= 500 && response.status <= 599;
  if (!read && transient) {
    throw new CmaUncertainOutcomeError(
      `The CMA returned HTTP ${response.status} for a write; its outcome must be checked before retrying.`,
    );
  }
  return read && transient ? retryDelay(response, attempt, now) : undefined;
}

async function requestAttempt(
  fetchFn: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  context: RequestContext,
  attempt: number,
  timeoutMs: number,
  now: () => number,
): Promise<RequestAttempt> {
  try {
    const timeout = Math.min(
      timeoutMs,
      context.deadline === undefined
        ? Number.POSITIVE_INFINITY
        : context.deadline - now(),
    );
    const response = await fetchWithTimeout(fetchFn, input, init, timeout);
    return {
      response,
      delay: responseDelay(response, context.read, attempt, now()),
    };
  } catch (error) {
    if (!context.read) {
      if (error instanceof CmaUncertainOutcomeError) throw error;
      throw new CmaUncertainOutcomeError(
        'The write response was lost; its outcome must be checked before retrying.',
        error,
      );
    }
    if (
      !(error instanceof TypeError || error instanceof CmaRequestTimeoutError)
    )
      throw error;
    return { error, delay: 1000 * 2 ** attempt };
  }
}

export function createCmaFetch(
  options: CmaClientOptions = {},
  jobDeadlines: ReadonlyMap<string, number> = new Map(),
): typeof fetch {
  const now = options.now ?? Date.now;
  const waitFor = options.wait ?? wait;
  const scheduler = new RequestScheduler({
    now,
    wait: waitFor,
    intervalMs: options.intervalMs ?? REQUEST_INTERVAL_MS,
  });
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);

  return async (input, init) => {
    const context = requestContext(input, init, jobDeadlines, options, now);
    for (let attempt = 0; ; attempt++) {
      // biome-ignore lint/performance/noAwaitInLoops: Retries must follow the preceding request and its cooldown.
      await scheduler.beforeRequest(
        context.checkCancellation,
        context.deadline,
      );
      const result = await requestAttempt(
        fetchFn,
        input,
        init,
        context,
        attempt,
        options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
        now,
      );
      if (result.delay !== undefined) scheduler.cooldown(result.delay);
      const exhausted = attempt >= MAX_ATTEMPTS - 1;
      if ('error' in result && exhausted) throw result.error;
      if ('response' in result && (result.delay === undefined || exhausted))
        return result.response;
      options.onRetry?.();
    }
  };
}

async function pollJob(client: Client, jobId: string) {
  try {
    return await client.jobResults.find(jobId);
  } catch (error) {
    if (error instanceof ApiError && error.response.status === 404)
      return undefined;
    throw new CmaUncertainOutcomeError(
      `Could not determine the outcome of CMA job ${jobId}; the accepted write may still complete.`,
      error,
    );
  }
}

export function createCmaClient(
  apiToken: string,
  environment?: string,
  baseUrl?: string,
  options: CmaClientOptions = {},
): Client {
  const jobDeadlines = new Map<string, number>();
  const transport = createCmaFetch(options, jobDeadlines);
  const client = buildClient({
    apiToken,
    environment,
    baseUrl,
    autoRetry: false,
    // Our timeout starts when a network request starts, rather than while it is
    // waiting for a server-directed cooldown. Disable the SDK's competing timer.
    requestTimeout: 2_147_483_647,
    fetchFn: async (input, init) => {
      try {
        return await transport(input, init);
      } catch (error) {
        // SDK v5 clears its request timer only after fetch resolves. Surface a
        // transport failure from json(), after that cleanup, rather than leaking
        // one long-lived SDK timer per failed request. autoRetry remains false.
        const response = new Response('{}', {
          headers: { 'content-type': 'application/json' },
        });
        response.json = async () => {
          throw error;
        };
        return response;
      }
    },
  });
  const now = options.now ?? Date.now;
  const waitFor = options.wait ?? wait;

  client.jobResultsFetcher = async (jobId) => {
    const deadline = now() + (options.jobTimeoutMs ?? JOB_TIMEOUT_MS);
    jobDeadlines.set(jobId, deadline);
    try {
      for (;;) {
        checkJobDeadline(jobId, deadline, now);
        // biome-ignore lint/performance/noAwaitInLoops: Poll a single accepted job sequentially.
        await waitFor(Math.min(1000, deadline - now()));
        checkJobDeadline(jobId, deadline, now);
        const result = await pollJob(client, jobId);
        if (result) return result;
      }
    } finally {
      jobDeadlines.delete(jobId);
    }
  };
  return client;
}
