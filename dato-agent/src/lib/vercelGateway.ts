export const VERCEL_GATEWAY_ORIGIN = 'https://ai-gateway.vercel.sh';
export const VERCEL_GATEWAY_MODELS_ENDPOINT = `${VERCEL_GATEWAY_ORIGIN}/v1/models`;
export const VERCEL_GATEWAY_CREDITS_ENDPOINT = `${VERCEL_GATEWAY_ORIGIN}/v1/credits`;

const BLOCKED_GATEWAY_HEADER =
  /^(?:x-stainless-.+|anthropic-dangerous-direct-browser-access)$/i;

/**
 * The gateway's CORS allow-list accepts Authorization and Anthropic's own
 * headers, but not the browser SDK's `x-stainless-*` or
 * `anthropic-dangerous-direct-browser-access` headers. Those fail the
 * preflight before a request can run inside the DatoCMS plugin iframe.
 */
export function createVercelGatewayFetch(
  fetchModels: typeof fetch = fetch,
): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    for (const name of [...headers.keys()]) {
      if (BLOCKED_GATEWAY_HEADER.test(name)) {
        headers.delete(name);
      }
    }
    return fetchModels(input, { ...init, headers });
  };
}
