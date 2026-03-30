/**
 * DatoCMS CMA Client Utilities
 * 
 * Provides functions for creating and working with the DatoCMS
 * Content Management API (CMA) client.
 * 
 * @module utils/client
 */

import { buildClient, LogLevel } from '@datocms/cma-client-browser';
import type { CMAClient } from '../types';

// =============================================================================
// Client Creation
// =============================================================================

/**
 * Creates a DatoCMS CMA client configured for browser use.
 * 
 * Features:
 * - Automatic retry on rate limit errors
 * - Verbose logging in development mode
 * 
 * @param apiToken - The user's API access token
 * @returns Configured CMA client instance
 * 
 * @example
 * const client = createClient(ctx.currentUserAccessToken);
 * const models = await client.itemTypes.list();
 */
export function createClient(apiToken: string): CMAClient {
  return buildClient({
    apiToken,
    autoRetry: true,
    logLevel: (import.meta.env.DEV ? 'BODY' : 'NONE') as unknown as LogLevel,
  });
}

