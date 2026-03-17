import { buildClient, type Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';

export function createEnvironmentClient(
  apiToken: string,
  environment: string,
): Client {
  return buildClient({
    apiToken,
    environment,
    autoRetry: true,
    requestTimeout: 60000,
  });
}

export function createRootClient(apiToken: string): Client {
  return buildClient({
    apiToken,
    autoRetry: true,
    requestTimeout: 60000,
  });
}

export function buildPageUrl(
  ctx: Pick<RenderPageCtx, 'environment' | 'isEnvironmentPrimary' | 'plugin'>,
  pageId: string,
  params?: Record<string, string | undefined>,
): string {
  const prefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  const search = new URLSearchParams();

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        search.set(key, value);
      }
    }
  }

  const queryString = search.toString();

  return `${prefix}/configuration/p/${ctx.plugin.id}/pages/${pageId}${
    queryString ? `?${queryString}` : ''
  }`;
}
