import type { ResolvedItemPresentationInfo } from 'datocms-plugin-sdk';
import type { RecordRowPresentation } from 'datocms-react-ui/RecordRow';
import { compactSelectedItem } from '../data/selection';
import type {
  ColumnId,
  ModelSummary,
  OrderBy,
  PublicationStatus,
  RawItem,
  RawItemType,
} from '../types';

export type RecordRow = {
  id: string;
  modelId: string;
  modelName: string;
  /**
   * The title of the record as DatoCMS presents it (see `withPresentation`),
   * or "Record #ID" until the host gives it. The table sorts and searches by it.
   */
  title: string;
  status: PublicationStatus;
  updatedAt: string;
  createdAt: string;
  /** What the record's row shows: the host's presentation, or the record's own meta. */
  presentation: RecordRowPresentation;
  /** Identity and meta only: what selection and permission checks need. */
  item: RawItem;
};

export const DEFAULT_ORDER_BY: OrderBy = '_updated_at_DESC';

export function modelSummary(itemType: RawItemType): ModelSummary {
  return {
    id: itemType.id,
    name: itemType.attributes.name,
    apiKey: itemType.attributes.api_key,
    draftModeActive: itemType.attributes.draft_mode_active,
    workflowId: itemType.relationships.workflow.data?.id ?? null,
  };
}

/** The title DatoCMS gives a record that has none, as `loadItemPresentationInfo` does. */
export function fallbackTitle(id: string): string {
  return `Record #${id}`;
}

/**
 * A record of the stage, from the API. Its title is "Record #ID" until
 * `withPresentation` gives it the one DatoCMS shows.
 */
export function buildRow(item: RawItem, itemType: RawItemType): RecordRow {
  const title = fallbackTitle(item.id);
  const status = item.meta.status ?? 'published';
  return {
    id: item.id,
    modelId: itemType.id,
    modelName: itemType.attributes.name,
    title,
    status,
    updatedAt: item.meta.updated_at,
    createdAt: item.meta.created_at,
    presentation: {
      id: item.id,
      title,
      image: null,
      itemTypeId: itemType.id,
      status,
      currentVersionValid: item.meta.is_current_version_valid ?? undefined,
      publishedVersionValid: item.meta.is_published_version_valid ?? undefined,
    },
    // The model comes from the query that listed the record.
    item: compactSelectedItem({
      ...item,
      relationships: {
        ...item.relationships,
        item_type: { data: { id: itemType.id, type: 'item_type' } },
      },
    }),
  };
}

/** The row with the title, the image and the status that DatoCMS shows for it. */
export function withPresentation(
  row: RecordRow,
  presentation: ResolvedItemPresentationInfo,
): RecordRow {
  return { ...row, title: presentation.title, presentation };
}

const collator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

/** The API's alphabetical order of statuses, as `_status_ASC` returns them. */
const STATUS_ORDER: Record<PublicationStatus, number> = {
  draft: 0,
  published: 1,
  updated: 2,
};

const COMPARATORS: Record<ColumnId, (a: RecordRow, b: RecordRow) => number> = {
  _preview: (a, b) => collator.compare(a.title, b.title),
  _model: (a, b) => collator.compare(a.modelName, b.modelName),
  _status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  _updated_at: (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt),
  _created_at: (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  id: (a, b) => collator.compare(a.id, b.id),
};

function parseOrderBy(orderBy: OrderBy): {
  column: ColumnId;
  factor: 1 | -1;
} {
  const direction = orderBy.endsWith('_ASC') ? 1 : -1;
  const column = orderBy.replace(/_(ASC|DESC)$/, '') as ColumnId;
  return { column, factor: direction };
}

/** Sorts a copy, breaking ties by most recent update, then ID. */
export function sortRows(
  rows: readonly RecordRow[],
  orderBy: OrderBy,
): RecordRow[] {
  const { column, factor } = parseOrderBy(orderBy);
  const compare = COMPARATORS[column] ?? COMPARATORS._updated_at;
  return [...rows].sort(
    (a, b) =>
      compare(a, b) * factor ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      collator.compare(a.id, b.id),
  );
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export type RowFilters = {
  query: string;
  modelId: string | null;
  status: PublicationStatus | null;
};

/** Keeps the rows that match the model, status, and the query (title, model, or ID). */
export function filterRows(
  rows: readonly RecordRow[],
  { query, modelId, status }: RowFilters,
): RecordRow[] {
  const needle = normalize(query.trim());
  return rows.filter(
    (row) =>
      (!modelId || row.modelId === modelId) &&
      (!status || row.status === status) &&
      (!needle ||
        normalize(`${row.title} ${row.modelName} ${row.id}`).includes(needle)),
  );
}

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}
