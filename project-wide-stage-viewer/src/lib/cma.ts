import {
  ApiError,
  buildClient,
  type Client,
  TimeoutError,
} from '@datocms/cma-client-browser';
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

/** A short, readable reason for a failed request, or null when there's none. */
export function describeError(error: unknown): string | null {
  if (error instanceof MissingAccessTokenError) {
    return error.message;
  }
  if (error instanceof ApiError) {
    const code = error.errors[0]?.attributes.code;
    return code
      ? `The API returned ${code}.`
      : `The API returned HTTP ${error.response.status}.`;
  }
  if (error instanceof TimeoutError) {
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
