import { describe, expect, it } from 'vitest';
import { buildCmaClient, MissingAccessTokenError } from './cma';

describe('CMA client configuration', () => {
  it('preserves environment and endpoint and keeps automatic retries', () => {
    const client = buildCmaClient({
      currentUserAccessToken: 'test-token',
      environment: 'sandbox',
      cmaBaseUrl: 'https://example.test',
    });
    expect(client.config).toMatchObject({
      apiToken: 'test-token',
      environment: 'sandbox',
      baseUrl: 'https://example.test',
    });
    expect(client.config.autoRetry).not.toBe(false);
    expect(client.config.fetchFn).toBeUndefined();
  });

  it('guards missing access tokens', () => {
    expect(() => buildCmaClient({ environment: 'sandbox' })).toThrow(
      MissingAccessTokenError,
    );
  });
});
