import { buildClient } from '@datocms/cma-client-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@/utils/cmaClient';

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: vi.fn(),
}));

describe('createApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no token is available', () => {
    expect(createApiClient(null, 'main')).toBeNull();
    expect(buildClient).not.toHaveBeenCalled();
  });

  it('passes the active environment to the CMA client', () => {
    const client = { items: {} };
    vi.mocked(buildClient).mockReturnValue(client as never);

    const result = createApiClient('token', 'staging', 'https://example.com');

    expect(result).toBe(client);
    expect(buildClient).toHaveBeenCalledWith({
      apiToken: 'token',
      environment: 'staging',
      baseUrl: 'https://example.com',
    });
  });
});
