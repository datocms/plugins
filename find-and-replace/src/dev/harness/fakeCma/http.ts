import { createIdSequence } from './ids';

/**
 * Request and reply shapes of the fake CMA, and the JSON:API error entities
 * `@datocms/rest-client-utils` parses into `ApiError.errors`.
 */

export const CMA_BASE_URL = 'https://site-api.datocms.com';

export type FakeRequest = {
  method: string;
  /** Path without the base URL: `/items/abc`. */
  path: string;
  /** Bracketed params parsed back into objects: `filter[type]=a` → `{ filter: { type: 'a' } }`. */
  query: Record<string, unknown>;
  headers: Headers;
  body: unknown;
};

export type FakeReply =
  | {
      kind: 'json';
      status: number;
      body: unknown;
      headers?: Record<string, string>;
    }
  /** `fetch` rejects with a `TypeError`, as when the connection drops. */
  | { kind: 'network_error'; message: string };

export type ApiErrorEntity = {
  id: string;
  type: 'api_error';
  attributes: {
    code: string;
    transient?: true;
    doc_url: string;
    details: Record<string, unknown>;
  };
};

const nextErrorId = createIdSequence('api_error');

export function errorEntity(
  code: string,
  details: Record<string, unknown> = {},
  options: { transient?: boolean } = {},
): ApiErrorEntity {
  return {
    id: nextErrorId().slice(0, 6).toLowerCase(),
    type: 'api_error',
    attributes: {
      code,
      ...(options.transient ? { transient: true as const } : {}),
      doc_url: `https://www.datocms.com/docs/content-management-api/errors#${code}`,
      details,
    },
  };
}

/** Thrown by the store; the router turns it into an error reply. */
export class FakeApiError extends Error {
  readonly status: number;
  readonly errors: ReadonlyArray<ApiErrorEntity>;

  constructor(status: number, errors: ReadonlyArray<ApiErrorEntity>) {
    super(errors.map((error) => error.attributes.code).join(', '));
    this.name = 'FakeApiError';
    this.status = status;
    this.errors = errors;
  }
}

export function apiError(
  status: number,
  code: string,
  details: Record<string, unknown> = {},
): FakeApiError {
  return new FakeApiError(status, [errorEntity(code, details)]);
}

export function jsonReply(status: number, body: unknown): FakeReply {
  return { kind: 'json', status, body };
}

export function errorReply(
  status: number,
  code: string,
  details: Record<string, unknown> = {},
  options: { transient?: boolean } = {},
): FakeReply {
  return jsonReply(status, { data: [errorEntity(code, details, options)] });
}

export const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK',
  204: 'No Content',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

// ── Query strings ───────────────────────────────────────────────────────────

type QueryNode = Record<string, unknown>;

function keySegments(key: string): string[] {
  const head = key.match(/^[^[]+/)?.[0] ?? key;
  const rest = [...key.slice(head.length).matchAll(/\[([^\]]*)\]/g)].map(
    (match) => match[1] ?? '',
  );
  return [head, ...rest];
}

function childNode(parent: QueryNode, segment: string): QueryNode {
  const existing = parent[segment];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as QueryNode;
  }
  const created: QueryNode = {};
  parent[segment] = created;
  return created;
}

function assignParam(root: QueryNode, segments: string[], value: string): void {
  let node = root;
  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;
    const next = segments[index + 1];

    if (next === '' && index === segments.length - 2) {
      const list = Array.isArray(node[segment])
        ? (node[segment] as unknown[])
        : [];
      list.push(value);
      node[segment] = list;
      return;
    }

    if (isLast) {
      node[segment] = value;
      return;
    }

    node = childNode(node, segment);
  }
}

/** The inverse of the client's `buildNormalizedParams` (`a[b][]=c`). */
export function parseQuery(params: URLSearchParams): Record<string, unknown> {
  const root: QueryNode = {};
  for (const [key, value] of params) {
    assignParam(root, keySegments(key), value);
  }
  return root;
}

export function queryObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function queryInteger(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `/items/abc` → `abc` (also `/items/abc/validate`). */
export function itemIdFromPath(path: string): string | null {
  return path.match(/^\/items\/([^/]+)/)?.[1] ?? null;
}

/** The model ids or api keys in `filter[type]`, or null when the request has none. */
export function filterTypes(request: FakeRequest): string[] | null {
  const type = queryString(queryObject(request.query.filter).type);
  return type ? type.split(',').filter(Boolean) : null;
}
