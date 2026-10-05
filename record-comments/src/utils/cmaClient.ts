import { buildClient, type Client } from '@datocms/cma-client-browser';

export function createApiClient(
  token: string | null | undefined,
  environment: string,
  baseUrl?: string,
): Client | null {
  if (!token) return null;
  return buildClient({ apiToken: token, environment, baseUrl });
}
