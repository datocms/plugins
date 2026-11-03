import { describe, expect, it, vi } from 'vitest';
import { createVercelGatewayFetch } from './vercelGateway';

describe('createVercelGatewayFetch', () => {
  it('removes browser SDK headers the gateway preflight rejects', async () => {
    const fetchModels = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 200 }),
    );
    const gatewayFetch = createVercelGatewayFetch(fetchModels);

    await gatewayFetch('https://ai-gateway.vercel.sh/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer vck_example',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'x-stainless-lang': 'js',
        'X-Stainless-Package-Version': '0.0.0',
      },
    });

    const headers = new Headers(fetchModels.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer vck_example');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBeNull();
    expect(headers.get('x-stainless-lang')).toBeNull();
    expect(headers.get('x-stainless-package-version')).toBeNull();
  });
});
