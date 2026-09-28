import {
  CMA_BASE_URL,
  errorReply,
  FakeApiError,
  type FakeReply,
  type FakeRequest,
  filterTypes,
  jsonReply,
  parseQuery,
  queryInteger,
  queryObject,
  queryString,
  STATUS_TEXT,
} from './http';
import {
  getScenario,
  type Scenario,
  type ScenarioHooks,
  type ScenarioName,
} from './scenarios';
import { buildSchema } from './schema';
import { createStore, type FakeStore, type ListQuery } from './store';

/**
 * A fetch-level fake of the DatoCMS Content Management API. It answers the
 * requests `@datocms/cma-client-browser` sends (same URLs, bracketed query
 * params, JSON:API bodies, `meta.current_version` locking, error entities),
 * so the real page runs against it unchanged. Other URLs go to the real fetch.
 */

export type RequestLogEntry = {
  method: string;
  path: string;
  search: string;
  status: number | 'network_error';
};

export type FakeCma = {
  scenario: Scenario;
  store: FakeStore;
  /** Every CMA request answered so far, oldest first. */
  requests: RequestLogEntry[];
  /** Milliseconds every response waits. */
  latency: number;
  /** Routes one request (no latency). */
  handle(request: FakeRequest): FakeReply;
  /** Puts the original `fetch` back. */
  uninstall(): void;
};

export type InstallFakeCmaOptions = {
  /** Defaults to the scenario's latency (120 ms, 40 ms for `many`). */
  latency?: number;
  /** Up to this many extra ms per request, at random: answers arrive out of order. */
  jitter?: number;
};

type FetchArgs = Parameters<typeof fetch>;

function listQuery(request: FakeRequest): ListQuery {
  const filter = queryObject(request.query.filter);
  const page = queryObject(request.query.page);
  const ids = queryString(filter.ids);
  const status = queryObject(queryObject(filter.fields)._status);
  const statusIn = Array.isArray(status.in)
    ? status.in.filter((entry): entry is string => typeof entry === 'string')
    : null;
  const statusEq = queryString(status.eq);

  return {
    ids: ids ? ids.split(',').filter(Boolean) : null,
    types: filterTypes(request),
    statuses: statusIn ?? (statusEq ? [statusEq] : null),
    text: queryString(filter.query) ?? null,
    offset: queryInteger(page.offset, 0),
    limit: queryInteger(page.limit, 30),
    orderBy: queryString(request.query.order_by) ?? null,
    nested: request.query.nested === 'true',
  };
}

/** The CMA's page limits: 30 records with `nested`, 500 without. */
const MAX_NESTED_LIMIT = 30;

/** `GET /items`, with the CMA's page limits. */
function listItems(request: FakeRequest, store: FakeStore): FakeReply {
  const query = listQuery(request);
  if (query.nested && query.limit > MAX_NESTED_LIMIT) {
    return errorReply(422, 'INVALID_FIELD', {
      field: 'page.limit',
      code: 'VALIDATION_LIMIT',
      max: MAX_NESTED_LIMIT,
    });
  }
  const { data, totalCount } = store.list(query);
  return jsonReply(200, { data, meta: { total_count: totalCount } });
}

function routeItems(request: FakeRequest, store: FakeStore): FakeReply | null {
  if (request.path === '/items' && request.method === 'GET') {
    return listItems(request, store);
  }

  const match = request.path.match(
    /^\/items\/([^/]+)(?:\/(validate|publish))?$/,
  );
  const id = match?.[1];
  const action = match?.[2];
  if (!id) return null;

  if (action === 'validate') {
    if (request.method !== 'POST') return null;
    store.validate(id, request.body);
    return jsonReply(200, {});
  }

  // Whole-record publish (no body); a selective-publish body is ignored.
  if (action === 'publish') {
    if (request.method !== 'PUT') return null;
    return jsonReply(200, {
      data: store.render(store.publish(id), request.query.nested === 'true'),
    });
  }

  if (request.method === 'GET') {
    const record = store.find(id);
    return record
      ? jsonReply(200, {
          data: store.render(record, request.query.nested === 'true'),
        })
      : errorReply(404, 'NOT_FOUND', { id });
  }

  if (request.method === 'PUT') {
    return jsonReply(200, { data: store.update(id, request.body) });
  }

  return null;
}

function routeSchema(request: FakeRequest, store: FakeStore): FakeReply | null {
  if (request.method !== 'GET') return null;
  if (request.path === '/site') return jsonReply(200, { data: store.site });
  if (request.path === '/item-types') {
    return jsonReply(200, { data: store.schema.itemTypes });
  }

  const match = request.path.match(/^\/item-types\/([^/]+)(\/fields)?$/);
  const itemType = match?.[1] ? store.schema.itemTypesById.get(match[1]) : null;
  if (!match || !itemType) return null;

  return match[2]
    ? jsonReply(200, {
        data: store.schema.fieldsByItemTypeId.get(itemType.id) ?? [],
      })
    : jsonReply(200, { data: itemType });
}

function isAuthorized(request: FakeRequest): boolean {
  const authorization = request.headers.get('authorization') ?? '';
  return /^Bearer .+/.test(authorization) && authorization !== 'Bearer null';
}

export function route(request: FakeRequest, store: FakeStore): FakeReply {
  if (!isAuthorized(request)) {
    return errorReply(401, 'INVALID_AUTHORIZATION_HEADER');
  }

  try {
    const reply = routeSchema(request, store) ?? routeItems(request, store);
    if (reply) return reply;
  } catch (error) {
    if (error instanceof FakeApiError) {
      return jsonReply(error.status, { data: error.errors });
    }
    throw error;
  }

  console.warn(
    `[fake CMA] No route for ${request.method} ${request.path}`,
    request.query,
  );
  return errorReply(404, 'NOT_FOUND', { path: request.path });
}

function handleWithHooks(
  request: FakeRequest,
  store: FakeStore,
  hooks: ScenarioHooks,
): FakeReply {
  const runtime = { store };
  const early = hooks.beforeRoute?.(request, runtime) ?? null;
  if (early) return early;
  const reply = route(request, store);
  return hooks.afterRoute ? hooks.afterRoute(request, reply, runtime) : reply;
}

function requestUrl(input: FetchArgs[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function readBody(
  input: FetchArgs[0],
  init: FetchArgs[1],
): Promise<unknown> {
  const raw =
    typeof init?.body === 'string'
      ? init.body
      : input instanceof Request
        ? await input.clone().text()
        : '';
  return raw ? JSON.parse(raw) : null;
}

async function readRequest(
  input: FetchArgs[0],
  init: FetchArgs[1],
): Promise<FakeRequest> {
  const url = new URL(requestUrl(input));
  const method = (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();

  return {
    method,
    path: url.pathname.replace(/\/$/, '') || '/',
    query: parseQuery(url.searchParams),
    headers: new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    ),
    body: await readBody(input, init),
  };
}

function toResponse(reply: Extract<FakeReply, { kind: 'json' }>): Response {
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    statusText: STATUS_TEXT[reply.status] ?? '',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Api-Version': '3',
      'X-Environment': 'main',
      ...reply.headers,
    },
  });
}

function wait(
  ms: number,
  signal: AbortSignal | null | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function createFakeCma(
  scenarioName: ScenarioName,
  options: InstallFakeCmaOptions = {},
): FakeCma & { fetch: typeof fetch } {
  const scenario = getScenario(scenarioName);
  const store = createStore(buildSchema(), scenario.records());
  const hooks = scenario.createHooks();
  const requests: RequestLogEntry[] = [];
  const latency = options.latency ?? scenario.latency;
  const jitter = Math.max(0, options.jitter ?? 0);
  const originalFetch = globalThis.fetch;

  const fakeFetch = async (...[input, init]: FetchArgs): Promise<Response> => {
    const url = requestUrl(input);
    if (!url.startsWith(CMA_BASE_URL)) {
      return originalFetch.call(globalThis, input, init);
    }

    const request = await readRequest(input, init);
    const delay =
      latency + (jitter > 0 ? Math.round(Math.random() * jitter) : 0);
    if (delay > 0) await wait(delay, init?.signal);

    const reply = handleWithHooks(request, store, hooks);
    requests.push({
      method: request.method,
      path: request.path,
      search: new URL(url).search,
      status: reply.kind === 'json' ? reply.status : 'network_error',
    });

    if (reply.kind === 'network_error') throw new TypeError(reply.message);
    return toResponse(reply);
  };

  return {
    scenario,
    store,
    requests,
    latency,
    fetch: fakeFetch,
    handle: (request) => handleWithHooks(request, store, hooks),
    uninstall: () => {
      if (globalThis.fetch === fakeFetch) globalThis.fetch = originalFetch;
    },
  };
}

/**
 * Replaces the global `fetch` for `https://site-api.datocms.com` (every other
 * URL passes through). Records live in memory until the page reloads.
 */
export function installFakeCma(
  scenarioName: ScenarioName,
  options: InstallFakeCmaOptions = {},
): FakeCma {
  const cma = createFakeCma(scenarioName, options);
  globalThis.fetch = cma.fetch;
  return cma;
}
