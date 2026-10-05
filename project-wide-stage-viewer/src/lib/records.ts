import type { RawApiTypes } from '@datocms/cma-client-browser';
import { compactSelectedItem } from '../data/selection';
import type {
  ColumnId,
  ModelSummary,
  OrderBy,
  PublicationStatus,
  RawItem,
  RawItemType,
} from '../types';
import {
  formatTitle,
  getImageField,
  getTitleField,
  isLinkField,
  linkedItemIdFromValue,
  readFieldValue,
  type TitleOptions,
  uploadIdFromValue,
} from './presentation';

type Field = RawApiTypes.Field;

export type RecordRow = {
  id: string;
  modelId: string;
  modelName: string;
  title: string;
  status: PublicationStatus;
  updatedAt: string;
  createdAt: string;
  publishedValid: boolean | null;
  currentValid: boolean | null;
  draftModeActive: boolean;
  /** The upload behind the record's preview image, if it has one. */
  imageUploadId: string | null;
  /**
   * Set while the title comes from a linked record that isn't loaded yet
   * (see resolveLinkedTitles); the title is a placeholder until then.
   */
  titleLinkId: string | null;
  /** Identity and meta only: what selection and permission checks need. */
  item: RawItem;
};

export type ModelPresentation = {
  itemType: RawItemType;
  titleField: Field | undefined;
  imageField: Field | undefined;
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

export function buildModelPresentation(
  itemType: RawItemType,
  fields: readonly Field[],
): ModelPresentation {
  return {
    itemType,
    titleField: getTitleField(itemType, fields),
    imageField: getImageField(itemType, fields),
  };
}

export function buildRow(
  item: RawItem,
  model: ModelPresentation,
  options: TitleOptions,
): RecordRow {
  const { itemType, titleField, imageField } = model;
  const { locales } = options;
  const attributes = item.attributes as Record<string, unknown>;
  const titleValue = titleField
    ? readFieldValue(attributes, titleField, locales)
    : null;
  const title = titleField
    ? formatTitle(titleValue, titleField, options)
    : null;

  return {
    id: item.id,
    modelId: itemType.id,
    modelName: itemType.attributes.name,
    title: title ?? `Record #${item.id}`,
    status: item.meta.status ?? 'published',
    updatedAt: item.meta.updated_at,
    createdAt: item.meta.created_at,
    publishedValid: item.meta.is_published_version_valid,
    currentValid: item.meta.is_current_version_valid,
    draftModeActive: itemType.attributes.draft_mode_active,
    imageUploadId: imageField
      ? uploadIdFromValue(readFieldValue(attributes, imageField, locales))
      : null,
    titleLinkId:
      titleField && isLinkField(titleField)
        ? linkedItemIdFromValue(titleValue)
        : null,
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
