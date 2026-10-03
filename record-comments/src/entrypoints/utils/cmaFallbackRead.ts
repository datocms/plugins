import { buildClient, type Client } from '@datocms/cma-client-browser';

export const CMA_READ_LIMITS = {
  MAX_REQUESTS: 5,
  MAX_DURATION_MS: 120000,
} as const;

/** Keep SDK retries, while bounding and canceling this read's transport. */
export function createCmaFallbackRead(
  client: Client,
  onDeadline: (error: Error) => void,
) {
  const scope = new AbortController();
  let activeRequest: AbortController | null = null;
  let requests = 0;
  const fetchFn = client.config.fetchFn ?? fetch;

  scope.signal.addEventListener('abort', () => {
    activeRequest?.abort(scope.signal.reason);
  });

  const scopedClient = buildClient({
    ...client.config,
    fetchFn: async (input, init) => {
      scope.signal.throwIfAborted();

      // SDK timeouts reject its promise without aborting fetch. Stop that
      // transport before the SDK starts another attempt.
      activeRequest?.abort(new Error('Previous SDK request ended.'));
      if (requests >= CMA_READ_LIMITS.MAX_REQUESTS) {
        throw new Error('Comments fetch exceeded the SDK request limit.');
      }
      requests += 1;
      activeRequest = new AbortController();
      return fetchFn(input, { ...init, signal: activeRequest.signal });
    },
  });

  const deadline = setTimeout(() => {
    const error = new Error('Comments fetch timed out after 120 seconds.');
    scope.abort(error);
    onDeadline(error);
  }, CMA_READ_LIMITS.MAX_DURATION_MS);

  return {
    client: scopedClient,
    isCanceled: () => scope.signal.aborted,
    cancel() {
      clearTimeout(deadline);
      scope.abort(new Error('Comments fetch canceled.'));
    },
  };
}
