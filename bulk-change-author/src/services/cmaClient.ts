import { buildClient } from '@datocms/cma-client-browser';

export const REQUEST_TIMEOUT_MS = 30_000;

// Keep the deadline active through response-body consumption. The SDK timeout
// alone stops waiting for headers but does not abort the underlying fetch.
export const fetchWithDeadline: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const body = response.status === 204 ? null : await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    clearTimeout(timer);
  }
};

export function makeClient(
  apiToken: string,
  environment?: string,
  baseUrl?: string,
) {
  return buildClient({
    apiToken,
    environment,
    autoRetry: false,
    requestTimeout: REQUEST_TIMEOUT_MS + 5_000,
    fetchFn: fetchWithDeadline,
    ...(baseUrl ? { baseUrl } : {}),
  });
}
