import { buildClient } from '@datocms/cma-client-browser';
import {
  type AssetApi,
  AssetOperationError,
  AssetOperationRejectedError,
} from './unusedAssets';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_FETCH_ATTEMPTS = 5;
const MAX_JOB_WAIT_MS = 60 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

function abortError() {
  return new AssetOperationError('Asset discovery cancelled.');
}

export function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryDelay(response: Response | undefined, attempt: number) {
  const retryAfter = response?.headers.get('Retry-After');
  const seconds =
    retryAfter !== null && retryAfter !== undefined
      ? Number(retryAfter)
      : Number(response?.headers.get('X-RateLimit-Reset'));
  const dateDelay = retryAfter
    ? Date.parse(retryAfter) - Date.now()
    : Number.NaN;
  const serverDelay =
    Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : dateDelay;
  const backoff = Math.min(8000, 500 * 2 ** attempt);
  const delay = Math.max(
    backoff,
    Number.isFinite(serverDelay) ? serverDelay : 0,
  );
  if (delay > MAX_RETRY_DELAY_MS) {
    throw new AssetOperationError(
      'The API requested an unusually long retry delay. No further assets were deleted.',
    );
  }
  return delay;
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchFn(input, {
      ...init,
      signal: controller.signal,
    });
    // Consume the body while the timeout is active: the SDK's timeout only
    // covers response headers and does not abort the underlying fetch.
    const body = response.status === 204 ? null : await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function isRetryableResponse(response: Response | undefined, read: boolean) {
  if (!response || response.status === 429) return true;
  if (!read) return false;
  const contentType = response.headers.get('Content-Type');
  const invalidContentType =
    response.ok && !!contentType && !contentType.includes('application/json');
  return (
    response.status === 408 || response.status >= 500 || invalidContentType
  );
}

async function fetchAttempt(
  fetchFn: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  signal: AbortSignal | undefined,
  read: boolean,
  attempt: number,
) {
  try {
    return await fetchWithTimeout(fetchFn, input, init, signal);
  } catch {
    if (signal?.aborted) throw abortError();
    // Writes may have reached the server. Never replay a lost response.
    if (!read || attempt === MAX_FETCH_ATTEMPTS - 1) {
      throw new AssetOperationError(
        read
          ? 'The API could not be reached after automatic retries.'
          : 'The deletion response was lost. Its outcome could not be confirmed.',
      );
    }
    return undefined;
  }
}

export function createReliableFetch(
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): typeof fetch {
  return async (input, init) => {
    const read =
      (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase() === 'GET';
    for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw abortError();
      // biome-ignore lint/performance/noAwaitInLoops: Each retry must await the previous response.
      const response = await fetchAttempt(
        fetchFn,
        input,
        init,
        signal,
        read,
        attempt,
      );
      if (
        response &&
        (!isRetryableResponse(response, read) ||
          attempt === MAX_FETCH_ATTEMPTS - 1)
      )
        return response;
      await waitForRetry(retryDelay(response, attempt), signal);
    }
    throw new AssetOperationError(
      'The API could not be reached after automatic retries.',
    );
  };
}

function responseStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error))
    return;
  const response = error.response;
  if (
    typeof response !== 'object' ||
    response === null ||
    !('status' in response)
  )
    return;
  return typeof response.status === 'number' ? response.status : undefined;
}

function safeApiError(error: unknown): Error {
  const status = responseStatus(error);
  if (error instanceof AssetOperationError) return error;
  if (status)
    return new AssetOperationError(
      `The API returned HTTP ${status}. No further assets were deleted.`,
    );
  // Avoid SDK error strings, which can include request bodies and headers.
  return new AssetOperationError(
    'The API operation failed. No further assets were deleted.',
  );
}

function createWriteClient(options: Parameters<typeof buildClient>[0]) {
  const client = buildClient({
    ...options,
    fetchFn: createReliableFetch(),
  });
  let accepted = false;
  client.jobResultsFetcher = async (jobId) => {
    accepted = true;
    const deadline = Date.now() + MAX_JOB_WAIT_MS;
    while (Date.now() < deadline) {
      // biome-ignore lint/performance/noAwaitInLoops: Poll the same job, with one request in flight.
      await waitForRetry(2000);
      try {
        return await client.jobResults.find(jobId);
      } catch (error) {
        if (responseStatus(error) !== 404) {
          throw new AssetOperationError(
            `Could not confirm deletion job ${jobId}. No further assets were deleted.`,
          );
        }
      }
    }
    throw new AssetOperationError(
      `Deletion job ${jobId} has not completed after one hour. Its outcome is unknown.`,
    );
  };
  return { client, wasAccepted: () => accepted };
}

export function createAssetClient(config: {
  apiToken: string;
  environment: string;
  baseUrl?: string;
}): AssetApi {
  const clientOptions = {
    ...config,
    autoRetry: false,
    // The transport owns per-attempt timeouts; allow bounded backoff to finish.
    requestTimeout: 30 * 60 * 1000,
  };
  return {
    async list(query, signal) {
      const readClient = buildClient({
        ...clientOptions,
        fetchFn: createReliableFetch(undefined, signal),
      });
      try {
        const response = await readClient.uploads.rawList(query);
        return {
          total: response.meta.total_count,
          assets: response.data.map((asset) => ({
            id: asset.id,
            filename: asset.attributes.filename,
            url: asset.attributes.url,
          })),
        };
      } catch (error) {
        if (signal?.aborted) throw abortError();
        throw safeApiError(error);
      }
    },
    async destroy(ids) {
      const { client, wasAccepted } = createWriteClient(clientOptions);
      try {
        const response = await client.uploads.rawBulkDestroy({
          data: {
            type: 'upload_bulk_destroy_operation',
            relationships: {
              uploads: { data: ids.map((id) => ({ type: 'upload', id })) },
            },
          },
        });
        return response.meta;
      } catch (error) {
        // Our transport/poller messages are safe; ApiError messages are not.
        const status = responseStatus(error);
        if (
          !wasAccepted() &&
          status &&
          status >= 400 &&
          status < 500 &&
          status !== 408
        ) {
          throw new AssetOperationRejectedError(
            `The deletion request was rejected (HTTP ${status}). No further assets were deleted.`,
          );
        }
        throw safeApiError(error);
      }
    },
  };
}
