import { buildClient, type Client } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx, RenderPageCtx } from 'datocms-plugin-sdk';

type ClientCtx = Pick<
  RenderConfigScreenCtx | RenderPageCtx,
  'currentUserAccessToken' | 'environment' | 'cmaBaseUrl'
>;

export function buildCmaClient(ctx: ClientCtx): Client {
  return buildClient({
    apiToken: ctx.currentUserAccessToken ?? null,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
  });
}
