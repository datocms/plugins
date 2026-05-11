import { buildClient, type Client } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx, RenderPageCtx } from 'datocms-plugin-sdk';

type ClientCtx = RenderConfigScreenCtx | RenderPageCtx;

export function buildCmaClient(ctx: ClientCtx): Client {
  return buildClient({
    apiToken: ctx.currentUserAccessToken ?? null,
    environment: ctx.environment,
  });
}
