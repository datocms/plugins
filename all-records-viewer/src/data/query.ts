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
};

function toNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Math.max(0, Number.parseInt(value, 10));
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
    page: toNonNegativeInteger(state.page, 0),
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
    !state.model &&
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

export async function fetchItemsPage(
  client: ItemsClient,
  state: Partial<QueryState>,
  serverOrderBy?: string,
): Promise<ItemsPage> {
  const response = await client.items.rawList(
    buildItemsListQuery(state, serverOrderBy),
  );

  return {
    items: response.data,
    totalCount:
      typeof response.meta.total_count === 'number'
        ? response.meta.total_count
        : response.data.length,
  };
}
