import { buildClient, type Client } from '@datocms/cma-client-browser';

/**
 * Create a DatoCMS CMA client from a token
 * Returns null if no token is provided
 */
export function createApiClient(token: string | null | undefined): Client | null {
  if (!token) return null;
  return buildClient({ apiToken: token });
}
