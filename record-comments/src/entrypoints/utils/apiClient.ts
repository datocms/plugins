import { buildClient, type Client } from '@datocms/cma-client-browser';

export function createApiClient(token: string | null | undefined): Client | null {
  if (!token) return null;
  return buildClient({ apiToken: token });
}
