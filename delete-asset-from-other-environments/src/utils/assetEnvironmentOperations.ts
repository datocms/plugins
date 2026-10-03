import {
  ApiError,
  buildClient,
  type SchemaTypes,
  TimeoutError,
} from '@datocms/cma-client-browser';

export type Environment = SchemaTypes.Environment;
export type EnvironmentFailure = { envId: string; message: string };
export type Progress = { completed: number; total: number };

const CONCURRENCY = 4;
const REQUEST_INTERVAL_MS = 250;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 5;

class RequestTimeoutError extends Error {}

function checkCanceled(signal: AbortSignal) {
  if (signal.aborted)
    throw new DOMException('Operation canceled', 'AbortError');
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  checkCanceled(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Operation canceled', 'AbortError'));
    };
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.min(ms, 60_000),
    );
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitUntil(deadline: number, signal: AbortSignal): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining > 0) {
    await delay(remaining, signal);
    return waitUntil(deadline, signal);
  }
  checkCanceled(signal);
}

/** Also abort the actual HTTP request, including reading the response body. */
function abortableFetch(
  signal: AbortSignal,
  fetchFn: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    checkCanceled(signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchFn(input, {
        ...init,
        signal: controller.signal,
      });
      const body = response.status === 204 ? null : await response.text();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      checkCanceled(signal);
      if (timedOut) throw new RequestTimeoutError('Request timed out');
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  };
}

function isUploadMissing(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.response.status === 404 &&
    error.errors.length > 0 &&
    error.errors.every((entry) => entry.attributes.code === 'NOT_FOUND')
  );
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) {
    return (
      error.response.status === 429 ||
      error.response.status >= 500 ||
      error.errors.some((entry) => entry.attributes.transient) ||
      (error.response.status >= 200 && error.response.status < 300)
    );
  }
  return (
    error instanceof RequestTimeoutError ||
    error instanceof TimeoutError ||
    error instanceof TypeError ||
    error instanceof SyntaxError
  );
}

function isUncertainResponse(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return (
    error.response.status >= 500 ||
    (error.response.status >= 200 && error.response.status < 300) ||
    (error.response.status !== 429 &&
      error.errors.some((entry) => entry.attributes.transient))
  );
}

function retryDelay(error: unknown, attempt: number): number {
  const fallback = 1000 * 2 ** attempt + Math.random() * 250;
  if (!(error instanceof ApiError)) return fallback;
  const headers = error.response.headers;
  const retryAfter = headers['retry-after'];
  const seconds = Number(retryAfter ?? headers['x-ratelimit-reset']);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(fallback, seconds * 1000);
  }
  const date = retryAfter ? Date.parse(retryAfter) : Number.NaN;
  return Number.isFinite(date)
    ? Math.max(fallback, date - Date.now())
    : fallback;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const code = error.errors[0]?.attributes.code;
    if (code === 'UPLOAD_IS_CURRENTLY_IN_USE') {
      return 'Asset is used by records in this environment and cannot be deleted.';
    }
    return code
      ? `${code} (HTTP ${error.response.status})`
      : `HTTP ${error.response.status}`;
  }
  if (error instanceof RequestTimeoutError || error instanceof TimeoutError) {
    return 'Request timed out after automatic retries. The outcome may be unknown; check this environment.';
  }
  return 'Could not complete the request. Check your connection and access permissions.';
}

/** Allocate promises only for active workers; never queue every environment. */
export async function runEnvironmentTasks<T>(
  environments: Environment[],
  signal: AbortSignal,
  task: (environment: Environment) => Promise<T>,
  onProgress?: (progress: Progress) => void,
): Promise<{ results: T[]; failures: EnvironmentFailure[] }> {
  const results: T[] = [];
  const failures: EnvironmentFailure[] = [];
  let cursor = 0;
  let completed = 0;
  onProgress?.({ completed, total: environments.length });
  const worker = async () => {
    while (cursor < environments.length) {
      checkCanceled(signal);
      const environment = environments[cursor++];
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Each of the four workers must wait before taking another environment.
        const result = await task(environment);
        checkCanceled(signal);
        results.push(result);
      } catch (error) {
        checkCanceled(signal);
        failures.push({ envId: environment.id, message: describeError(error) });
      }
      completed += 1;
      onProgress?.({ completed, total: environments.length });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, environments.length) }, worker),
  );
  checkCanceled(signal);
  return { results, failures };
}

type Options = {
  apiToken: string;
  baseUrl: string;
  signal: AbortSignal;
  fetchFn?: typeof fetch;
};

export function createAssetEnvironmentOperations({
  apiToken,
  baseUrl,
  signal,
  fetchFn = fetch,
}: Options) {
  let nextRequestAt = 0;
  let cooldownUntil = 0;
  const sessionFetch = abortableFetch(signal, fetchFn);
  const clientFor = (environment?: string) =>
    buildClient({
      apiToken,
      baseUrl,
      environment,
      // SDK retries on 429/transient errors are unbounded. Own the retry budget.
      autoRetry: false,
      requestTimeout: REQUEST_TIMEOUT_MS + 5000,
      fetchFn: sessionFetch,
    });

  const acquire = async (): Promise<void> => {
    checkCanceled(signal);
    const wait = Math.max(nextRequestAt, cooldownUntil) - Date.now();
    if (wait <= 0) {
      nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
      return;
    }
    await delay(wait, signal);
    return acquire();
  };

  const waitBeforeRetry = async (error: unknown, attempt: number) => {
    const wait = retryDelay(error, attempt);
    // All workers honor the server's rate-limit cooldown.
    if (error instanceof ApiError && error.response.status === 429) {
      cooldownUntil = Math.max(cooldownUntil, Date.now() + wait);
    }
    await waitUntil(Date.now() + wait, signal);
  };

  const request = async <T>(
    operation: () => Promise<T>,
    reconcile?: () => Promise<
      { resolved: true; value: T } | { resolved: false }
    >,
    attempt = 0,
  ): Promise<T> => {
    await acquire();
    try {
      return await operation();
    } catch (error) {
      checkCanceled(signal);
      // Verify an uncertain DELETE before replay, including the final attempt.
      if (reconcile && isUncertainResponse(error)) {
        const outcome = await reconcile();
        if (outcome.resolved) return outcome.value;
      }
      if (!isRetryable(error) || attempt + 1 >= MAX_ATTEMPTS) throw error;
      await waitBeforeRetry(error, attempt);
      return request(operation, reconcile, attempt + 1);
    }
  };

  const otherEnvironments = (environments: Environment[], currentEnv: string) =>
    Array.from(
      new Map(
        environments
          .filter((env) => env.id !== currentEnv)
          .map((env) => [env.id, env]),
      ).values(),
    );

  return {
    // The CMA environment endpoint returns all environments; it is not paginated.
    listEnvironments: () => request(() => clientFor().environments.list()),

    async checkEnvironments(
      environments: Environment[],
      uploadId: string,
      currentEnv: string,
      onProgress?: (progress: Progress) => void,
    ) {
      const { results, failures } = await runEnvironmentTasks(
        otherEnvironments(environments, currentEnv),
        signal,
        async (env) => {
          try {
            await request(() => clientFor(env.id).uploads.find(uploadId));
            return env;
          } catch (error) {
            if (isUploadMissing(error)) return null;
            throw error;
          }
        },
        onProgress,
      );
      return {
        matches: results.filter((env): env is Environment => env !== null),
        failures,
      };
    },

    async deleteCopies(
      environments: Environment[],
      uploadId: string,
      currentEnv: string,
      onProgress?: (progress: Progress) => void,
    ) {
      const { results, failures } = await runEnvironmentTasks(
        otherEnvironments(environments, currentEnv),
        signal,
        async (env) => {
          try {
            const deleted = await request(
              async () => {
                await clientFor(env.id).uploads.destroy(uploadId);
                return true;
              },
              async () => {
                try {
                  await request(() => clientFor(env.id).uploads.find(uploadId));
                  return { resolved: false };
                } catch (error) {
                  if (isUploadMissing(error))
                    return { resolved: true, value: false };
                  throw error;
                }
              },
            );
            return { envId: env.id, deleted };
          } catch (error) {
            if (isUploadMissing(error))
              return { envId: env.id, deleted: false };
            throw error;
          }
        },
        onProgress,
      );
      return {
        deletedEnvIds: results
          .filter((result) => result.deleted)
          .map((result) => result.envId),
        absentEnvIds: results
          .filter((result) => !result.deleted)
          .map((result) => result.envId),
        failures,
      };
    },
  };
}
