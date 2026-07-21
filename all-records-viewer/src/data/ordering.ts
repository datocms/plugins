import {
  getPresentationTitleField,
  type RawField,
} from '../presentation/fields';
import type { ColumnId, OrderBy, RawItemType } from '../types';

const SORTABLE_PREVIEW_FIELD_TYPES = new Set([
  'string',
  'date',
  'date_time',
  'boolean',
  'integer',
  'float',
]);

const ALWAYS_SORTABLE_COLUMNS: readonly ColumnId[] = [
  '_updated_at',
  '_created_at',
  'id',
];

function direction(orderBy: OrderBy): 'ASC' | 'DESC' {
  return orderBy.endsWith('_ASC') ? 'ASC' : 'DESC';
}

export function previewOrderingField(
  itemType: RawItemType,
  fields: readonly RawField[],
): RawField | null {
  const field = getPresentationTitleField(itemType, fields);
  return field && SORTABLE_PREVIEW_FIELD_TYPES.has(field.attributes.field_type)
    ? field
    : null;
}

export function sortableColumnIds(args: {
  itemType: RawItemType | null;
  fields: readonly RawField[];
  fieldsLoaded: boolean;
}): ReadonlySet<ColumnId> {
  const result = new Set<ColumnId>(ALWAYS_SORTABLE_COLUMNS);
  if (!args.itemType) {
    result.add('_model');
    result.add('_status');
    return result;
  }

  result.add('_status');
  if (
    args.fieldsLoaded &&
    previewOrderingField(args.itemType, args.fields) !== null
  ) {
    result.add('_preview');
  }

  return result;
}

export function serverOrderBy(args: {
  orderBy: OrderBy;
  itemType: RawItemType | null;
  fields: readonly RawField[];
}): string | null {
  if (args.orderBy.startsWith('_preview_')) {
    if (!args.itemType) return null;
    const field = previewOrderingField(args.itemType, args.fields);
    return field
      ? `${field.attributes.api_key}_${direction(args.orderBy)}`
      : null;
  }

  if (args.orderBy.startsWith('_model_')) {
    return '_updated_at_DESC,id_ASC';
  }

  if (args.orderBy.startsWith('_status_')) {
    return args.itemType ? args.orderBy : '_updated_at_DESC,id_ASC';
  }

  if (args.itemType || args.orderBy.startsWith('id_')) {
    return args.orderBy;
  }

  return `${args.orderBy},id_ASC`;
}
