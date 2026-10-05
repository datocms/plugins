/**
 * DatoCMS CMA Client Utilities
 *
 * @module utils/client
 */

import { buildClient } from '@datocms/cma-client-browser';
import type { CMAClient } from '../types';

/**
 * Creates a DatoCMS CMA client configured for browser use. Rate limits,
 * timeouts and transient failures are retried by the client itself.
 */
export function createClient(
  apiToken: string,
  environment: string,
  baseUrl?: string,
): CMAClient {
  return buildClient({ apiToken, environment, baseUrl });
}
