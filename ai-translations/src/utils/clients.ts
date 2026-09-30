/**
 * Utilities for creating and configuring API clients
 */
import { buildClient } from '@datocms/cma-client-browser';

async function fetchWithCancellation(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  signal: AbortSignal,
): Promise<Response> {
  try {
    signal.throwIfAborted();
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (signal.aborted) {
      // The CMA client's transport assumes error.code is a string, whereas
      // DOMException has a numeric code. Preserve cancellation without it.
      const cancelled = new Error('DatoCMS request was cancelled', {
        cause: error,
      });
      cancelled.name = 'AbortError';
      throw cancelled;
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
  return buildClient({
    apiToken: accessToken,
    environment,
    baseUrl,
    fetchFn: abortSignal
      ? (input, init) => fetchWithCancellation(input, init, abortSignal)
      : undefined,
  });
}
