import { buildClient, type Client } from '@datocms/cma-client-browser';

export type CmaClientContext = {
  currentUserAccessToken?: string | null;
  environment: string;
  cmaBaseUrl?: string;
};

export class MissingAccessTokenError extends Error {
  constructor() {
    super(
      'This page requires API access. Check the plugin permissions and reload the page.',
    );
    this.name = 'MissingAccessTokenError';
  }
}

export function buildCmaClient(ctx: CmaClientContext): Client {
  if (!ctx.currentUserAccessToken) {
    throw new MissingAccessTokenError();
  }

  return buildClient({
    apiToken: ctx.currentUserAccessToken,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
  });
}
