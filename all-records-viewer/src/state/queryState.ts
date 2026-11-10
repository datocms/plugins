import { DEFAULT_PER_PAGE, PAGE_ID, PER_PAGE_OPTIONS } from '../constants';
import {
  hasStatusFilter,
  isMetaFilter,
  parseFilterConditions,
  serializeFilterConditions,
} from '../filters/filters';
import type { FilterCondition } from '../filters/types';
import type { OrderBy, QueryState, SortableColumnId } from '../types';

const PUBLICATION_STATUSES = ['draft', 'updated', 'published'];

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
  filters: [],
  locale: null,
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

// The tiles of the URL. A link from before the tiles has `status`, which
// becomes a "Status is …" tile.
function parseFilters(params: URLSearchParams): FilterCondition[] {
  const filters = parseFilterConditions(params.get('filters'));
  const status = params.get('status');
  if (
    status &&
    PUBLICATION_STATUSES.includes(status) &&
    !params.has('filters')
  ) {
    filters.push({ field: '_status', operator: 'eq', value: status });
  }
  return filters;
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
  const filters = parseFilters(params);
  const locale = params.get('locale') || null;
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
    filters,
    locale,
    orderBy: normalizedUpdatedOrder({ query, model, filters, orderBy }),
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
  const filters = serializeFilterConditions(state.filters);
  if (filters) {
    params.set('filters', filters);
  }
  if (state.locale) {
    params.set('locale', state.locale);
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
  filters: readonly FilterCondition[];
  orderBy: OrderBy | null;
}): OrderBy | null {
  if (args.query) return null;
  if (!args.model && args.orderBy?.startsWith('_preview_')) return null;
  if (args.model && args.orderBy?.startsWith('_model_')) return null;
  if (hasStatusFilter(args.filters) && args.orderBy?.startsWith('_status_')) {
    return null;
  }
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
  // The fields of a model filter only that model
  const nextFilters = (patch.filters ?? current.filters).filter(
    (condition) => nextModel === current.model || isMetaFilter(condition.field),
  );
  const nextOrderBy =
    'orderBy' in patch ? (patch.orderBy ?? null) : current.orderBy;

  return {
    ...current,
    ...patch,
    filters: nextFilters,
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
      filters: nextFilters,
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
