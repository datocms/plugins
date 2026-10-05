import { describe, expect, it } from 'vitest';
import { buildCmaClient, MissingAccessTokenError } from './cma';

describe('CMA client configuration', () => {
  it('uses the current environment and endpoint', () => {
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
  });

  it('guards missing access tokens', () => {
    expect(() => buildCmaClient({ environment: 'sandbox' })).toThrow(
      MissingAccessTokenError,
    );
  });
});
