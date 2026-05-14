import {
  buildClient,
  type Client,
  type ClientConfigOptions,
} from '@datocms/cma-client';
import type { RenderConfigScreenCtx, RenderPageCtx } from 'datocms-plugin-sdk';

type CtxWithAuth =
  | Pick<RenderPageCtx, 'currentUserAccessToken' | 'environment' | 'cmaBaseUrl'>
  | Pick<
      RenderConfigScreenCtx,
      'currentUserAccessToken' | 'environment' | 'cmaBaseUrl'
    >;

/** Create a CMA client configured for the current plugin session. */
export function createCmaClient(
  ctx: CtxWithAuth,
  overrides?: Partial<ClientConfigOptions>,
): Client {
  const apiToken = ctx.currentUserAccessToken;
  if (!apiToken) {
    throw new Error('No access token available for the current user.');
  }

  return buildClient({
    apiToken,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
    // Sensible defaults for plugin usage
    autoRetry: true,
    requestTimeout: 60000,
    ...(overrides || {}),
  });
}
