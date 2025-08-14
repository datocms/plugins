import {
  buildClient,
  type Client,
  type ClientConfigOptions,
} from '@datocms/cma-client';
import type { RenderConfigScreenCtx, RenderPageCtx } from 'datocms-plugin-sdk';

type CtxWithAuth =
  | Pick<RenderPageCtx, 'currentUserAccessToken' | 'environment'>
  | Pick<RenderConfigScreenCtx, 'currentUserAccessToken' | 'environment'>;

export function createCmaClient(
  ctx: CtxWithAuth,
  overrides?: Partial<ClientConfigOptions>,
): Client {
  return buildClient({
    apiToken: ctx.currentUserAccessToken!,
    environment: ctx.environment,
    // Sensible defaults for plugin usage
    autoRetry: true,
    requestTimeout: 60000,
    ...(overrides || {}),
  });
}
