import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCmaClient, MissingAccessTokenError } from './cma';
import { JobPollingError } from '../data/requests';

describe('CMA client configuration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('preserves environment and endpoint while replacing automatic retries', () => {
    const client = buildCmaClient({
      currentUserAccessToken: 'test-token',
      environment: 'sandbox',
      cmaBaseUrl: 'https://example.test',
    });
    expect(client.config).toMatchObject({
      apiToken: 'test-token',
      environment: 'sandbox',
      baseUrl: 'https://example.test',
      autoRetry: false,
    });
    expect(client.config.fetchFn).toBeTypeOf('function');
    expect(client.jobResultsFetcher).toBeTypeOf('function');
  });

  it('guards missing access tokens', () => {
    expect(() => buildCmaClient({ environment: 'sandbox' })).toThrow(
      MissingAccessTokenError,
    );
  });

  it('posts a bulk job once while polling its result through the safe transport', async () => {
    vi.useFakeTimers();
    const methods: string[] = [];
    let polls = 0;
    const fetchFn = vi.fn<typeof fetch>(async (_, init) => {
      methods.push(init?.method ?? 'GET');
      const status = init?.method === 'POST' ? 202 : ++polls === 1 ? 404 : 200;
      const data =
        status === 202
          ? { type: 'job', id: 'job-1' }
          : status === 404
            ? []
            : {
                type: 'job_result',
                id: 'job-1',
                attributes: { status: 200, payload: { data: [] } },
              };
      return new Response(JSON.stringify({ data }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchFn);
    const client = buildCmaClient({
      currentUserAccessToken: 'test-token',
      environment: 'sandbox',
    });
    const result = client.request({
      method: 'POST',
      url: '/items/bulk-publish',
      body: { data: [] },
    });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ data: [] });
    expect(methods).toEqual(['POST', 'GET', 'GET']);
  });

  it('reports a failed accepted job as uncertain even when its final status is 422', async () => {
    vi.useFakeTimers();
    const methods: string[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (_, init) => {
      const post = init?.method === 'POST';
      methods.push(init?.method ?? 'GET');
      const data = post
        ? { type: 'job', id: 'job-partially-applied' }
        : {
            type: 'job_result',
            id: 'job-partially-applied',
            attributes: {
              status: 422,
              payload: { data: [] },
            },
          };
      return new Response(JSON.stringify({ data }), {
        status: post ? 202 : 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchFn);
    const client = buildCmaClient({
      currentUserAccessToken: 'test-token',
      environment: 'sandbox',
    });
    const result = client.request({
      method: 'POST',
      url: '/items/bulk-publish',
      body: { data: [] },
    });
    const assertion = expect(result).rejects.toMatchObject({
      code: 'MUTATION_OUTCOME_UNKNOWN',
      jobId: 'job-partially-applied',
      originalError: expect.objectContaining({
        message: expect.stringContaining('422'),
      }),
    });
    await vi.runAllTimersAsync();
    await assertion;
    await expect(result).rejects.toBeInstanceOf(JobPollingError);
    expect(methods).toEqual(['POST', 'GET']);
  });
});
