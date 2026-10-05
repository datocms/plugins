import {
  ApiError,
  buildClient,
  type Client,
  TimeoutError,
} from '@datocms/cma-client-browser';
import {
  CmaRateLimitWaitError,
  CmaRequestTimeoutError,
  createCmaFetch,
  JobPollingError,
  pollCmaJob,
} from '../data/requests';
import type { Workflow } from '../types';

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

/**
 * A CMA client on the shared request transport (paced requests, rate-limit
 * waits, no retries of ambiguous mutations) that polls bulk jobs to the end.
 */
export function buildCmaClient(
  ctx: CmaClientContext,
  /** Cancels this client's queued, in-flight, and retried requests. */
  signal?: AbortSignal,
  options: { retryTimeouts?: boolean } = {},
): Client {
  if (!ctx.currentUserAccessToken) {
    throw new MissingAccessTokenError();
  }

  const transport = createCmaFetch(options);
  const client = buildClient({
    apiToken: ctx.currentUserAccessToken,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
    autoRetry: false,
    // The SDK passes no signal of its own, so attach the caller's.
    fetchFn: signal
      ? (input, init) => transport(input, { ...init, signal })
      : transport,
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

/** A short, readable reason for a failed request, or null when there's none. */
export function describeError(error: unknown): string | null {
  if (
    error instanceof MissingAccessTokenError ||
    error instanceof CmaRateLimitWaitError
  ) {
    return error.message;
  }
  if (error instanceof ApiError) {
    const code = error.errors[0]?.attributes.code;
    return code
      ? `The API returned ${code}.`
      : `The API returned HTTP ${error.response.status}.`;
  }
  if (
    error instanceof TimeoutError ||
    error instanceof CmaRequestTimeoutError
  ) {
    return 'The API took too long to respond.';
  }
  return null;
}

export async function fetchWorkflows(client: Client): Promise<Workflow[]> {
  const workflows = await client.workflows.list();
  return workflows
    .map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      stages: workflow.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
