import { buildClient } from '@datocms/cma-client-browser';

export function makeClient(
  apiToken: string,
  environment?: string,
  baseUrl?: string,
) {
  return buildClient({
    apiToken,
    environment,
    ...(baseUrl ? { baseUrl } : {}),
  });
}
