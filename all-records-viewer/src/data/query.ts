import type { Client, RawApiTypes } from '@datocms/cma-client-browser';
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS } from '../constants';
import type { OrderBy, PublicationStatus, QueryState, RawItem } from '../types';

export const DEFAULT_ORDER_BY: OrderBy = '_updated_at_DESC';

const ORDER_BY_VALUES = new Set<OrderBy>([
  '_preview_ASC',
  '_preview_DESC',
  '_model_ASC',
  '_model_DESC',
  '_status_ASC',
  '_status_DESC',
  '_updated_at_ASC',
  '_updated_at_DESC',
  '_created_at_ASC',
  '_created_at_DESC',
  'id_ASC',
  'id_DESC',
]);

const PUBLICATION_STATUSES = new Set<PublicationStatus>([
  'draft',
  'updated',
  'published',
]);

export type ItemsPage = {
  items: RawItem[];
  totalCount: number;
};

export type ItemsListQuery = RawApiTypes.ItemInstancesHrefSchema & {
  nested: false;
  page: { offset: number; limit: number };
};

function toNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const integer = Math.max(0, Math.floor(value));
    return Number.isSafeInteger(integer) ? integer : fallback;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const integer = Number.parseInt(value, 10);
    return Number.isSafeInteger(integer) ? integer : fallback;
  }

  return fallback;
}

export function parseOrderBy(value: unknown): OrderBy | null {
  return typeof value === 'string' && ORDER_BY_VALUES.has(value as OrderBy)
    ? (value as OrderBy)
    : null;
}

export function parsePublicationStatus(
  value: unknown,
): PublicationStatus | null {
  return typeof value === 'string' &&
    PUBLICATION_STATUSES.has(value as PublicationStatus)
    ? (value as PublicationStatus)
    : null;
}

export function normalizeQueryState(state: Partial<QueryState>): QueryState {
  const parsedPerPage = toNonNegativeInteger(state.perPage, DEFAULT_PER_PAGE);
  const perPage = PER_PAGE_OPTIONS.includes(
    parsedPerPage as (typeof PER_PAGE_OPTIONS)[number],
  )
    ? parsedPerPage
    : DEFAULT_PER_PAGE;

  const model =
    typeof state.model === 'string' && state.model.trim()
      ? state.model.trim()
      : null;
  const orderBy = parseOrderBy(state.orderBy);
  const status = parsePublicationStatus(state.status);
  const orderIsUnavailable =
    orderBy !== null &&
    ((!model && orderBy.startsWith('_preview_')) ||
      (model !== null && orderBy.startsWith('_model_')) ||
      (status !== null && orderBy.startsWith('_status_')));

  return {
    page: Math.min(
      toNonNegativeInteger(state.page, 0),
      Math.floor(Number.MAX_SAFE_INTEGER / perPage),
    ),
    perPage,
    query: typeof state.query === 'string' ? state.query.trim() : '',
    model,
    status,
    orderBy: orderIsUnavailable ? null : orderBy,
  };
}

export function buildItemsListQuery(
  rawState: Partial<QueryState>,
  serverOrderBy?: string,
): ItemsListQuery {
  const state = normalizeQueryState(rawState);
  const fields: Record<string, Record<string, unknown>> = {
    _created_at: { exists: true },
  };

  if (state.status) {
    fields._status = { eq: state.status };
  }

  const filter: Record<string, unknown> = { fields };

  if (state.model) {
    filter.type = state.model;
  }

  if (state.query) {
    filter.query = state.query;
  }

  const needsResolvedOrder =
    state.orderBy?.startsWith('_preview_') ||
    state.orderBy?.startsWith('_model_') ||
    (!state.model && state.orderBy?.startsWith('_status_'));
  const requestedOrderBy =
    serverOrderBy ??
    (needsResolvedOrder
      ? DEFAULT_ORDER_BY
      : (state.orderBy ?? DEFAULT_ORDER_BY));
  const stableOrderBy =
    requestedOrderBy !== 'id_ASC' &&
    requestedOrderBy !== 'id_DESC' &&
    !requestedOrderBy.includes(',')
      ? `${requestedOrderBy},id_ASC`
      : requestedOrderBy;

  return {
    nested: false,
    version: 'current',
    page: {
      offset: state.page * state.perPage,
      limit: state.perPage,
    },
    filter,
    // Text search deliberately keeps the API relevance order.
    ...(state.query ? {} : { order_by: stableOrderBy }),
  } as ItemsListQuery;
}

type ItemsClient = Pick<Client, 'items'>;

export function throwIfItemsRequestAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The record request was cancelled.', 'AbortError');
  }
}

/** The SDK has no per-call signal; observe the in-flight result and stop subsequent work. */
export function waitForItemsRequest<T>(
  request: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return request;

  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(
        new DOMException('The record request was cancelled.', 'AbortError'),
      );
    signal.addEventListener('abort', abort, { once: true });
    request.then(
      (result) => {
        signal.removeEventListener('abort', abort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

export function itemsPageTotal(
  response: { data: readonly { id: string }[]; meta: { total_count: number } },
  offset: number,
  limit: number,
): number {
  const total = response.meta?.total_count;
  if (
    !Array.isArray(response.data) ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    response.data.length > limit ||
    response.data.some((item) => !item?.id)
  ) {
    throw new Error(
      'The API returned an incomplete record page. Refresh the view.',
    );
  }
  if (limit > 0 && response.data.length === 0 && offset < total) {
    throw new Error(
      'The API returned an empty page before its record total. Refresh the view.',
    );
  }
  if (response.data.length > 0 && offset + response.data.length > total) {
    throw new Error(
      'The API returned a page beyond its record total. Refresh the view.',
    );
  }
  return total;
}

export async function fetchItemsPage(
  client: ItemsClient,
  state: Partial<QueryState>,
  serverOrderBy?: string,
  signal?: AbortSignal,
): Promise<ItemsPage> {
  const query = buildItemsListQuery(state, serverOrderBy);
  const offset = query.page.offset;
  const limit = query.page.limit;
  const items: RawItem[] = [];
  const ids = new Set<string>();
  let totalCount = 0;

  do {
    throwIfItemsRequestAborted(signal);
    const currentOffset = offset + items.length;
    const currentLimit = limit - items.length;
    // biome-ignore lint/performance/noAwaitInLoops: Short responses are completed from the actual last offset.
    const response = await waitForItemsRequest(
      client.items.rawList({
        ...query,
        page: { offset: currentOffset, limit: currentLimit },
      }),
      signal,
    );
    throwIfItemsRequestAborted(signal);
    totalCount = itemsPageTotal(response, currentOffset, currentLimit);
    for (const item of response.data) {
      if (ids.has(item.id)) {
        throw new Error(
          'Records changed while this page was loading. Refresh the view.',
        );
      }
      ids.add(item.id);
      items.push(item);
    }
  } while (items.length < limit && offset + items.length < totalCount);

  return { items, totalCount };
}
