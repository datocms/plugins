/**
 * Utilities for creating and configuring API clients
 */
import { buildClient } from '@datocms/cma-client-browser';
import {
  retryAfterMs,
  waitForRequest,
} from './translation/ProviderRequestControl';
import { withTimeout } from './translation/providerUtils';
import { createTimeoutSignal } from './translation/types';

/** Reads include the body in their deadline so slow JSON cannot hang a run. */
async function fetchAttempt(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  isRead: boolean,
  abortSignal?: AbortSignal,
): Promise<Response> {
  return withTimeout(
    {
      abortSignal: isRead ? abortSignal : undefined,
      timeoutMs: isRead ? undefined : 15 * 60 * 1000,
    },
    async (signal) => {
      const response = await fetch(input, { ...init, signal });
      const body =
        response.status === 204 ? null : await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  );
}

function retryDelay(response: Response, attempt: number): number {
  const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
  return Math.max(
    Math.min(1000 * 2 ** attempt, 30_000),
    retryAfterMs(response.headers) ?? 0,
    Number.isFinite(reset) && reset > 0 ? reset : 0,
  );
}

function isReadTransportError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    ((error instanceof Error || error instanceof DOMException) &&
      error.name === 'TimeoutError')
  );
}

async function fetchWithRetries(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  signal?: AbortSignal,
): Promise<Response> {
  const isRead =
    !init?.method || init.method === 'GET' || init.method === 'HEAD';
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    let response: Response;
    try {
      // Accepted writes settle after cancellation; a POST can create new blocks.
      // biome-ignore lint/performance/noAwaitInLoops: Only one bounded retry of this request may run at a time.
      response = await fetchAttempt(input, init, isRead, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (!isRead || attempt >= 5 || !isReadTransportError(error)) throw error;
      await waitForRequest(Math.min(1000 * 2 ** attempt, 30_000), signal);
      continue;
    }
    const retryable =
      response.status === 429 ||
      (isRead && [500, 502, 503, 504].includes(response.status));
    if (attempt >= 5 || !retryable) return response;
    await response.body?.cancel();
    await waitForRequest(retryDelay(response, attempt), signal);
  }
}

async function fetchDatoCMS(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetchWithRetries(input, init, signal);
  } catch (error) {
    if (signal?.aborted) {
      // The SDK assumes error.code is a string; DOMException has numeric code.
      const cancelled = new Error('DatoCMS request was cancelled', {
        cause: error,
      });
      cancelled.name = 'AbortError';
      throw cancelled;
    }
    if (
      (error instanceof Error || error instanceof DOMException) &&
      error.name === 'TimeoutError'
    ) {
      const timeout = new Error(
        'DatoCMS request timed out. A submitted write may still complete on the server; it was not repeated.',
        { cause: error },
      );
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    throw error;
  }
}

/**
 * Creates a DatoCMS CMA client with the provided access token and environment.
 *
 * @param accessToken - Current user API token.
 * @param environment - Dato environment slug.
 * @returns A configured CMA client instance.
 */
export function buildDatoCMSClient(
  accessToken: string,
  environment: string,
  baseUrl?: string,
  abortSignal?: AbortSignal,
) {
  const config = {
    apiToken: accessToken,
    environment,
    baseUrl,
    // The SDK retries timeouts and transient errors on writes and has no
    // bounded rate-limit retry budget. Keep transport retries here instead.
    autoRetry: false,
    requestTimeout: 20 * 60 * 1000,
  };
  const client = buildClient({
    ...config,
    fetchFn: (input, init) => fetchDatoCMS(input, init, abortSignal),
  });
  client.jobResultsFetcher = async (jobId) => {
    // A 202 means the mutation was accepted. Poll its result without replaying
    // the mutation or interrupting accepted work when the user cancels.
    const { signal, cleanup } = createTimeoutSignal(15 * 60 * 1000);
    const jobClient = buildClient({
      ...config,
      fetchFn: (input, init) => fetchDatoCMS(input, init, signal),
    });
    try {
      for (let attempt = 1; ; attempt += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: Poll one accepted job until completion or deadline.
        await waitForRequest(Math.min(attempt * 1000, 10_000), signal);
        try {
          return await jobClient.jobResults.find(jobId);
        } catch (error) {
          const status = (error as { response?: { status?: number } }).response
            ?.status;
          if (status !== 404) throw error;
        }
      }
    } catch (error) {
      if (signal.aborted) {
        throw new Error(
          `DatoCMS job ${jobId} did not finish within 15 minutes. It may still complete on the server; the request was not repeated.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      cleanup();
    }
  };
  return client;
}
