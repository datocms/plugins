import { DEFAULT_PER_PAGE, PAGE_ID, PER_PAGE_OPTIONS } from '../constants';
import type {
  OrderBy,
  PublicationStatus,
  QueryState,
  SortableColumnId,
} from '../types';

const PUBLICATION_STATUSES: PublicationStatus[] = [
  'draft',
  'updated',
  'published',
];

const SORTABLE_COLUMNS: SortableColumnId[] = [
  '_preview',
  '_model',
  '_status',
  '_updated_at',
  '_created_at',
  'id',
];

export const DEFAULT_QUERY_STATE: QueryState = {
  page: 0,
  perPage: DEFAULT_PER_PAGE,
  query: '',
  model: null,
  status: null,
  orderBy: null,
};

function parseNonNegativeInteger(
  value: string | null,
  fallback: number,
): number {
  if (value === null || !/^\d+$/.test(value)) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function parseStatus(value: string | null): PublicationStatus | null {
  return PUBLICATION_STATUSES.includes(value as PublicationStatus)
    ? (value as PublicationStatus)
    : null;
}

export function isOrderBy(value: string | null): value is OrderBy {
  if (!value) {
    return false;
  }

  const match = value.match(/^(.+)_(ASC|DESC)$/);
  return Boolean(
    match && SORTABLE_COLUMNS.includes(match[1] as SortableColumnId),
  );
}

export function parseQueryState(search: string): QueryState {
  const params = new URLSearchParams(search);
  const requestedPerPage = parseNonNegativeInteger(
    params.get('perPage'),
    DEFAULT_PER_PAGE,
  );
  const query = params.get('query')?.trim() ?? '';
  const model = params.get('model') || null;
  const status = parseStatus(params.get('status'));
  const rawOrderBy = params.get('orderBy');
  const orderBy = isOrderBy(rawOrderBy) ? rawOrderBy : null;

  return {
    page: parseNonNegativeInteger(params.get('page'), 0),
    perPage: PER_PAGE_OPTIONS.includes(
      requestedPerPage as (typeof PER_PAGE_OPTIONS)[number],
    )
      ? requestedPerPage
      : DEFAULT_PER_PAGE,
    query,
    model,
    status,
    orderBy: normalizedUpdatedOrder({ query, model, status, orderBy }),
  };
}

export function serializeQueryState(state: QueryState): string {
  const params = new URLSearchParams();

  if (state.page > 0) {
    params.set('page', String(state.page));
  }
  if (state.perPage !== DEFAULT_PER_PAGE) {
    params.set('perPage', String(state.perPage));
  }
  if (state.query) {
    params.set('query', state.query);
  }
  if (state.model) {
    params.set('model', state.model);
  }
  if (state.status) {
    params.set('status', state.status);
  }
  const orderBy = normalizedUpdatedOrder(state);
  if (orderBy) {
    params.set('orderBy', orderBy);
  }

  const value = params.toString();
  return value ? `?${value}` : '';
}

export function buildPluginPageUrl(args: {
  environment: string;
  isEnvironmentPrimary: boolean;
  pluginId: string;
  state: QueryState;
}): string {
  const environmentPrefix = args.isEnvironmentPrimary
    ? ''
    : `/environments/${args.environment}`;

  return `${environmentPrefix}/editor/p/${args.pluginId}/pages/${PAGE_ID}${serializeQueryState(args.state)}`;
}

function normalizedUpdatedOrder(args: {
  query: string;
  model: string | null;
  status: PublicationStatus | null;
  orderBy: OrderBy | null;
}): OrderBy | null {
  if (args.query) return null;
  if (!args.model && args.orderBy?.startsWith('_preview_')) return null;
  if (args.model && args.orderBy?.startsWith('_model_')) return null;
  if (args.status && args.orderBy?.startsWith('_status_')) return null;
  return args.orderBy;
}

export function updateQueryState(
  current: QueryState,
  patch: Partial<QueryState>,
): QueryState {
  const resetsPage = Object.keys(patch).some(
    (key) => key !== 'page' && key !== 'query',
  );
  const nextQuery = patch.query ?? current.query;
  const nextModel = 'model' in patch ? (patch.model ?? null) : current.model;
  const nextStatus =
    'status' in patch ? (patch.status ?? null) : current.status;
  const nextOrderBy =
    'orderBy' in patch ? (patch.orderBy ?? null) : current.orderBy;

  return {
    ...current,
    ...patch,
    page:
      patch.page !== undefined
        ? Math.max(0, patch.page)
        : resetsPage || patch.query !== undefined
          ? 0
          : current.page,
    query: nextQuery,
    orderBy: normalizedUpdatedOrder({
      query: nextQuery,
      model: nextModel,
      status: nextStatus,
      orderBy: nextOrderBy,
    }),
  };
}

export function clampPage(
  page: number,
  totalCount: number,
  perPage: number,
): number {
  if (totalCount <= 0) {
    return 0;
  }

  return Math.min(page, Math.ceil(totalCount / perPage) - 1);
}
