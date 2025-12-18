import { buildClient, type Client } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx, RenderPageCtx } from 'datocms-plugin-sdk';

type ClientCtx = RenderConfigScreenCtx | RenderPageCtx;

export function buildCmaClient(ctx: ClientCtx): Client {
  const envSource = ctx.environment as string | { id?: string } | null | undefined;
  const environmentId =
    typeof envSource === 'string' ? envSource : envSource?.id ?? null;

  const config: Parameters<typeof buildClient>[0] = {
    apiToken: ctx.currentUserAccessToken ?? null,
  };

  if (environmentId) {
    config.environment = environmentId;
  }

  return buildClient(config);
}
