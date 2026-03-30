/**
 * Utilities for creating and configuring API clients
 */
import { buildClient } from '@datocms/cma-client-browser';

/**
 * Creates a DatoCMS CMA client with the provided access token and environment.
 *
 * @param accessToken - Current user API token.
 * @param environment - Dato environment slug.
 * @returns A configured CMA client instance.
 */
export function buildDatoCMSClient(accessToken: string, environment: string) {
  return buildClient({
    apiToken: accessToken,
    environment
  });
}
