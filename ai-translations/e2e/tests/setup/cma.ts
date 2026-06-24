import { type Client, buildClient } from '@datocms/cma-client-node';
import { requireEnv } from './env';

/**
 * A CMA client bound to a specific environment (or the project's primary
 * environment when omitted). Schema/content/plugin operations issued through it
 * are scoped to that environment via the `X-Environment` header.
 */
export const cmaClient = (environment?: string): Client =>
  buildClient({ apiToken: requireEnv().E2E_PROJECT_CMA_TOKEN, environment });
