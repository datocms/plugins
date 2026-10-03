import { buildClient, type Client } from '@datocms/cma-client-browser';
import { createCmaFetch, JobPollingError, pollCmaJob } from './requests';

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

  const client = buildClient({
    apiToken: ctx.currentUserAccessToken,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
    autoRetry: false,
    fetchFn: createCmaFetch(),
    // Our transport aborts each HTTP attempt. Keep the SDK from timing out a
    // queued request or backoff while its fetch promise is still running.
    requestTimeout: 2_147_483_647,
  });
  client.jobResultsFetcher = async (jobId) => {
    const result = await pollCmaJob(() => client.jobResults.find(jobId), jobId);
    if (result.status < 200 || result.status >= 300) {
      // Bulk jobs are not atomic. A final error response does not establish
      // that no record changed, even when its status is a validation 4xx.
      throw new JobPollingError(
        jobId,
        new Error(`The accepted batch job returned HTTP ${result.status}.`),
      );
    }
    return result;
  };
  return client;
}
