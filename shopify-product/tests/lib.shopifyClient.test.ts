import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_MAX_ENTRIES,
  NODE_CACHE_TTL_MS,
  SEARCH_CACHE_TTL_MS,
  SHOPIFY_STOREFRONT_API_VERSION,
} from '../src/constants';
import * as queries from '../src/lib/queries';
import {
  browseProductsQuery,
  filterValuesQuery,
  hydrateQuery,
  LEGACY_PRODUCT_FRAGMENT,
  productCardFragment,
  variantRowFragment,
} from '../src/lib/queries';
import {
  type ClientOptions,
  describeError,
  GENERIC_ERROR_MESSAGE,
  getShopifyClient,
  isAbortError,
  normalizeNode,
  onApiVersionWarning,
  redactCredentials,
  resetShopifyClients,
  SHOPIFY_ERROR_MESSAGES,
  ShopifyClient,
  ShopifyClientError,
  type ShopifyErrorCode,
} from '../src/lib/shopifyClient';
import type { ShopifyNode, StoreConnection } from '../src/types';
import accessDenied from './fixtures/storefront-access-denied.json';
import collectionProducts from './fixtures/storefront-collection-products.json';
import collectionsFixture from './fixtures/storefront-collections.json';
import connectionTestFixture from './fixtures/storefront-connection-test.json';
import contextFallback from './fixtures/storefront-context-fallback.json';
import filterValuesFixture from './fixtures/storefront-filter-values.json';
import filterValuesNoTags from './fixtures/storefront-filter-values-no-tags.json';
import filterValuesTagsDenied from './fixtures/storefront-filter-values-tags-denied.json';
import legacyByHandle from './fixtures/storefront-legacy-product-by-handle.json';
import legacyById from './fixtures/storefront-legacy-product-by-id.json';
import localizationFixture from './fixtures/storefront-localization.json';
import nodesMixed from './fixtures/storefront-nodes-mixed.json';
import probeInventory from './fixtures/storefront-probe-inventory.json';
import probeTags from './fixtures/storefront-probe-tags.json';
import probeTagsDenied from './fixtures/storefront-probe-tags-denied.json';
import productByHandle from './fixtures/storefront-product-by-handle.json';
import productVariants from './fixtures/storefront-product-variants.json';
import productsPage from './fixtures/storefront-products-page.json';
import shopNotFound from './fixtures/storefront-shop-not-found.json';
import skuMatchesFixture from './fixtures/storefront-sku-matches.json';
import skuPrefixMatches from './fixtures/storefront-sku-prefix-matches.json';
import storeLocked from './fixtures/storefront-store-locked.json';
import unauthorized from './fixtures/storefront-unauthorized.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN = 'top-secret-token-123';
const SHOP = 'datocms-demo.myshopify.com';
const ENDPOINT = `https://${SHOP}/api/${SHOPIFY_STOREFRONT_API_VERSION}/graphql.json`;

const PRODUCT_ID = 'gid://shopify/Product/10080752009562';
const VARIANT_ID = 'gid://shopify/ProductVariant/50698338337114';
const COLLECTION_ID = 'gid://shopify/Collection/645261099354';
const BOGUS_ID = 'gid://shopify/Product/1';

const STORE: StoreConnection = {
  shopDomain: SHOP,
  storefrontAccessToken: TOKEN,
  tokenless: false,
  capabilities: {
    tags: true,
    inventory: false,
    metafields: true,
    checkedAt: '2026-10-01T00:00:00.000Z',
  },
};

type Fixture = { status: number; apiVersion: string | null; body: unknown };

type GraphqlRequest = {
  query: string;
  variables: Record<string, unknown>;
};

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(
  body: unknown,
  init: { status?: number; apiVersion?: string | null } = {},
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiVersion =
    init.apiVersion === undefined
      ? SHOPIFY_STOREFRONT_API_VERSION
      : init.apiVersion;
  if (apiVersion) {
    headers['X-Shopify-API-Version'] = apiVersion;
  }
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
}

function fixtureResponse(fixture: Fixture): Response {
  return jsonResponse(fixture.body, {
    status: fixture.status,
    apiVersion: fixture.apiVersion,
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

function parseRequest(init?: RequestInit): GraphqlRequest {
  return JSON.parse(String(init?.body)) as GraphqlRequest;
}

function operationName(query: string): string {
  return /^query (\w+)/.exec(query)?.[1] ?? '';
}

function requestAt(fetchMock: FetchMock, index = 0): GraphqlRequest {
  return parseRequest(fetchMock.mock.calls[index]?.[1]);
}

function headersAt(fetchMock: FetchMock, index = 0): Record<string, string> {
  return (fetchMock.mock.calls[index]?.[1]?.headers ?? {}) as Record<
    string,
    string
  >;
}

function signalAt(fetchMock: FetchMock, index = 0): AbortSignal | undefined {
  return fetchMock.mock.calls[index]?.[1]?.signal ?? undefined;
}

/** Answers each request from a fixture or handler picked by operation name. */
function routeFetch(
  routes: Record<string, Fixture | ((request: GraphqlRequest) => Response)>,
): FetchMock {
  return vi.fn<typeof fetch>(async (_input, init) => {
    const request = parseRequest(init);
    const route = routes[operationName(request.query)];
    if (!route) {
      throw new Error(`Unexpected operation ${operationName(request.query)}`);
    }
    return typeof route === 'function'
      ? route(request)
      : fixtureResponse(route);
  });
}

function makeClient(
  fetchImpl: FetchMock,
  overrides: Partial<ClientOptions> = {},
): ShopifyClient {
  return new ShopifyClient({
    store: STORE,
    fetchImpl,
    storage: null,
    sleep: async () => undefined,
    random: () => 0,
    ...overrides,
  });
}

const productTemplate = productsPage.body.data.products.nodes[0];

/** A Hydrate response with one product per requested ID, in order. */
function syntheticNodes(request: GraphqlRequest): Response {
  const ids = request.variables.ids as string[];
  return jsonResponse({
    data: { nodes: ids.map((id) => ({ ...productTemplate, id })) },
  });
}

const recordedNodes = new Map<string, unknown>();
for (const node of nodesMixed.body.data.nodes) {
  if (node) {
    recordedNodes.set(node.id, node);
  }
}

/** A Hydrate response built from the recorded nodes, `null` for unknown IDs. */
function recordedHydrate(request: GraphqlRequest): Response {
  const ids = request.variables.ids as string[];
  return jsonResponse({
    data: { nodes: ids.map((id) => recordedNodes.get(id) ?? null) },
  });
}

function deferredFetch(): {
  fetchImpl: FetchMock;
  respond: (response: Response) => void;
} {
  const pending: Array<(response: Response) => void> = [];
  const fetchImpl = vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((resolve, reject) => {
        pending.push(resolve);
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
  );
  return {
    fetchImpl,
    respond: (response) => {
      for (const resolve of pending.splice(0)) {
        resolve(response);
      }
    },
  };
}

const CACHE_STORAGE_PREFIX = 'datocms-plugin-shopify-product:cache:';

function productIds(count: number, start: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `gid://shopify/Product/${start + index}`,
  );
}

function storageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) {
      keys.push(key);
    }
  }
  return keys;
}

/** Node IDs held in the persistent cache, across every scope. */
function storedNodeIds(storage: Storage): string[] {
  return storageKeys(storage)
    .filter((key) => key.startsWith(CACHE_STORAGE_PREFIX))
    .map((key) => key.split('|node|')[1])
    .filter((id): id is string => id !== undefined);
}

/** A Map-backed Storage that throws QuotaExceededError past `limit` items. */
function limitedStorage(limit: number): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      if (!items.has(key) && items.size >= limit) {
        throw new DOMException(
          'The quota has been exceeded.',
          'QuotaExceededError',
        );
      }
      items.set(key, String(value));
    },
  };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject.');
}

beforeEach(() => {
  resetShopifyClients();
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Every capability combination a document can be built for. */
const FEATURE_SETS: queries.QueryFeatures[] = [
  queries.BASE_FEATURES,
  { inventory: true, tags: false },
  { inventory: false, tags: true },
  { inventory: true, tags: true },
];

function exportedDocuments(): string[] {
  const values: unknown[] = Object.values(queries);
  return values.filter((value): value is string => typeof value === 'string');
}

describe('queries', () => {
  it('requests inventory fields only with the inventory capability', () => {
    expect(productCardFragment({ inventory: false })).not.toContain(
      'totalInventory',
    );
    expect(productCardFragment({ inventory: true })).toContain(
      'totalInventory',
    );
    expect(variantRowFragment({ inventory: false })).not.toContain(
      'quantityAvailable',
    );
    expect(variantRowFragment({ inventory: true })).toContain(
      'quantityAvailable',
    );
    expect(hydrateQuery({ inventory: false, tags: true })).not.toMatch(
      /totalInventory|quantityAvailable/,
    );
  });

  it('requests productTags only with the tags capability', () => {
    expect(filterValuesQuery({ tags: false })).not.toContain('productTags');
    expect(filterValuesQuery({ tags: true })).toContain(
      'productTags(first: 250)',
    );
  });

  it('uses no deprecated fields and puts @inContext on priced queries', () => {
    const builtPricedQueries = FEATURE_SETS.flatMap((features) => [
      queries.hydrateQuery(features),
      queries.browseProductsQuery(features),
      queries.browseCollectionProductsQuery(features),
      queries.productVariantsQuery(features),
      queries.productByHandleQuery(features),
      queries.skuMatchesQuery(features),
    ]);
    const documents = [
      ...exportedDocuments(),
      ...builtPricedQueries,
      ...FEATURE_SETS.map((features) => queries.filterValuesQuery(features)),
    ];
    for (const document of documents) {
      expect(document).not.toContain('productByHandle');
      expect(document).not.toContain('transformedSrc');
      expect(document).not.toMatch(/\bsrc\b(?!:)/);
    }
    expect(LEGACY_PRODUCT_FRAGMENT).toContain('src: url');
    expect(LEGACY_PRODUCT_FRAGMENT).toContain(
      'previewSrc: url(transform: { maxWidth: 200, maxHeight: 200 })',
    );
    for (const document of [
      ...builtPricedQueries,
      queries.COLLECTION_BY_HANDLE_QUERY,
      queries.COLLECTIONS_QUERY,
      queries.LEGACY_PRODUCT_BY_ID_QUERY,
      queries.LEGACY_PRODUCT_BY_HANDLE_QUERY,
      queries.LOCALIZATION_QUERY,
    ]) {
      expect(document).toContain(
        '@inContext(country: $country, language: $language)',
      );
    }
  });

  it('keeps no metafields probe: the Storefront API has no scope to detect', () => {
    expect(
      exportedDocuments().some((document) => document.includes('metafield')),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

describe('transport', () => {
  it('posts to the pinned API version with the public token header only', async () => {
    const fetchImpl = routeFetch({ Hydrate: nodesMixed });
    await makeClient(fetchImpl).loadNode(PRODUCT_ID);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(ENDPOINT);
    expect(ENDPOINT).toContain('/api/2026-10/graphql.json');
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(headersAt(fetchImpl)).toEqual({
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': TOKEN,
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('cors-proxy');
  });

  it('sends no token header for tokenless stores', async () => {
    const fetchImpl = routeFetch({ Hydrate: nodesMixed });
    await makeClient(fetchImpl, {
      store: { shopDomain: SHOP, storefrontAccessToken: '', tokenless: true },
    }).loadNode(PRODUCT_ID);

    expect(headersAt(fetchImpl)).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('passes null context variables by default and the market when set', async () => {
    const fetchImpl = routeFetch({ BrowseProducts: productsPage });
    const client = makeClient(fetchImpl);
    await client.browseProducts({ first: 5 });
    await client.withContext({ country: 'ca', language: 'fr' }).browseProducts({
      first: 5,
    });
    await makeClient(fetchImpl, {
      store: { ...STORE, defaultCountry: 'US', defaultLanguage: 'EN' },
    }).browseProducts({ first: 5 });

    expect(requestAt(fetchImpl, 0).variables).toMatchObject({
      country: null,
      language: null,
    });
    expect(requestAt(fetchImpl, 0).query).toContain(
      '@inContext(country: $country, language: $language)',
    );
    expect(requestAt(fetchImpl, 1).variables).toMatchObject({
      country: 'CA',
      language: 'FR',
    });
    expect(requestAt(fetchImpl, 2).variables).toMatchObject({
      country: 'US',
      language: 'EN',
    });
  });

  it('dedupes identical in-flight requests', async () => {
    const { fetchImpl, respond } = deferredFetch();
    const client = makeClient(fetchImpl);
    const first = client.browseProducts({ first: 5 });
    const second = client.browseProducts({ first: 5 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    respond(fixtureResponse(productsPage));

    const [a, b] = await Promise.all([first, second]);
    expect(a.nodes).toHaveLength(5);
    expect(b).toEqual(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh request instead of joining an aborted one', async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      call += 1;
      if (call === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      return Promise.resolve(fixtureResponse(productsPage));
    });
    const client = makeClient(fetchImpl);
    const controller = new AbortController();
    const aborted = client.browseProducts(
      { first: 5 },
      { signal: controller.signal },
    );
    controller.abort();
    const retried = client.browseProducts({ first: 5 });

    await expect(aborted).rejects.toMatchObject({ code: 'aborted' });
    await expect(retried).resolves.toMatchObject({
      pageInfo: { hasNextPage: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

describe('loadNodes', () => {
  it('returns nodes in input order with null for unresolved IDs', async () => {
    const fetchImpl = routeFetch({ Hydrate: nodesMixed });
    const client = makeClient(fetchImpl);
    const nodes = await client.loadNodes([
      PRODUCT_ID,
      VARIANT_ID,
      COLLECTION_ID,
      BOGUS_ID,
    ]);

    expect(nodes.map((node) => node?.__typename ?? null)).toEqual([
      'Product',
      'ProductVariant',
      'Collection',
      null,
    ]);
    expect(nodes[0]).toMatchObject({
      id: PRODUCT_ID,
      handle: 'the-complete-snowboard',
      priceRange: {
        minVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
      },
      variantsCount: { count: 5 },
    });
    expect(nodes[0]).not.toHaveProperty('totalInventory');
    expect(nodes[1]).toMatchObject({
      sku: 'sku-managed-1',
      product: { handle: 'the-multi-managed-snowboard', onlineStoreUrl: null },
    });
    expect(requestAt(fetchImpl).variables.ids).toEqual([
      PRODUCT_ID,
      VARIANT_ID,
      COLLECTION_ID,
      BOGUS_ID,
    ]);
  });

  it('keeps duplicates in place and serves resolved nodes from the cache', async () => {
    const fetchImpl = routeFetch({ Hydrate: nodesMixed });
    const client = makeClient(fetchImpl);
    const first = await client.loadNodes([PRODUCT_ID, PRODUCT_ID]);
    const again = await client.loadNode(PRODUCT_ID);

    expect(first[0]?.id).toBe(PRODUCT_ID);
    expect(first[1]?.id).toBe(PRODUCT_ID);
    expect(again?.id).toBe(PRODUCT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestAt(fetchImpl).variables.ids).toEqual([PRODUCT_ID]);
  });

  it('accepts base64 IDs from old 1.x values', async () => {
    const fetchImpl = routeFetch({ Hydrate: recordedHydrate });
    const [node] = await makeClient(fetchImpl).loadNodes([btoa(PRODUCT_ID)]);
    expect(node?.id).toBe(PRODUCT_ID);
    expect(requestAt(fetchImpl).variables.ids).toEqual([PRODUCT_ID]);
  });

  it('returns null for nodes of other types and never requests non-GIDs', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: {
          nodes: [{ ...productTemplate, __typename: 'Metaobject' }],
        },
      }),
    );
    const client = makeClient(fetchImpl);
    const nodes = await client.loadNodes([
      'gid://shopify/Product/42',
      'the-complete-snowboard',
      'gid://shopify/Metaobject/7',
    ]);

    expect(nodes).toEqual([null, null, null]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestAt(fetchImpl).variables.ids).toEqual([
      'gid://shopify/Product/42',
    ]);
  });

  it('batches loadNode calls made in the same tick into one request', async () => {
    const fetchImpl = routeFetch({ Hydrate: syntheticNodes });
    const client = makeClient(fetchImpl);
    const ids = Array.from(
      { length: 30 },
      (_, index) => `gid://shopify/Product/${100 + index}`,
    );
    const nodes = await Promise.all(ids.map((id) => client.loadNode(id)));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestAt(fetchImpl).variables.ids).toEqual(ids);
    expect(nodes.map((node) => node?.id)).toEqual(ids);
  });

  it('splits more than 250 IDs into chunks and keeps the input order', async () => {
    const fetchImpl = routeFetch({ Hydrate: syntheticNodes });
    const ids = Array.from(
      { length: 600 },
      (_, index) => `gid://shopify/Product/${1000 + index}`,
    );
    const nodes = await makeClient(fetchImpl).loadNodes([...ids].reverse());

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(
      fetchImpl.mock.calls.map(
        (_call, index) =>
          (requestAt(fetchImpl, index).variables.ids as string[]).length,
      ),
    ).toEqual([250, 250, 100]);
    expect(nodes.map((node) => node?.id)).toEqual([...ids].reverse());
  });

  it('lets one caller abort without breaking another caller in the same batch', async () => {
    const { fetchImpl, respond } = deferredFetch();
    const client = makeClient(fetchImpl);
    const controller = new AbortController();
    const aborted = client.loadNode(PRODUCT_ID, { signal: controller.signal });
    const kept = client.loadNode(VARIANT_ID);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();

    const abortError = await captureError(aborted);
    expect(isAbortError(abortError)).toBe(true);
    expect(abortError).toMatchObject({ code: 'aborted', name: 'AbortError' });
    expect(signalAt(fetchImpl)?.aborted).toBe(false);

    respond(fixtureResponse(nodesMixed));
    await expect(kept).resolves.toMatchObject({ id: VARIANT_ID });
  });

  it('keeps the batch when a caller aborts before it is sent', async () => {
    const fetchImpl = routeFetch({ Hydrate: recordedHydrate });
    const client = makeClient(fetchImpl);
    const controller = new AbortController();
    const aborted = client.loadNode(PRODUCT_ID, { signal: controller.signal });
    const kept = client.loadNode(COLLECTION_ID);
    controller.abort();

    await expect(aborted).rejects.toMatchObject({ code: 'aborted' });
    await expect(kept).resolves.toMatchObject({ id: COLLECTION_ID });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('aborts the request once every caller has aborted', async () => {
    const { fetchImpl } = deferredFetch();
    const client = makeClient(fetchImpl);
    const controller = new AbortController();
    const pending = client.loadNodes([PRODUCT_ID, VARIANT_ID], {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(signalAt(fetchImpl)?.aborted).toBe(true);
  });

  it('rejects immediately for an already aborted signal', async () => {
    const fetchImpl = routeFetch({ Hydrate: nodesMixed });
    const controller = new AbortController();
    controller.abort();
    await expect(
      makeClient(fetchImpl).loadNode(PRODUCT_ID, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns ACCESS_DENIED partial data and stops requesting inventory', async () => {
    const fetchImpl = routeFetch({
      Hydrate: (request) =>
        request.query.includes('totalInventory')
          ? fixtureResponse(accessDenied)
          : recordedHydrate(request),
    });
    const client = makeClient(fetchImpl, {
      store: {
        ...STORE,
        capabilities: {
          tags: true,
          inventory: true,
          metafields: true,
          checkedAt: '2026-10-01T00:00:00.000Z',
        },
      },
    });
    expect(client.effectiveCapabilities().inventory).toBe(true);

    const nodes = await client.loadNodes([PRODUCT_ID, VARIANT_ID]);
    expect(requestAt(fetchImpl, 0).query).toContain('totalInventory');
    expect(requestAt(fetchImpl, 0).query).toContain('quantityAvailable');
    expect(nodes[0]).toMatchObject({ id: PRODUCT_ID, totalInventory: null });
    expect(nodes[1]).toMatchObject({ id: VARIANT_ID, quantityAvailable: null });
    expect(client.effectiveCapabilities()).toEqual({
      tags: true,
      inventory: false,
      metafields: true,
    });

    await client.loadNode(COLLECTION_ID);
    expect(requestAt(fetchImpl, 1).query).not.toMatch(
      /totalInventory|quantityAvailable/,
    );
  });
});

// ---------------------------------------------------------------------------
// Retries and errors
// ---------------------------------------------------------------------------

const THROTTLED_BODY = {
  errors: [
    {
      message: 'Throttled',
      extensions: {
        code: 'THROTTLED',
        documentation: 'https://shopify.dev/api/usage/rate-limits',
      },
    },
  ],
};

describe('throttling', () => {
  it('retries THROTTLED with exponential backoff and jitter, then succeeds', async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;
      return call <= 2
        ? jsonResponse(THROTTLED_BODY)
        : fixtureResponse(productsPage);
    });
    const sleep = vi.fn(async (_ms: number) => undefined);
    const page = await makeClient(fetchImpl, {
      sleep,
      random: () => 0.5,
    }).browseProducts({ first: 5 });

    expect(page.nodes).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([750, 1250]);
  });

  it('gives up after three retries with the throttled error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(THROTTLED_BODY),
    );
    const sleep = vi.fn(async (_ms: number) => undefined);
    const error = await captureError(
      makeClient(fetchImpl, { sleep }).browseProducts({ first: 5 }),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000]);
    expect(error).toBeInstanceOf(ShopifyClientError);
    expect(error).toMatchObject({
      code: 'throttled',
      userMessage: 'Shopify is rate-limiting requests. Try again shortly.',
    });
  });

  it('retries HTTP 429 too', async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;
      return call === 1
        ? textResponse('Too Many Requests', 429)
        : fixtureResponse(productsPage);
    });
    await makeClient(fetchImpl).browseProducts({ first: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops waiting when the caller aborts during the backoff', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(THROTTLED_BODY),
    );
    const controller = new AbortController();
    const sleep = vi.fn(
      (_ms: number) =>
        new Promise<void>(() => {
          controller.abort();
        }),
    );
    await expect(
      makeClient(fetchImpl, { sleep }).browseProducts(
        { first: 5 },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

type ErrorCase = {
  name: string;
  respond: () => Response | Promise<Response>;
  code: ShopifyErrorCode;
  status: number | null;
  userMessage: string;
  tokenless?: boolean;
  /** Requests sent; a failed POST adds the shop lookup GET. Default 1. */
  requests?: number;
};

const ERROR_CASES: ErrorCase[] = [
  {
    name: 'HTTP 401',
    respond: () => fixtureResponse(unauthorized),
    code: 'unauthorized',
    status: 401,
    userMessage:
      'Shopify rejected the Storefront access token. Update it in the plugin settings.',
  },
  {
    name: 'HTTP 403',
    respond: () =>
      jsonResponse(
        { errors: [{ message: '', extensions: { code: 'FORBIDDEN' } }] },
        { status: 403 },
      ),
    code: 'forbidden',
    status: 403,
    userMessage: SHOPIFY_ERROR_MESSAGES.forbidden,
  },
  {
    name: 'HTTP 404',
    respond: () => fixtureResponse(shopNotFound),
    code: 'shop-not-found',
    status: 404,
    userMessage: `No Shopify store found at ${SHOP}.`,
  },
  {
    name: 'HTTP 400 Online Store channel is locked',
    respond: () => fixtureResponse(storeLocked),
    code: 'store-locked',
    status: 400,
    userMessage:
      'This store is password-protected, so the plugin needs a Storefront access token.',
    tokenless: true,
  },
  {
    name: 'HTTP 402',
    respond: () => textResponse('Payment Required', 402),
    code: 'shop-unavailable',
    status: 402,
    userMessage: 'This Shopify store is frozen or locked.',
  },
  {
    name: 'HTTP 423',
    respond: () => textResponse('Locked', 423),
    code: 'shop-unavailable',
    status: 423,
    userMessage: 'This Shopify store is frozen or locked.',
  },
  {
    name: 'HTTP 430',
    respond: () => textResponse('Shopify Security Rejection', 430),
    code: 'security-rejection',
    status: 430,
    userMessage:
      'Shopify temporarily blocked these requests. Wait a minute and try again.',
  },
  {
    name: 'a GraphQL error',
    respond: () =>
      jsonResponse({
        errors: [
          { message: "Field 'nope' doesn't exist on type 'Product'" },
          { message: 'Second error' },
        ],
      }),
    code: 'graphql',
    status: null,
    userMessage: "Field 'nope' doesn't exist on type 'Product'",
  },
  {
    name: 'a fetch TypeError',
    respond: () => Promise.reject(new TypeError('Failed to fetch')),
    code: 'network',
    status: null,
    userMessage: "Couldn't reach Shopify. Check your connection or ad-blocker.",
    requests: 2,
  },
  {
    name: 'a non-JSON body',
    respond: () => textResponse('<html>Oops</html>', 200),
    code: 'invalid-response',
    status: null,
    userMessage: SHOPIFY_ERROR_MESSAGES['invalid-response'],
  },
  {
    name: 'a body without data',
    respond: () => jsonResponse({ extensions: {} }),
    code: 'invalid-response',
    status: null,
    userMessage: SHOPIFY_ERROR_MESSAGES['invalid-response'],
  },
  {
    name: 'HTTP 500',
    respond: () => textResponse('Internal Server Error', 500),
    code: 'invalid-response',
    status: 500,
    userMessage: SHOPIFY_ERROR_MESSAGES['invalid-response'],
  },
  {
    name: 'ACCESS_DENIED on a non-optional field',
    respond: () =>
      jsonResponse({
        errors: [
          {
            message: 'Access denied for products field.',
            path: ['products'],
            extensions: { code: 'ACCESS_DENIED' },
          },
        ],
        data: { products: null },
      }),
    code: 'forbidden',
    status: null,
    userMessage: SHOPIFY_ERROR_MESSAGES.forbidden,
  },
  {
    // The shape Shopify really sends for a denied non-null root field.
    name: 'ACCESS_DENIED on a non-optional field that nulls the response',
    respond: () =>
      jsonResponse({
        errors: [
          {
            message: 'Access denied for products field.',
            path: ['products'],
            extensions: { code: 'ACCESS_DENIED' },
          },
        ],
        data: null,
      }),
    code: 'forbidden',
    status: null,
    userMessage: SHOPIFY_ERROR_MESSAGES.forbidden,
  },
];

describe('error mapping', () => {
  it.each(ERROR_CASES)('maps $name to $code', async (errorCase) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => errorCase.respond());
    const store: StoreConnection = errorCase.tokenless
      ? { shopDomain: SHOP, storefrontAccessToken: '', tokenless: true }
      : STORE;
    const error = await captureError(
      makeClient(fetchImpl, { store }).browseProducts({ first: 5 }),
    );

    expect(error).toBeInstanceOf(ShopifyClientError);
    expect(error).toMatchObject({
      code: errorCase.code,
      status: errorCase.status,
      userMessage: errorCase.userMessage,
    });
    expect(describeError(error)).toBe(errorCase.userMessage);
    expect(fetchImpl).toHaveBeenCalledTimes(errorCase.requests ?? 1);
  });

  it('rejects invalid shop domains without a request', async () => {
    const fetchImpl = routeFetch({});
    const error = await captureError(
      makeClient(fetchImpl, {
        store: { ...STORE, shopDomain: 'https://evil.example/path' },
      }).browseProducts({ first: 5 }),
    );
    expect(error).toMatchObject({ code: 'shop-not-found' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never puts the token in messages', async () => {
    const leaks: Array<() => Response | Promise<Response>> = [
      () => textResponse(`upstream echoed ${TOKEN}`, 500),
      () => jsonResponse({ errors: [{ message: `Bad token ${TOKEN}` }] }),
      () =>
        jsonResponse(
          { errors: [{ message: `Rejected ${TOKEN}` }] },
          { status: 400 },
        ),
      () => Promise.reject(new TypeError(`Failed to fetch with ${TOKEN}`)),
      () => textResponse(`X-Shopify-Storefront-Access-Token: ${TOKEN}`, 401),
    ];
    const errors = await Promise.all(
      leaks.map((leak) =>
        captureError(
          makeClient(vi.fn<typeof fetch>(async () => leak())).browseProducts({
            first: 5,
          }),
        ),
      ),
    );
    for (const error of errors) {
      expect(error).toBeInstanceOf(ShopifyClientError);
      if (error instanceof ShopifyClientError) {
        expect(error.message).not.toContain(TOKEN);
        expect(error.userMessage).not.toContain(TOKEN);
        expect(String(error)).not.toContain(TOKEN);
      }
    }
  });
});

/**
 * In a browser the JSON POST is preflighted, and Shopify answers the
 * preflight for an unknown shop with a 404, so `fetch` rejects with a bare
 * TypeError. These mocks reproduce that: the POST rejects and the header-less
 * GET gets the real answer.
 */
function unreachableFetch(
  lookup: () => Response | Promise<Response>,
): FetchMock {
  return vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === 'POST') {
      throw new TypeError('Failed to fetch');
    }
    return lookup();
  });
}

describe('unreachable shops', () => {
  const missingShop = 'nonexistent-shop-zz9-plural.myshopify.com';
  const missingStore: StoreConnection = {
    shopDomain: missingShop,
    storefrontAccessToken: TOKEN,
    tokenless: false,
  };

  it('reports a wrong shop domain when the preflight fails and a plain GET reads 404', async () => {
    const fetchImpl = unreachableFetch(() => textResponse('Not Found', 404));
    const error = await captureError(
      makeClient(fetchImpl, { store: missingStore }).browseProducts({
        first: 5,
      }),
    );

    expect(error).toBeInstanceOf(ShopifyClientError);
    expect(error).toMatchObject({
      code: 'shop-not-found',
      status: 404,
      userMessage: `No Shopify store found at ${missingShop}.`,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1] ?? [];
    expect(url).toBe(
      `https://${missingShop}/api/${SHOPIFY_STOREFRONT_API_VERSION}/graphql.json?query=%7Bshop%7Bname%7D%7D`,
    );
    // A simple request: no custom headers (so no preflight) and no token.
    expect(init?.method).toBe('GET');
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeUndefined();
    expect(String(url)).not.toContain(TOKEN);
  });

  it('reports a frozen or locked shop the same way', async () => {
    const statuses = [402, 423];
    const errors = await Promise.all(
      statuses.map((status) =>
        captureError(
          makeClient(
            unreachableFetch(() => textResponse('Unavailable', status)),
          ).browseProducts({ first: 5 }),
        ),
      ),
    );
    for (const [index, status] of statuses.entries()) {
      expect(errors[index]).toMatchObject({ code: 'shop-unavailable', status });
    }
  });

  it('keeps the network message when the shop answers the lookup', async () => {
    // A live shop answers the token-less GET with 400 or 401; the POST
    // failed for another reason (offline, ad-blocker, CORS).
    const answers = [
      () => fixtureResponse(storeLocked),
      () => fixtureResponse(unauthorized),
      () => jsonResponse({ data: { shop: { name: 'DatoCMS Demo' } } }),
      () => textResponse('Internal Server Error', 500),
    ];
    const errors = await Promise.all(
      answers.map((answer) =>
        captureError(
          makeClient(unreachableFetch(answer)).browseProducts({ first: 5 }),
        ),
      ),
    );
    for (const error of errors) {
      expect(error).toMatchObject({
        code: 'network',
        status: null,
        userMessage: SHOPIFY_ERROR_MESSAGES.network,
      });
    }
  });

  it('keeps the network message when the lookup fails too', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await captureError(
      makeClient(fetchImpl).browseProducts({ first: 5 }),
    );
    expect(error).toMatchObject({ code: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not look the shop up after an abort', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      controller.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    const error = await captureError(
      makeClient(fetchImpl).browseProducts(
        { first: 5 },
        { signal: controller.signal },
      ),
    );
    expect(isAbortError(error)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports an abort that lands during the lookup as an abort', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') {
        throw new TypeError('Failed to fetch');
      }
      controller.abort();
      return textResponse('Not Found', 404);
    });
    const error = await captureError(
      makeClient(fetchImpl).browseProducts(
        { first: 5 },
        { signal: controller.signal },
      ),
    );
    expect(isAbortError(error)).toBe(true);
  });
});

describe('error helpers', () => {
  it('redacts tokens, credential headers and Admin API tokens', () => {
    expect(redactCredentials(`token ${TOKEN} here`, TOKEN)).toBe(
      'token [REDACTED] here',
    );
    expect(
      redactCredentials('X-Shopify-Storefront-Access-Token: abc123def'),
    ).toBe('X-Shopify-Storefront-Access-Token: [REDACTED]');
    expect(redactCredentials('{"storefrontAccessToken":"abc123"}')).toBe(
      '{"storefrontAccessToken":"[REDACTED]"}',
    );
    expect(redactCredentials('Shopify-Storefront-Private-Token=xyz')).toBe(
      'Shopify-Storefront-Private-Token=[REDACTED]',
    );
    expect(redactCredentials('pasted shpat_0123abcd by mistake')).toBe(
      'pasted [REDACTED] by mistake',
    );
    expect(redactCredentials('Authorization: Bearer abc.def')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
    expect(redactCredentials('nothing to hide')).toBe('nothing to hide');
  });

  it('describes any error for editors', () => {
    expect(
      describeError(
        new ShopifyClientError('shop-not-found', 'x', {
          shop: 'acme.myshopify.com',
        }),
      ),
    ).toBe('No Shopify store found at acme.myshopify.com.');
    expect(describeError(new Error('boom'))).toBe(GENERIC_ERROR_MESSAGE);
    expect(describeError('boom')).toBe(
      'Something went wrong while talking to Shopify.',
    );
    expect(describeError(new DOMException('x', 'AbortError'))).toBe(
      SHOPIFY_ERROR_MESSAGES.aborted,
    );
  });

  it('recognises aborts', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError(new ShopifyClientError('aborted', 'x'))).toBe(true);
    expect(isAbortError(new ShopifyClientError('network', 'x'))).toBe(false);
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

describe('cache', () => {
  it('expires searches after SEARCH_CACHE_TTL_MS', async () => {
    let time = 1_000_000;
    const fetchImpl = routeFetch({ BrowseProducts: productsPage });
    const client = makeClient(fetchImpl, { now: () => time });
    await client.browseProducts({ first: 5 });
    time += SEARCH_CACHE_TTL_MS - 1;
    await client.browseProducts({ first: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    time += 2;
    await client.browseProducts({ first: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('expires nodes after NODE_CACHE_TTL_MS', async () => {
    let time = 1_000_000;
    const fetchImpl = routeFetch({ Hydrate: nodesMixed });
    const client = makeClient(fetchImpl, { now: () => time });
    await client.loadNode(PRODUCT_ID);
    time += NODE_CACHE_TTL_MS - 1;
    await client.loadNode(PRODUCT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    time += 2;
    await client.loadNode(PRODUCT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('seeds the node cache from browse results', async () => {
    const fetchImpl = routeFetch({
      BrowseProducts: productsPage,
      Collections: collectionsFixture,
      ProductVariants: productVariants,
    });
    const client = makeClient(fetchImpl);
    const page = await client.browseProducts({ first: 5 });
    const collections = await client.collections({ first: 50 });
    const variants = await client.productVariants({ productId: PRODUCT_ID });
    const ids = [
      ...page.nodes.map(({ id }) => id),
      ...collections.nodes.map(({ id }) => id),
      ...(variants?.page.nodes.map(({ id }) => id) ?? []),
    ];
    const nodes = await client.loadNodes(ids);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(nodes.map((node) => node?.id)).toEqual(ids);
  });

  it('persists to sessionStorage, isolated per shop and per context', async () => {
    const fetchImpl = routeFetch({ Hydrate: nodesMixed });
    const options = { storage: sessionStorage };
    await makeClient(fetchImpl, options).loadNode(PRODUCT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // A new page load (fresh memory) reads the stored entry.
    const reloaded = makeClient(fetchImpl, options);
    await expect(reloaded.loadNode(PRODUCT_ID)).resolves.toMatchObject({
      id: PRODUCT_ID,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await reloaded.withContext({ country: 'CA' }).loadNode(PRODUCT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await makeClient(fetchImpl, {
      ...options,
      store: { ...STORE, shopDomain: 'other-shop.myshopify.com' },
    }).loadNode(PRODUCT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(
      `https://other-shop.myshopify.com/api/${SHOPIFY_STOREFRONT_API_VERSION}/graphql.json`,
    );
  });

  it('never shares stored entries between tokens or with tokenless mode', async () => {
    const fetchImpl = routeFetch({ Hydrate: nodesMixed });
    const otherToken = 'another-storefront-token';
    const options = { storage: sessionStorage };
    await makeClient(fetchImpl, options).loadNode(PRODUCT_ID);
    await makeClient(fetchImpl, {
      ...options,
      store: { ...STORE, storefrontAccessToken: otherToken },
    }).loadNode(PRODUCT_ID);
    await makeClient(fetchImpl, {
      ...options,
      store: { shopDomain: SHOP, storefrontAccessToken: '', tokenless: true },
    }).loadNode(PRODUCT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    // The same token still reads its own entry after a reload.
    await makeClient(fetchImpl, options).loadNode(PRODUCT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const stored = storageKeys(sessionStorage)
      .map((key) => `${key}=${sessionStorage.getItem(key)}`)
      .join('\n');
    expect(storedNodeIds(sessionStorage)).toHaveLength(3);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(otherToken);
  });

  it('keeps at most CACHE_MAX_ENTRIES entries in memory, evicting the oldest', async () => {
    const fetchImpl = routeFetch({ Hydrate: syntheticNodes });
    const client = makeClient(fetchImpl);
    const ids = productIds(CACHE_MAX_ENTRIES + 100, 5000);
    await client.loadNodes(ids);
    const calls = fetchImpl.mock.calls.length;

    await client.loadNode(ids[ids.length - 1] ?? '');
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
    await client.loadNode(ids[0] ?? '');
    expect(fetchImpl).toHaveBeenCalledTimes(calls + 1);
  });

  it('caps sessionStorage across page loads, evicting what expires first', async () => {
    let time = 1_000_000;
    const fetchImpl = routeFetch({ Hydrate: syntheticNodes });
    const options = { storage: sessionStorage, now: () => time };
    const phase = Math.floor(CACHE_MAX_ENTRIES * 0.6);
    const oldest = productIds(phase, 10_000);
    const older = productIds(phase, 20_000);
    const newest = productIds(phase, 30_000);

    const firstLoad = makeClient(fetchImpl, options);
    await firstLoad.loadNodes(oldest);
    time += 1000;
    await firstLoad.loadNodes(older);
    expect(storedNodeIds(sessionStorage).length).toBeLessThanOrEqual(
      CACHE_MAX_ENTRIES,
    );

    // A reload: what the previous page left counts toward the cap.
    time += 1000;
    await makeClient(fetchImpl, options).loadNodes(newest);
    const stored = storedNodeIds(sessionStorage);
    expect(stored.length).toBeLessThanOrEqual(CACHE_MAX_ENTRIES);
    expect(stored.filter((id) => oldest.includes(id))).toEqual([]);
    expect(newest.filter((id) => !stored.includes(id))).toEqual([]);
  });

  it('makes room when the storage quota is full instead of giving up', async () => {
    const storage = limitedStorage(20);
    let time = 1_000_000;
    // Every write expires a little later than the one before.
    const now = () => {
      time += 1;
      return time;
    };
    const fetchImpl = routeFetch({ Hydrate: syntheticNodes });
    await makeClient(fetchImpl, { storage, now }).loadNodes(
      productIds(30, 40_000),
    );
    const stored = storedNodeIds(storage);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.length).toBeLessThanOrEqual(20);
    // The newest entries survive, so persistence kept working.
    expect(stored).toContain('gid://shopify/Product/40029');
  });

  it('ignores and removes corrupt sessionStorage entries', async () => {
    const fetchImpl = routeFetch({ Hydrate: nodesMixed });
    const options = { storage: sessionStorage };
    await makeClient(fetchImpl, options).loadNode(PRODUCT_ID);
    const keys = Object.keys(sessionStorage).filter((key) =>
      key.includes(PRODUCT_ID),
    );
    expect(keys).toHaveLength(1);
    for (const key of keys) {
      sessionStorage.setItem(key, '{"not":"an entry"');
    }

    await expect(
      makeClient(fetchImpl, options).loadNode(PRODUCT_ID),
    ).resolves.toMatchObject({ id: PRODUCT_ID });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects stored nodes that no longer have a valid shape', async () => {
    const fetchImpl = routeFetch({ Hydrate: nodesMixed });
    const options = { storage: sessionStorage };
    await makeClient(fetchImpl, options).loadNode(PRODUCT_ID);
    for (const key of Object.keys(sessionStorage)) {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          e: Date.now() + 60_000,
          v: { __typename: 'Product' },
        }),
      );
    }
    await makeClient(fetchImpl, options).loadNode(PRODUCT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps working when sessionStorage throws', async () => {
    const failure = () => {
      throw new DOMException('Denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(failure);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(failure);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(failure);
    vi.spyOn(Storage.prototype, 'key').mockImplementation(failure);
    const fetchImpl = routeFetch({ Hydrate: nodesMixed });
    const client = makeClient(fetchImpl, { storage: sessionStorage });

    await expect(client.loadNode(PRODUCT_ID)).resolves.toMatchObject({
      id: PRODUCT_ID,
    });
    await client.loadNode(PRODUCT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never caches errors', async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;
      return call === 1
        ? textResponse('Internal Server Error', 500)
        : fixtureResponse(productsPage);
    });
    const client = makeClient(fetchImpl);
    await expect(client.browseProducts({ first: 5 })).rejects.toMatchObject({
      code: 'invalid-response',
    });
    await client.browseProducts({ first: 5 });
    await client.browseProducts({ first: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not cache unresolved nodes', async () => {
    const fetchImpl = routeFetch({ Hydrate: recordedHydrate });
    const client = makeClient(fetchImpl);
    await client.loadNodes([PRODUCT_ID, VARIANT_ID, COLLECTION_ID, BOGUS_ID]);
    await expect(client.loadNode(BOGUS_ID)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// API version
// ---------------------------------------------------------------------------

describe('API version', () => {
  it('warns once per session and notifies listeners on a version mismatch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = onApiVersionWarning(listener);
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(productsPage.body, { apiVersion: '2026-07' }),
    );
    const client = makeClient(fetchImpl);
    await client.browseProducts({ first: 5 });
    await client.browseProducts({ first: 6 });

    expect(listener).toHaveBeenCalledWith({
      pinned: '2026-10',
      responded: '2026-07',
    });
    expect(warn).toHaveBeenCalledTimes(1);

    unsubscribe();
    await client.browseProducts({ first: 7 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when the pinned version answers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = onApiVersionWarning(listener);
    await makeClient(
      routeFetch({ BrowseProducts: productsPage }),
    ).browseProducts({
      first: 5,
    });
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('connectionTest', () => {
  it('reports the shop, markets and API versions', async () => {
    const result = await makeClient(
      routeFetch({ ConnectionTest: connectionTestFixture }),
    ).connectionTest();

    expect(result).toMatchObject({
      shopName: 'DatoCMS Demo',
      primaryDomainUrl: 'https://datocms-demo.myshopify.com',
      respondedApiVersion: '2026-10',
      apiVersionOutdated: false,
      localization: { language: { isoCode: 'EN' } },
    });
    expect(result.localization.availableCountries).toHaveLength(16);
    expect(result.publicApiVersions).toContainEqual({
      handle: '2026-10',
      supported: true,
    });
  });

  it('flags an outdated API version', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const otherVersion = await makeClient(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(connectionTestFixture.body, { apiVersion: '2027-01' }),
      ),
    ).connectionTest();
    expect(otherVersion).toMatchObject({
      respondedApiVersion: '2027-01',
      apiVersionOutdated: true,
    });

    const body = structuredClone(connectionTestFixture.body);
    body.data.publicApiVersions = body.data.publicApiVersions.map((version) =>
      version.handle === '2026-10' ? { ...version, supported: false } : version,
    );
    const unsupported = await makeClient(
      vi.fn<typeof fetch>(async () => jsonResponse(body, { apiVersion: null })),
    ).connectionTest();
    expect(unsupported).toMatchObject({
      respondedApiVersion: null,
      apiVersionOutdated: true,
    });
  });

  it('surfaces the store-locked error for tokenless password-protected stores', async () => {
    const error = await captureError(
      makeClient(routeFetch({ ConnectionTest: storeLocked }), {
        store: { shopDomain: SHOP, storefrontAccessToken: '', tokenless: true },
      }).connectionTest(),
    );
    expect(error).toMatchObject({ code: 'store-locked', status: 400 });
  });
});

describe('detectCapabilities', () => {
  it('detects tags and treats ACCESS_DENIED inventory as missing', async () => {
    const fetchImpl = routeFetch({
      ProbeTags: probeTags,
      ProbeInventory: probeInventory,
    });
    const client = makeClient(fetchImpl, {
      store: { ...STORE, capabilities: undefined },
      now: () => Date.parse('2026-10-03T12:00:00Z'),
    });
    expect(client.effectiveCapabilities()).toEqual({
      tags: false,
      inventory: false,
      metafields: false,
    });

    await expect(client.detectCapabilities()).resolves.toEqual({
      tags: true,
      inventory: false,
      metafields: false,
      checkedAt: '2026-10-03T12:00:00.000Z',
    });
    expect(
      fetchImpl.mock.calls.map((_, index) =>
        operationName(requestAt(fetchImpl, index).query),
      ),
    ).toEqual(['ProbeTags', 'ProbeInventory']);
    expect(client.effectiveCapabilities()).toEqual({
      tags: true,
      inventory: false,
      metafields: false,
    });
  });

  it('never probes metafields, which the Storefront API cannot report', async () => {
    const fetchImpl = routeFetch({
      ProbeTags: probeTags,
      ProbeInventory: () =>
        jsonResponse({
          data: {
            products: { nodes: [{ id: PRODUCT_ID, totalInventory: 3 }] },
          },
        }),
    });
    const result = await makeClient(fetchImpl).detectCapabilities();
    expect(result).toMatchObject({
      tags: true,
      inventory: true,
      metafields: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [index] of fetchImpl.mock.calls.entries()) {
      expect(requestAt(fetchImpl, index).query).not.toContain('metafield');
    }
  });

  it('treats an empty tag list as no tags capability', async () => {
    const fetchImpl = routeFetch({
      ProbeTags: () => jsonResponse({ data: { productTags: { nodes: [] } } }),
      ProbeInventory: () =>
        jsonResponse({
          data: {
            products: { nodes: [{ id: PRODUCT_ID, totalInventory: 3 }] },
          },
        }),
    });
    await expect(
      makeClient(fetchImpl).detectCapabilities(),
    ).resolves.toMatchObject({
      tags: false,
      inventory: true,
      metafields: false,
    });
  });

  it('treats a productTags denial that nulls the whole response as no tags', async () => {
    // Recorded: Shopify answers a denied productTags (non-null) with data: null.
    expect(probeTagsDenied.body.data).toBeNull();
    const fetchImpl = routeFetch({
      ProbeTags: probeTagsDenied,
      ProbeInventory: probeInventory,
    });
    const client = makeClient(fetchImpl);
    expect(client.effectiveCapabilities().tags).toBe(true);

    await expect(client.detectCapabilities()).resolves.toMatchObject({
      tags: false,
      inventory: false,
      metafields: false,
    });
    expect(client.effectiveCapabilities()).toEqual({
      tags: false,
      inventory: false,
      metafields: false,
    });
  });

  it('lets one denied probe fail without sinking the others', async () => {
    const fetchImpl = routeFetch({
      ProbeTags: probeTags,
      ProbeInventory: () =>
        jsonResponse({
          errors: [
            {
              message: 'Access denied for products field.',
              path: ['products'],
              extensions: { code: 'ACCESS_DENIED' },
            },
          ],
          data: null,
        }),
    });
    await expect(
      makeClient(fetchImpl).detectCapabilities(),
    ).resolves.toMatchObject({
      tags: true,
      inventory: false,
      metafields: false,
    });
  });

  it('fails detection on errors that say nothing about scopes', async () => {
    const fetchImpl = routeFetch({
      ProbeTags: probeTags,
      ProbeInventory: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(
      makeClient(fetchImpl).detectCapabilities(),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('reports no capabilities for tokenless stores without probing', async () => {
    const fetchImpl = routeFetch({});
    const result = await makeClient(fetchImpl, {
      store: { shopDomain: SHOP, storefrontAccessToken: '', tokenless: true },
    }).detectCapabilities();
    expect(result).toMatchObject({
      tags: false,
      inventory: false,
      metafields: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('detected capabilities cache', () => {
  const undetected: StoreConnection = { ...STORE, capabilities: undefined };
  const t0 = Date.parse('2026-10-03T12:00:00Z');

  function detectingFetch(): FetchMock {
    return routeFetch({ ProbeTags: probeTags, ProbeInventory: probeInventory });
  }

  /** What a new picker iframe of the same tab starts with. */
  function freshClient(
    fetchImpl: FetchMock,
    overrides: Partial<ClientOptions> = {},
  ): ShopifyClient {
    return makeClient(fetchImpl, {
      store: undetected,
      storage: sessionStorage,
      now: () => t0,
      ...overrides,
    });
  }

  it('knows the capabilities when they are saved, or for tokenless stores', () => {
    const fetchImpl = routeFetch({});
    expect(makeClient(fetchImpl).hasKnownCapabilities()).toBe(true);
    expect(
      makeClient(fetchImpl, {
        store: { shopDomain: SHOP, storefrontAccessToken: '', tokenless: true },
      }).hasKnownCapabilities(),
    ).toBe(true);
    expect(
      makeClient(fetchImpl, { store: undetected }).hasKnownCapabilities(),
    ).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lets a new client of the same tab reuse the detection without probing', async () => {
    await freshClient(detectingFetch()).detectCapabilities();
    resetShopifyClients();

    const fetchImpl = routeFetch({});
    const reopened = freshClient(fetchImpl);
    expect(reopened.hasKnownCapabilities()).toBe(true);
    expect(reopened.effectiveCapabilities()).toEqual({
      tags: true,
      inventory: false,
      metafields: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('shares the detection through getShopifyClient too', async () => {
    const fetchImpl = detectingFetch();
    vi.stubGlobal('fetch', fetchImpl);
    try {
      await getShopifyClient(undetected).detectCapabilities();
      resetShopifyClients();
      const reopened = getShopifyClient(undetected, { country: 'CA' });
      expect(reopened.hasKnownCapabilities()).toBe(true);
      expect(reopened.effectiveCapabilities().tags).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps detections apart per token', async () => {
    await freshClient(detectingFetch()).detectCapabilities();
    resetShopifyClients();

    const other = freshClient(routeFetch({}), {
      store: { ...undetected, storefrontAccessToken: 'another-token-456' },
    });
    expect(other.hasKnownCapabilities()).toBe(false);
    expect(other.effectiveCapabilities().tags).toBe(false);
  });

  it('still probes when asked to detect again (settings re-checks)', async () => {
    await freshClient(detectingFetch()).detectCapabilities();
    resetShopifyClients();

    const fetchImpl = routeFetch({
      ProbeTags: () => jsonResponse({ data: { productTags: { nodes: [] } } }),
      ProbeInventory: probeInventory,
    });
    const reopened = freshClient(fetchImpl, { now: () => t0 + 1000 });
    await expect(reopened.detectCapabilities()).resolves.toMatchObject({
      tags: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    resetShopifyClients();
    expect(
      freshClient(routeFetch({}), {
        now: () => t0 + 2000,
      }).effectiveCapabilities().tags,
    ).toBe(false);
  });

  it('expires the detection after 30 minutes', async () => {
    await freshClient(detectingFetch()).detectCapabilities();
    resetShopifyClients();

    const later = freshClient(routeFetch({}), {
      now: () => t0 + 30 * 60 * 1000 + 1,
    });
    expect(later.hasKnownCapabilities()).toBe(false);
    expect(later.effectiveCapabilities().tags).toBe(false);
  });

  it('ignores a malformed cached detection', async () => {
    await freshClient(detectingFetch()).detectCapabilities();
    resetShopifyClients();
    const [key] = storageKeys(sessionStorage).filter((name) =>
      name.endsWith('|capabilities'),
    );
    expect(key).toBeDefined();
    sessionStorage.setItem(
      key ?? '',
      JSON.stringify({ e: t0 + 60_000, v: { tags: 'yes', inventory: true } }),
    );

    const reopened = freshClient(routeFetch({}));
    expect(reopened.hasKnownCapabilities()).toBe(false);
    expect(reopened.effectiveCapabilities().tags).toBe(false);
  });

  it('prefers newer saved capabilities over an older cached detection', async () => {
    await freshClient(detectingFetch()).detectCapabilities();
    resetShopifyClients();

    const saved = freshClient(routeFetch({}), {
      store: {
        ...undetected,
        capabilities: {
          tags: false,
          inventory: true,
          metafields: false,
          checkedAt: new Date(t0 + 1000).toISOString(),
        },
      },
    });
    expect(saved.effectiveCapabilities()).toEqual({
      tags: false,
      inventory: true,
      metafields: false,
    });
  });
});

describe('appliedContext', () => {
  it('reports the market Shopify applied, including silent language fallbacks', async () => {
    const fetchImpl = routeFetch({
      BrowseProducts: contextFallback,
      Hydrate: nodesMixed,
    });
    const options = { storage: sessionStorage };
    const client = makeClient(fetchImpl, options);
    const french = client.withContext({ country: 'US', language: 'FR' });
    expect(french.appliedContext()).toBeNull();

    await french.browseProducts({ first: 2 });
    expect(requestAt(fetchImpl).variables).toMatchObject({
      country: 'US',
      language: 'FR',
    });
    expect(french.appliedContext()).toEqual({ country: 'US', language: 'EN' });

    // Tracked per context: the default market learns its own.
    expect(client.appliedContext()).toBeNull();
    await client.loadNode(PRODUCT_ID);
    expect(client.appliedContext()).toEqual({ country: 'IT', language: 'EN' });

    // Remembered after a reload, while results come from the cache.
    const reloaded = makeClient(fetchImpl, options).withContext({
      country: 'US',
      language: 'FR',
    });
    expect(reloaded.appliedContext()).toEqual({
      country: 'US',
      language: 'EN',
    });
    await reloaded.browseProducts({ first: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('localization', () => {
  it('returns markets for the context switcher', async () => {
    const fetchImpl = routeFetch({ Localization: localizationFixture });
    const result = await makeClient(fetchImpl)
      .withContext({ country: 'CA', language: 'EN' })
      .localization();
    expect(result.country.isoCode).toBe('CA');
    expect(result.availableLanguages).toEqual([
      { isoCode: 'EN', endonymName: 'English' },
    ]);
    expect(requestAt(fetchImpl).variables).toEqual({
      country: 'CA',
      language: 'EN',
    });
  });
});

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

describe('legacyProduct', () => {
  const legacyNode = legacyById.body.data.nodes[0];
  const { __typename: _typename, ...expectedLegacy } = legacyNode;

  it('looks up by ID first (decoding base64 IDs) and keeps the 1.x key order', async () => {
    const fetchImpl = routeFetch({ LegacyProductById: legacyById });
    const result = await makeClient(fetchImpl).legacyProduct({
      id: btoa(PRODUCT_ID),
      handle: 'renamed-handle',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestAt(fetchImpl).variables).toMatchObject({ ids: [PRODUCT_ID] });
    expect(result).toEqual(expectedLegacy);
    expect(Object.keys(result ?? {})).toEqual([
      'id',
      'title',
      'handle',
      'description',
      'onlineStoreUrl',
      'availableForSale',
      'productType',
      'priceRange',
      'images',
    ]);
    expect(result?.images.edges[0]?.node.previewSrc).toContain('_200x200');
  });

  it('falls back to the handle when the ID no longer resolves', async () => {
    const fetchImpl = routeFetch({
      LegacyProductById: () => jsonResponse({ data: { nodes: [null] } }),
      LegacyProductByHandle: legacyByHandle,
    });
    const result = await makeClient(fetchImpl).legacyProduct({
      id: BOGUS_ID,
      handle: 'the-complete-snowboard',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(operationName(requestAt(fetchImpl, 0).query)).toBe(
      'LegacyProductById',
    );
    expect(requestAt(fetchImpl, 1).variables).toMatchObject({
      handle: 'the-complete-snowboard',
    });
    expect(result?.id).toBe(PRODUCT_ID);
  });

  it('uses the handle directly when there is no usable ID', async () => {
    const fetchImpl = routeFetch({ LegacyProductByHandle: legacyByHandle });
    const result = await makeClient(fetchImpl).legacyProduct({
      id: '1234567890',
      handle: 'the-complete-snowboard',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result?.handle).toBe('the-complete-snowboard');
  });

  it('returns null when neither ID nor handle resolves', async () => {
    const fetchImpl = routeFetch({
      LegacyProductByHandle: () => jsonResponse({ data: { product: null } }),
    });
    await expect(
      makeClient(fetchImpl).legacyProduct({ handle: 'gone' }),
    ).resolves.toBeNull();
    await expect(makeClient(fetchImpl).legacyProduct({})).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('handles', () => {
  it('resolves products and collections by handle and seeds the node cache', async () => {
    const fetchImpl = routeFetch({
      ProductByHandle: productByHandle,
      CollectionByHandle: () =>
        jsonResponse({
          data: {
            collection: collectionsFixture.body.data.collections.nodes[2],
          },
        }),
    });
    const client = makeClient(fetchImpl);
    const product = await client.productByHandle(' the-complete-snowboard ');
    const collection = await client.collectionByHandle('hydrogen');

    expect(product).toMatchObject({ id: PRODUCT_ID, __typename: 'Product' });
    expect(collection).toMatchObject({
      handle: 'hydrogen',
      __typename: 'Collection',
    });
    expect(requestAt(fetchImpl).variables).toMatchObject({
      handle: 'the-complete-snowboard',
    });
    await client.loadNode(PRODUCT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(client.productByHandle('  ')).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Browsing
// ---------------------------------------------------------------------------

describe('browsing', () => {
  it('pages products and normalizes the arguments', async () => {
    const fetchImpl = routeFetch({ BrowseProducts: productsPage });
    const page = await makeClient(fetchImpl).browseProducts({
      first: 1000,
      after: '',
      sortKey: 'RELEVANCE',
      reverse: true,
    });

    expect(page.nodes).toHaveLength(5);
    expect(page.pageInfo).toEqual(productsPage.body.data.products.pageInfo);
    expect(requestAt(fetchImpl).variables).toEqual({
      first: 250,
      after: null,
      query: null,
      sortKey: null,
      reverse: true,
      country: null,
      language: null,
    });
  });

  it('reads the SKU of single-variant products only', async () => {
    const fetchImpl = routeFetch({ BrowseProducts: productsPage });
    const page = await makeClient(fetchImpl).browseProducts({ first: 5 });
    const skus = page.nodes.map((node) => [
      node.title,
      node.variantsCount?.count,
      node.sku,
    ]);
    expect(skus).toEqual([
      ['The Inventory Not Tracked Snowboard', 1, 'sku-untracked-1'],
      ['Gift Card', 4, null],
      ['The Out of Stock Snowboard', 1, null],
      ['The Minimal Snowboard', 1, null],
      ['The Collection Snowboard: Hydrogen', 1, null],
    ]);
    expect(requestAt(fetchImpl).query).toContain(
      'firstVariant: variants(first: 1) { nodes { sku } }',
    );
  });

  it('leaves the SKU empty for products with several variants', () => {
    const [card] = productsPage.body.data.products.nodes;
    const product = (overrides: Record<string, unknown>) =>
      normalizeNode({ ...card, ...overrides });
    expect(
      product({
        variantsCount: { count: 3 },
        firstVariant: { nodes: [{ sku: 'FIRST-OF-3' }] },
      }),
    ).toMatchObject({ sku: null });
    expect(
      product({ firstVariant: { nodes: [{ sku: '  BOARD-1  ' }] } }),
    ).toMatchObject({ sku: 'BOARD-1' });
    expect(product({ firstVariant: { nodes: [{ sku: ' ' }] } })).toMatchObject({
      sku: null,
    });
    expect(product({ firstVariant: { nodes: [] } })).toMatchObject({
      sku: null,
    });
  });

  it('keeps the SKU of a product normalized before', () => {
    const [card] = productsPage.body.data.products.nodes;
    const once = normalizeNode(card);
    expect(once).toMatchObject({ sku: 'sku-untracked-1' });
    // Picker parameters carry normalized nodes, without `firstVariant`.
    expect(normalizeNode(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it('requests inventory fields when the store has the capability', async () => {
    const fetchImpl = routeFetch({ BrowseProducts: productsPage });
    await makeClient(fetchImpl, {
      store: {
        ...STORE,
        capabilities: {
          tags: true,
          inventory: true,
          metafields: true,
          checkedAt: '2026-10-01T00:00:00Z',
        },
      },
    }).browseProducts({ first: 5, query: 'title:Snow*', sortKey: 'RELEVANCE' });

    expect(requestAt(fetchImpl).query).toBe(
      browseProductsQuery({ inventory: true, tags: true }),
    );
    expect(requestAt(fetchImpl).variables).toMatchObject({
      query: 'title:Snow*',
      sortKey: 'RELEVANCE',
    });
  });

  it('browses a collection with Search & Discovery filters', async () => {
    const fetchImpl = routeFetch({
      BrowseCollectionProducts: collectionProducts,
    });
    const result = await makeClient(fetchImpl).browseCollectionProducts({
      collectionId: COLLECTION_ID,
      first: 5,
      filters: [{ available: true }],
      sortKey: 'BEST_SELLING',
    });

    expect(result.found).toBe(true);
    expect(result.page.nodes).toHaveLength(5);
    expect(result.filters.map(({ id }) => id)).toEqual([
      'filter.v.availability',
      'filter.v.price',
    ]);
    expect(result.filters[0]?.values[0]).toEqual({
      id: 'filter.v.availability.1',
      label: 'In stock',
      count: 7,
      input: '{"available":true}',
    });
    expect(requestAt(fetchImpl).variables).toMatchObject({
      id: COLLECTION_ID,
      filters: [{ available: true }],
      sortKey: 'BEST_SELLING',
    });
  });

  it('reports a missing collection', async () => {
    const fetchImpl = routeFetch({
      BrowseCollectionProducts: () =>
        jsonResponse({ data: { collection: null } }),
    });
    await expect(
      makeClient(fetchImpl).browseCollectionProducts({
        collectionId: 'gid://shopify/Collection/1',
        first: 5,
      }),
    ).resolves.toEqual({
      found: false,
      page: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      filters: [],
    });
  });

  it('pages the variants of a multi-variant product', async () => {
    const fetchImpl = routeFetch({ ProductVariants: productVariants });
    const result = await makeClient(fetchImpl).productVariants({
      productId: PRODUCT_ID,
    });

    expect(result?.variantsCount).toBe(5);
    expect(result?.options).toEqual([
      {
        name: 'Color',
        optionValues: [
          { name: 'Ice' },
          { name: 'Dawn' },
          { name: 'Powder' },
          { name: 'Electric' },
          { name: 'Sunset' },
        ],
      },
    ]);
    expect(result?.page.nodes.map(({ title }) => title)).toEqual([
      'Ice',
      'Dawn',
      'Powder',
      'Electric',
      'Sunset',
    ]);
    expect(result?.page.nodes[0]?.product.handle).toBe(
      'the-complete-snowboard',
    );
    expect(requestAt(fetchImpl).variables).toMatchObject({ first: 250 });
  });

  it('returns null variants for a product the storefront cannot see', async () => {
    const fetchImpl = routeFetch({
      ProductVariants: () => jsonResponse({ data: { product: null } }),
    });
    await expect(
      makeClient(fetchImpl).productVariants({ productId: BOGUS_ID }),
    ).resolves.toBeNull();
  });

  it('lists filter values without empty strings, and tags only with the capability', async () => {
    const withTags = routeFetch({ FilterValues: filterValuesFixture });
    await expect(makeClient(withTags).filterValues()).resolves.toEqual({
      productTypes: ['accessories', 'giftcard', 'snowboard'],
      tags: [
        'Accessory',
        'Archived',
        'Premium',
        'Snow',
        'Snowboard',
        'Sport',
        'Winter',
      ],
    });

    const withoutTags = routeFetch({ FilterValues: filterValuesFixture });
    await expect(
      makeClient(withoutTags, {
        store: { ...STORE, capabilities: undefined },
      }).filterValues(),
    ).resolves.toEqual({
      productTypes: ['accessories', 'giftcard', 'snowboard'],
      tags: [],
    });
    expect(requestAt(withoutTags).query).not.toContain('productTags');
  });

  it('drops tags when the scope was revoked and still lists product types', async () => {
    // Recorded: with productTags denied, Shopify nulls productTypes too.
    expect(filterValuesTagsDenied.body.data).toBeNull();
    const fetchImpl = routeFetch({
      FilterValues: (request) =>
        fixtureResponse(
          request.query.includes('productTags')
            ? filterValuesTagsDenied
            : filterValuesNoTags,
        ),
    });
    const client = makeClient(fetchImpl);
    expect(client.effectiveCapabilities().tags).toBe(true);

    await expect(client.filterValues()).resolves.toEqual({
      productTypes: ['Snowboards'],
      tags: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestAt(fetchImpl, 0).query).toContain('productTags');
    expect(requestAt(fetchImpl, 1).query).not.toContain('productTags');
    expect(client.effectiveCapabilities().tags).toBe(false);

    // Cached under the capabilities it was fetched with.
    await client.filterValues();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('lists collections', async () => {
    const fetchImpl = routeFetch({ Collections: collectionsFixture });
    const page = await makeClient(fetchImpl).collections({
      first: 50,
      query: 'title:Hyd*',
    });
    // Sorted by title: "Automated Collection", "Home page", "Hydrogen".
    expect(page.nodes.map(({ handle }) => handle)).toEqual([
      'automated-collection',
      'frontpage',
      'hydrogen',
    ]);
    expect(requestAt(fetchImpl).variables).toMatchObject({
      first: 50,
      query: 'title:Hyd*',
    });
  });
});

describe('skuMatches', () => {
  const recorded = skuMatchesFixture.body.data.predictiveSearch.products[0];
  const variant = recorded.variants.nodes[0];

  function variantWith(
    id: number,
    sku: string | null,
    barcode: string | null = null,
  ) {
    return {
      ...variant,
      id: `gid://shopify/ProductVariant/${id}`,
      sku,
      barcode,
    };
  }

  it('finds a product by exact variant SKU (recorded)', async () => {
    const fetchImpl = routeFetch({ SkuMatches: skuMatchesFixture });
    const matches = await makeClient(fetchImpl).skuMatches('SKU-MANAGED-1');

    expect(matches).toHaveLength(1);
    expect(matches[0]?.product.handle).toBe('the-multi-managed-snowboard');
    expect(matches[0]?.product).not.toHaveProperty('variants');
    expect(matches[0]?.variants.map(({ sku }) => sku)).toEqual([
      'sku-managed-1',
    ]);
    expect(requestAt(fetchImpl).variables).toMatchObject({
      q: 'SKU-MANAGED-1',
    });
    expect(requestAt(fetchImpl).query).toContain(
      'searchableFields: [VARIANTS_SKU, VARIANTS_BARCODE]',
    );
  });

  it('keeps only matching variants, exact first, and drops products without one', async () => {
    const productA = {
      ...recorded,
      id: 'gid://shopify/Product/501',
      variants: {
        nodes: [
          variantWith(1, 'zzz-other'),
          variantWith(2, 'x-abc-1-y'),
          variantWith(3, 'ABC-1-B'),
          variantWith(4, null, null),
        ],
      },
    };
    const productB = {
      ...recorded,
      id: 'gid://shopify/Product/502',
      variants: { nodes: [variantWith(5, 'nothing', '0000')] },
    };
    const productC = {
      ...recorded,
      id: 'gid://shopify/Product/503',
      variants: {
        nodes: [variantWith(6, 'abc-10'), variantWith(7, null, 'abc-1')],
      },
    };
    const fetchImpl = routeFetch({
      SkuMatches: () =>
        jsonResponse({
          data: {
            predictiveSearch: { products: [productA, productB, productC] },
          },
        }),
    });
    const matches = await makeClient(fetchImpl).skuMatches('abc-1');

    expect(matches.map(({ product }) => product.id)).toEqual([
      'gid://shopify/Product/503',
      'gid://shopify/Product/501',
    ]);
    expect(matches[0]?.variants.map(({ id }) => id)).toEqual([
      'gid://shopify/ProductVariant/7',
      'gid://shopify/ProductVariant/6',
    ]);
    expect(matches[1]?.variants.map(({ id }) => id)).toEqual([
      'gid://shopify/ProductVariant/3',
      'gid://shopify/ProductVariant/2',
    ]);
  });

  it('keeps recorded prefix matches in Shopify order and drops looser hits', async () => {
    const fetchImpl = routeFetch({ SkuMatches: skuPrefixMatches });
    const client = makeClient(fetchImpl);
    const summary = (
      matches: Awaited<ReturnType<ShopifyClient['skuMatches']>>,
    ) =>
      matches.map(({ product, variants }) => [
        product.handle,
        variants.map(({ sku }) => sku),
      ]);

    // Recorded answer for "sku-": every SKU is a prefix match (same rank).
    expect(summary(await client.skuMatches('sku-'))).toEqual([
      ['the-3p-fulfilled-snowboard', ['sku-hosted-1']],
      ['the-inventory-not-tracked-snowboard', ['sku-untracked-1']],
      ['the-multi-managed-snowboard', ['sku-managed-1']],
    ]);
    // Predictive search can return products that don't match the full term.
    expect(summary(await client.skuMatches('SKU-MANAGED'))).toEqual([
      ['the-multi-managed-snowboard', ['sku-managed-1']],
    ]);
    expect(summary(await client.skuMatches('hosted'))).toEqual([
      ['the-3p-fulfilled-snowboard', ['sku-hosted-1']],
    ]);
  });

  it('skips the request for blank input', async () => {
    const fetchImpl = routeFetch({});
    await expect(makeClient(fetchImpl).skuMatches('   ')).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Shared instances
// ---------------------------------------------------------------------------

describe('getShopifyClient', () => {
  it('memoizes per shop, token and tokenless flag, with one client per context', () => {
    const client = getShopifyClient(STORE);
    expect(getShopifyClient({ ...STORE })).toBe(client);
    expect(getShopifyClient(STORE, { country: 'ca' })).toBe(
      client.withContext({ country: 'CA' }),
    );
    expect(client.withContext()).toBe(client);
    expect(
      getShopifyClient({ ...STORE, storefrontAccessToken: 'other-token' }),
    ).not.toBe(client);
    expect(
      getShopifyClient({
        ...STORE,
        storefrontAccessToken: '',
        tokenless: true,
      }),
    ).not.toBe(client);
    expect(client.shopDomain).toBe(SHOP);
    expect(client.context).toEqual({});
  });

  it('uses the store default market when no context is given', () => {
    const client = getShopifyClient({
      ...STORE,
      defaultCountry: 'us',
      defaultLanguage: 'en',
    });
    expect(client.context).toEqual({ country: 'US', language: 'EN' });
    expect(client.withContext({}).context).toEqual({});
  });

  it('shares batching and dedupe across clients for the same store', async () => {
    const fetchImpl = routeFetch({ Hydrate: syntheticNodes });
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const first = getShopifyClient(STORE).loadNode(
        'gid://shopify/Product/11',
      );
      const second = getShopifyClient({ ...STORE }).loadNode(
        'gid://shopify/Product/12',
      );
      const nodes: Array<ShopifyNode | null> = await Promise.all([
        first,
        second,
      ]);
      expect(nodes.map((node) => node?.id)).toEqual([
        'gid://shopify/Product/11',
        'gid://shopify/Product/12',
      ]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
