import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPreviewLinks,
  getRecordPreviewLinks,
  loadWebPreviewFrontends,
  normalizePreviewFrontends,
  normalizeWebsiteBaseUrl,
  type PreviewFrontend,
  WEB_PREVIEWS_PACKAGE_NAME,
} from './previewLinks';

const cmaMocks = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  rawFindItem: vi.fn(),
  rawFindItemType: vi.fn(),
}));

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: () => ({
    plugins: { list: cmaMocks.listPlugins },
    items: { rawFind: cmaMocks.rawFindItem },
    itemTypes: { rawFind: cmaMocks.rawFindItemType },
  }),
}));

const production: PreviewFrontend = {
  name: 'Production',
  apiEndpointUrl: 'https://example.com/api/preview-links',
  customHeaders: [{ name: 'Authorization', value: 'Bearer secret' }],
};

const staging: PreviewFrontend = {
  name: 'Staging',
  apiEndpointUrl: 'https://staging.example.com/api/preview-links',
  customHeaders: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('normalizePreviewFrontends', () => {
  it('keeps complete HTTP endpoints and drops disabled or invalid ones', () => {
    expect(
      normalizePreviewFrontends([
        {
          name: ' Production ',
          apiEndpointUrl: 'https://example.com/api/preview-links',
          customHeaders: [
            { name: ' Authorization ', value: 'Bearer secret' },
            { name: '', value: 'ignored' },
          ],
        },
        {
          name: 'Disabled',
          apiEndpointUrl: 'https://example.com',
          disabled: true,
        },
        { name: 'Bad', apiEndpointUrl: 'javascript:alert(1)' },
        { name: '', apiEndpointUrl: 'https://example.com' },
      ]),
    ).toEqual([
      {
        name: 'Production',
        apiEndpointUrl: 'https://example.com/api/preview-links',
        customHeaders: [{ name: 'Authorization', value: 'Bearer secret' }],
      },
    ]);
  });
});

describe('normalizeWebsiteBaseUrl', () => {
  it('accepts an HTTP origin and rejects other values', () => {
    expect(normalizeWebsiteBaseUrl(' https://example.com/blog/ ')).toBe(
      'https://example.com/blog',
    );
    expect(normalizeWebsiteBaseUrl('ftp://example.com')).toBe('');
    expect(normalizeWebsiteBaseUrl('javascript:alert(1)')).toBe('');
    expect(normalizeWebsiteBaseUrl('not a url')).toBe('');
  });

  it('adds https:// to an address without a scheme', () => {
    expect(normalizeWebsiteBaseUrl('www.example.com')).toBe(
      'https://www.example.com',
    );
    expect(normalizeWebsiteBaseUrl('localhost:3000/')).toBe(
      'https://localhost:3000',
    );
  });
});

describe('loadWebPreviewFrontends', () => {
  it('reads enabled preview endpoints from the Web Previews plugin', async () => {
    const frontends = await loadWebPreviewFrontends({
      plugins: {
        list: vi.fn().mockResolvedValue([
          {
            package_name: 'something-else',
            parameters: {},
          },
          {
            package_name: WEB_PREVIEWS_PACKAGE_NAME,
            parameters: {
              frontends: [
                {
                  name: 'Production',
                  previewWebhook: 'https://example.com/api/preview-links',
                  customHeaders: [{ name: 'X-Token', value: 'secret' }],
                },
                {
                  name: 'Disabled',
                  disabled: true,
                  previewWebhook: 'https://example.com/disabled',
                },
                { name: 'No endpoint' },
              ],
            },
          },
        ]),
      },
    });

    expect(frontends).toEqual([
      {
        name: 'Production',
        apiEndpointUrl: 'https://example.com/api/preview-links',
        customHeaders: [{ name: 'X-Token', value: 'secret' }],
      },
    ]);
  });

  it('returns an empty list when Web Previews is not installed', async () => {
    await expect(
      loadWebPreviewFrontends({
        plugins: { list: vi.fn().mockResolvedValue([]) },
      }),
    ).resolves.toEqual([]);
  });
});

describe('fetchPreviewLinks', () => {
  it('returns links from every frontend and keeps a failed frontend separate', async () => {
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        if (String(url).includes('staging')) {
          return jsonResponse({ error: 'nope' }, 500);
        }
        return jsonResponse({
          previewLinks: [
            { label: 'Published', url: 'https://example.com/blog/post' },
          ],
        });
      },
    );

    await expect(
      fetchPreviewLinks({
        frontends: [production, staging],
        payload: { item: { id: 'item-1' } },
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toEqual({
      links: [
        {
          frontendName: 'Production',
          label: 'Published',
          url: 'https://example.com/blog/post',
        },
      ],
      errors: [
        {
          frontendName: 'Staging',
          message: 'The preview endpoint for "Staging" returned status 500.',
        },
      ],
    });

    const request = fetchImpl.mock.calls[0]?.[1];
    expect(request).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ item: { id: 'item-1' } }),
    });
    if (!request || !(request.headers instanceof Headers)) {
      throw new Error('Expected preview request headers.');
    }
    expect(request.headers.get('Authorization')).toBe('Bearer secret');
  });

  it('skips malformed links and keeps the valid ones', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        previewLinks: [
          { label: 'Bad', url: 'javascript:alert(1)' },
          { label: '', url: 'https://example.com/no-label' },
          'not a link',
          { label: 'Published', url: 'https://example.com/page' },
        ],
      }),
    );

    await expect(
      fetchPreviewLinks({
        frontends: [staging],
        payload: {},
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toEqual({
      links: [
        {
          frontendName: 'Staging',
          label: 'Published',
          url: 'https://example.com/page',
        },
      ],
      errors: [],
    });
  });

  it('rejects a payload without a link list', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ links: [] }));

    const result = await fetchPreviewLinks({
      frontends: [staging],
      payload: {},
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.links).toEqual([]);
    expect(result.errors[0]?.message).toContain('invalid payload');
  });

  it('removes secret query parameters and flags the draft link', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        previewLinks: [
          {
            label: 'Draft version',
            url: 'https://example.com/api/draft-mode/enable?url=%2Fblog%2Fpost&token=draft-secret',
          },
          { label: 'Published version', url: 'https://example.com/blog/post' },
        ],
      }),
    );

    const result = await fetchPreviewLinks({
      frontends: [staging],
      payload: {},
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(JSON.stringify(result)).not.toContain('draft-secret');
    expect(result.links).toEqual([
      {
        frontendName: 'Staging',
        label: 'Draft version',
        url: 'https://example.com/api/draft-mode/enable?url=%2Fblog%2Fpost',
        isDraftLink: true,
      },
      {
        frontendName: 'Staging',
        label: 'Published version',
        url: 'https://example.com/blog/post',
      },
    ]);
  });

  it('targets the loopback address space only for localhost endpoints', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ previewLinks: [] }),
    );

    await fetchPreviewLinks({
      frontends: [
        { ...staging, apiEndpointUrl: 'http://localhost:3000/api/preview' },
        staging,
      ],
      payload: {},
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      targetAddressSpace: 'loopback',
    });
    expect(fetchImpl.mock.calls[1]?.[1]).not.toHaveProperty(
      'targetAddressSpace',
    );
  });

  it('reports a timeout without failing the other frontends', async () => {
    const fetchImpl = vi.fn(
      (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes('staging')) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          });
        }
        return Promise.resolve(
          jsonResponse({
            previewLinks: [
              { label: 'Published', url: 'https://example.com/page' },
            ],
          }),
        );
      },
    );

    const result = await fetchPreviewLinks({
      frontends: [production, staging],
      payload: {},
      timeoutMs: 10,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.links).toEqual([
      {
        frontendName: 'Production',
        label: 'Published',
        url: 'https://example.com/page',
      },
    ]);
    expect(result.errors).toEqual([
      {
        frontendName: 'Staging',
        message: 'The preview endpoint for "Staging" timed out.',
      },
    ]);
  });
});

describe('getRecordPreviewLinks', () => {
  const host = {
    siteId: 'site',
    environment: 'main',
    locale: 'en',
    cmaBaseUrl: 'https://site-api.datocms.com',
    accessToken: 'token',
    currentUser: { id: 'user' },
    savedFrontends: [] as PreviewFrontend[],
    websiteBaseUrl: 'https://example.com',
  };

  beforeEach(() => {
    cmaMocks.listPlugins.mockReset();
    cmaMocks.rawFindItem.mockReset();
    cmaMocks.rawFindItemType.mockReset();
    cmaMocks.listPlugins.mockResolvedValue([]);
    cmaMocks.rawFindItem.mockResolvedValue({
      data: {
        id: 'item-1',
        attributes: { slug: { en: '/thanksgiving' } },
        relationships: { item_type: { data: { id: 'page' } } },
      },
    });
    cmaMocks.rawFindItemType.mockResolvedValue({
      data: { id: 'page', attributes: { api_key: 'page' } },
    });
  });

  it('builds a URL from the website address and slug when no frontend is configured', async () => {
    await expect(
      getRecordPreviewLinks(host, { itemId: 'item-1' }),
    ).resolves.toMatchObject({
      source: 'website_base_url',
      links: [{ label: 'Website', url: 'https://example.com/thanksgiving' }],
    });
    expect(cmaMocks.rawFindItemType).not.toHaveBeenCalled();
  });

  it('does not use another locale slug for the fallback URL', async () => {
    const result = await getRecordPreviewLinks(host, {
      itemId: 'item-1',
      locale: 'it',
    });

    expect(result).toMatchObject({
      source: 'unavailable',
      links: [],
      slug: null,
    });
    expect(result.message).toContain('no slug in locale "it"');
  });

  it('skips the slug fallback when an endpoint answers with no links', async () => {
    const fetchImpl = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ previewLinks: [] }));

    const result = await getRecordPreviewLinks(
      { ...host, savedFrontends: [production] },
      { itemId: 'item-1' },
    );

    expect(result).toMatchObject({ source: 'web_previews', links: [] });
    expect(result.message).toContain('returned no link');
    fetchImpl.mockRestore();
  });

  it('explains failed endpoints instead of a missing domain', async () => {
    const fetchImpl = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({}, 500));

    const result = await getRecordPreviewLinks(
      { ...host, websiteBaseUrl: '', savedFrontends: [production] },
      { itemId: 'item-1' },
    );

    expect(result).toMatchObject({ source: 'unavailable' });
    expect(result.message).toContain('preview endpoints failed');
    expect(result.message).not.toContain('No website domain');
    fetchImpl.mockRestore();
  });

  it('explains that endpoints were skipped without an access token', async () => {
    const result = await getRecordPreviewLinks(
      { ...host, accessToken: null, savedFrontends: [production] },
      { itemId: 'item-1' },
    );

    expect(result).toMatchObject({ source: 'unavailable' });
    expect(result.message).toContain('access token is unavailable');
  });

  it('uses the saved frontend copy when the live plugin list fails', async () => {
    cmaMocks.listPlugins.mockRejectedValue(new Error('forbidden'));
    const fetchImpl = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        previewLinks: [
          { label: 'Published', url: 'https://example.com/en/thanksgiving' },
        ],
      }),
    );

    await expect(
      getRecordPreviewLinks(
        {
          ...host,
          savedFrontends: [production],
        },
        { itemId: 'item-1', locale: 'en' },
      ),
    ).resolves.toMatchObject({
      source: 'web_previews',
      links: [
        {
          frontendName: 'Production',
          label: 'Published',
          url: 'https://example.com/en/thanksgiving',
        },
      ],
    });

    fetchImpl.mockRestore();
  });
});
