import { describe, expect, it, vi } from 'vitest';
import type { CentraConnection } from '../src/types';
import {
  CentraClient,
  CentraClientError,
  redactCredentials,
  toDatoCorsProxyUrl,
} from '../src/lib/centraClient';

const connection: CentraConnection = {
  endpoint: 'https://store.example.test/store-dtc-api-no-session',
  token: 'top-secret-token',
};

const emptyDisplayItemsResponse = {
  data: {
    displayItems: {
      list: [],
      pagination: {
        hasPreviousPage: false,
        hasNextPage: false,
        nextPage: null,
        previousPage: null,
        currentPage: 1,
        lastPage: 1,
        limit: 20,
        total: 0,
      },
      userErrors: [],
    },
  },
};

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function requestBody(fetcher: ReturnType<typeof vi.fn>, index = 0) {
  const init = fetcher.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as {
    query: string;
    variables: Record<string, unknown>;
  };
}

const rawDisplayItem = {
  id: 25,
  name: 'Coat',
  productNumber: 'COAT-1',
  isPrimaryVariant: true,
  available: true,
  hasStock: true,
  productVariant: { id: 2, name: 'Blue', number: 'BLUE' },
  media: [
    {
      id: 3,
      altText: 'Blue coat',
      source: {
        url: 'https://images.example.test/coat.jpg',
        type: 'IMAGE',
        mediaSize: { name: 'large', maxWidth: 1200, maxHeight: 1600 },
      },
    },
  ],
  price: {
    value: '125.00',
    formattedValue: '€125.00',
    currency: { code: 'EUR' },
  },
  items: [
    {
      id: '25-1',
      sku: 'COAT-BLUE-S',
      GTIN: '0123456789012',
      name: 'Small',
      productSizeId: 10,
      preorder: false,
      stock: { available: true },
    },
  ],
};

describe('CentraClient transport and configuration', () => {
  it('uses the Dato CORS relay and bearer-only authentication', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse(emptyDisplayItemsResponse),
    );
    await new CentraClient(connection, {
      fetcher,
    }).searchDisplayItems({ kind: 'primaryProduct' });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      toDatoCorsProxyUrl(connection.endpoint),
    );
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/json',
    });
  });

  it('deduplicates identical in-flight GraphQL requests', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const client = new CentraClient(connection, { fetcher });
    const first = client.searchDisplayItems({ kind: 'primaryProduct' });
    const second = client.searchDisplayItems({ kind: 'primaryProduct' });

    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveResponse?.(jsonResponse(emptyDisplayItemsResponse));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { items: [], page: 1, hasMore: false, totalCount: 0 },
      { items: [], page: 1, hasMore: false, totalCount: 0 },
    ]);
  });

  it('supports caller cancellation and aborts the underlying request', async () => {
    let fetchSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          fetchSignal = init?.signal ?? undefined;
          fetchSignal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const controller = new AbortController();
    const promise = new CentraClient(connection, {
      fetcher,
    }).searchDisplayItems({
      kind: 'primaryProduct',
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchSignal?.aborted).toBe(true);
  });

  it('starts a fresh request instead of reusing an aborted in-flight entry', async () => {
    let call = 0;
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      call += 1;
      if (call === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }

      return Promise.resolve(
        jsonResponse(emptyDisplayItemsResponse),
      );
    });
    const client = new CentraClient(connection, { fetcher });
    const controller = new AbortController();
    const aborted = client.searchDisplayItems({
      kind: 'primaryProduct',
      signal: controller.signal,
    });

    controller.abort();
    const retried = client.searchDisplayItems({ kind: 'primaryProduct' });

    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    await expect(retried).resolves.toEqual({
      items: [],
      page: 1,
      hasMore: false,
      totalCount: 0,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('Centra catalog queries', () => {
  it('searches primary products with 1-based pagination', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: {
          displayItems: {
            list: [rawDisplayItem],
            pagination: {
              hasPreviousPage: true,
              hasNextPage: true,
              nextPage: 3,
              previousPage: 1,
              currentPage: 2,
              lastPage: 5,
              limit: 20,
              total: 82,
            },
            userErrors: [],
          },
        },
      }),
    );
    const result = await new CentraClient(connection, {
      fetcher,
    }).searchDisplayItems({
      query: 'coat',
      kind: 'primaryProduct',
      page: 2,
      limit: 20,
    });
    const body = requestBody(fetcher);

    expect(body.query).toContain('stock { available }');
    expect(body.query).not.toContain('quantity');
    expect(body.variables).toMatchObject({
      where: { search: 'coat', onlyPrimaryVariant: true },
      page: 2,
      limit: 20,
    });
    expect(body.variables).not.toHaveProperty('market');
    expect(body.variables).not.toHaveProperty('pricelist');
    expect(body.variables).not.toHaveProperty('languageCode');
    expect(result).toMatchObject({
      page: 2,
      hasMore: true,
      nextPage: 3,
      totalCount: 82,
      items: [
        {
          id: 25,
          media: [
            { source: { url: 'https://images.example.test/coat.jpg' } },
          ],
          price: { value: '125.00', formattedValue: '€125.00' },
          items: [{ id: '25-1', stock: { available: true } }],
        },
      ],
    });
  });

  it('merges normal and SIZE_NUMBER SKU searches and ranks exact SKU matches', async () => {
    const exact = {
      ...rawDisplayItem,
      id: 30,
      name: 'Exact',
      items: [{ ...rawDisplayItem.items[0], id: '30-1', sku: 'wanted' }],
    };
    const normal = { ...rawDisplayItem, id: 20, name: 'Normal' };
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        variables: { where: { searchInFields?: string[] } };
      };
      const sizeOnly = body.variables.where.searchInFields?.includes('SIZE_NUMBER');
      return jsonResponse({
        data: {
          displayItems: {
            list: sizeOnly ? [exact, normal] : [normal],
            pagination: {
              hasPreviousPage: false,
              hasNextPage: false,
              nextPage: null,
              previousPage: null,
              currentPage: 1,
              lastPage: 1,
              limit: 20,
              total: sizeOnly ? 2 : 1,
            },
            userErrors: [],
          },
        },
      });
    });
    const result = await new CentraClient(connection, {
      fetcher,
    }).searchItems({ query: 'WANTED' });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requestBody(fetcher, 1).variables).toMatchObject({
      where: { search: 'WANTED', searchInFields: ['SIZE_NUMBER'] },
    });
    expect(result.items.map(({ id }) => id)).toEqual([30, 20]);
    expect(result.totalCount).toBeUndefined();
  });

  it('treats a null SIZE_NUMBER list as an empty search result', async () => {
    const elina = {
      ...rawDisplayItem,
      id: 558,
      name: 'Elina_UK',
      productVariant: { id: 1, name: 'Black', number: 'ELINA1234561' },
      items: [
        { ...rawDisplayItem.items[0], id: '558-345', name: 'S' },
        { ...rawDisplayItem.items[0], id: '558-346', name: 'M' },
      ],
    };
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        variables: { where: { searchInFields?: string[] } };
      };
      const sizeOnly = body.variables.where.searchInFields?.includes('SIZE_NUMBER');
      return jsonResponse({
        data: {
          displayItems: {
            list: sizeOnly ? null : [elina],
            pagination: null,
            userErrors: [],
          },
        },
      });
    });

    const result = await new CentraClient(connection, {
      fetcher,
    }).searchItems({ query: 'Elina_UK' });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.items).toMatchObject([
      {
        id: 558,
        name: 'Elina_UK',
        productVariant: { name: 'Black' },
        items: [{ id: '558-345', name: 'S' }, { id: '558-346', name: 'M' }],
      },
    ]);
  });

  it('hydrates in saved order, detects primary drift, and preserves missing rows', async () => {
    const drifted = { ...rawDisplayItem, id: 2, isPrimaryVariant: false };
    const found = { ...rawDisplayItem, id: 1 };
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: {
          displayItems: {
            list: [found, drifted],
            pagination: {
              hasPreviousPage: false,
              hasNextPage: false,
              nextPage: null,
              previousPage: null,
              currentPage: 1,
              lastPage: 1,
              limit: 3,
              total: 2,
            },
            userErrors: [],
          },
        },
      }),
    );
    const result = await new CentraClient(connection, {
      fetcher,
    }).hydrateReferences({
      kind: 'primaryProduct',
      references: [
        { displayItemId: 2 },
        { displayItemId: 99 },
        { displayItemId: 1 },
      ],
    });

    expect(result).toMatchObject([
      { status: 'resolved', reference: { displayItemId: 2 }, primaryDrift: true },
      {
        status: 'unresolved',
        reference: { displayItemId: 99 },
        reason: 'displayItemNotFound',
      },
      { status: 'resolved', reference: { displayItemId: 1 }, primaryDrift: false },
    ]);
  });

  it('falls back to singular queries when an exact variant is absent from the batched response', async () => {
    const variant = { ...rawDisplayItem, id: 234, isPrimaryVariant: false };
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { query: string };

      if (body.query.includes('query CentraDisplayItem(')) {
        return jsonResponse({ data: { displayItem: variant } });
      }

      return jsonResponse({
        data: {
          displayItems: {
            list: [],
            pagination: {
              hasPreviousPage: false,
              hasNextPage: false,
              nextPage: null,
              previousPage: null,
              currentPage: 1,
              lastPage: 1,
              limit: 1,
              total: 0,
            },
            userErrors: [],
          },
        },
      });
    });

    const result = await new CentraClient(connection, {
      fetcher,
    }).hydrateReferences({
      kind: 'variant',
      references: [{ displayItemId: 234 }],
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject([
      {
        status: 'resolved',
        reference: { displayItemId: 234 },
        displayItem: { id: 234 },
      },
    ]);
  });

  it('hydrates exact item IDs and reports missing SKU items', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: {
          displayItems: {
            list: [rawDisplayItem],
            pagination: null,
            userErrors: [],
          },
        },
      }),
    );
    const result = await new CentraClient(connection, {
      fetcher,
    }).hydrateReferences({
      kind: 'item',
      references: [
        { displayItemId: 25, itemId: '25-1' },
        { displayItemId: 25, itemId: 'missing' },
      ],
    });

    expect(result).toMatchObject([
      { status: 'resolved', item: { id: '25-1' } },
      { status: 'unresolved', reason: 'itemNotFound' },
    ]);
  });
});

describe('Centra error handling', () => {
  it('redacts credentials in HTTP, GraphQL, and helper messages', async () => {
    const httpFetcher = vi.fn<typeof fetch>(async () =>
      new Response(`Bearer ${connection.token}`, { status: 401 }),
    );
    const httpPromise = new CentraClient(connection, {
      fetcher: httpFetcher,
    }).searchDisplayItems({ kind: 'primaryProduct' });
    await expect(httpPromise).rejects.toMatchObject({
      code: 'http',
      status: 401,
    });
    await expect(httpPromise).rejects.not.toThrow(connection.token);

    const graphqlFetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        errors: [{ message: `Invalid token ${connection.token}` }],
      }),
    );
    const graphqlPromise = new CentraClient(connection, {
      fetcher: graphqlFetcher,
    }).searchDisplayItems({ kind: 'primaryProduct' });
    await expect(graphqlPromise).rejects.toBeInstanceOf(CentraClientError);
    await expect(graphqlPromise).rejects.not.toThrow(connection.token);
    expect(redactCredentials(`Bearer ${connection.token}`, connection.token)).toBe(
      'Bearer [REDACTED]',
    );
  });

  it('surfaces display list user errors as GraphQL errors', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: {
          displayItems: {
            list: null,
            pagination: null,
            userErrors: [{ path: ['where'], message: 'Invalid filter' }],
          },
        },
      }),
    );
    await expect(
      new CentraClient(connection, { fetcher }).searchDisplayItems({
        kind: 'variant',
      }),
    ).rejects.toMatchObject({ code: 'graphql', message: 'Invalid filter' });
  });
});
