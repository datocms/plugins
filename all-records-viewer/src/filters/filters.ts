import type { RawField } from '../presentation/fields';
import type { RawItemType } from '../types';
import { FILTER_SCHEMA } from './schema';
import type {
  FilterCondition,
  FilterField,
  FilterOperators,
  FilterValue,
} from './types';

// The names of the operators, as the record list of the dashboard writes them
export const OPERATOR_LABELS: Readonly<Record<string, string>> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  not_in: 'is not one of',
  gt: 'greater than',
  lt: 'less than',
  gte: 'greater or equal',
  lte: 'less or equal',
  exists: 'is not null',
  matches: 'contains',
  not_matches: "doesn't contain",
  is_blank: 'is blank',
  is_present: 'is present',
  all_in: 'contains all',
  any_in: 'contains any of',
  near: 'near',
};

// The locales of a record are not in the schema of the filters: the dashboard
// adds this filter itself
const LOCALES_OPERATORS: FilterOperators = {
  all_in: { type: 'scalar', inputType: 'locale', array: true },
  any_in: { type: 'scalar', inputType: 'locale', array: true },
  not_in: { type: 'scalar', inputType: 'locale', array: true },
};

// The filters of every record, in the order of the dashboard
const META_FIELDS: readonly { key: string; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: '_updated_at', label: 'Updated at' },
  { key: '_created_at', label: 'Created at' },
  { key: '_published_at', label: 'Last published at' },
  { key: '_first_published_at', label: 'First published at' },
  { key: '_publication_scheduled_at', label: 'Scheduled publishing at' },
  { key: '_unpublishing_scheduled_at', label: 'Scheduled unpublishing at' },
  { key: '_status', label: 'Status' },
  { key: '_is_valid', label: 'Is valid' },
  { key: '_creator', label: 'Creator' },
  { key: '_locales', label: 'Locales' },
];

const META_KEYS = new Set([
  ...META_FIELDS.map((field) => field.key),
  'parent',
  'position',
]);

/** A filter of every record, that stays when the model changes */
export function isMetaFilter(key: string): boolean {
  return META_KEYS.has(key);
}

// The dashboard hides "is not null" where "is present" says the same
function visibleOperators(operators: FilterOperators): FilterOperators {
  if (!('is_present' in operators) || !('exists' in operators)) {
    return operators;
  }
  const { exists: _exists, ...rest } = operators;
  return rest;
}

function metaOperators(key: string): FilterOperators | undefined {
  return key === '_locales' ? LOCALES_OPERATORS : FILTER_SCHEMA.meta[key];
}

/** The name of a locale in English ("Italian"), or its code */
export function localeName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The fields that the user can filter by: the filters of every record, then,
 * with a model, its fields. A localized field filters its value in
 * `filterLocale` (the first locale of the project when there is none).
 */
export function filterFieldsFor(args: {
  itemType: RawItemType | null;
  fields: readonly RawField[];
  filterLocale: string;
}): FilterField[] {
  const result: FilterField[] = [];
  for (const { key, label } of META_FIELDS) {
    const operators = metaOperators(key);
    if (operators) result.push({ key, label, operators });
  }
  if (!args.itemType) return result;

  if (args.itemType.attributes.tree) {
    result.push({
      key: 'parent',
      label: 'Parent',
      operators: FILTER_SCHEMA.meta.parent,
    });
  }
  if (args.itemType.attributes.tree || args.itemType.attributes.sortable) {
    result.push({
      key: 'position',
      label: 'Position',
      operators: FILTER_SCHEMA.meta.position,
    });
  }

  const fields = [...args.fields].sort(
    (left, right) => left.attributes.position - right.attributes.position,
  );
  for (const field of fields) {
    const operators = FILTER_SCHEMA.fieldTypes[field.attributes.field_type];
    if (!operators) continue;
    result.push({
      key: field.attributes.api_key,
      label: field.attributes.localized
        ? `${field.attributes.label} (${localeName(args.filterLocale)})`
        : field.attributes.label,
      operators: visibleOperators(operators),
    });
  }
  return result;
}

/** The `fields` of the filter of the CMA, from the tiles that have a value */
export function cmaFieldFilters(
  conditions: readonly FilterCondition[],
): Record<string, Record<string, FilterValue>> {
  const result: Record<string, Record<string, FilterValue>> = {};
  for (const { field, operator, value } of conditions) {
    if (value === null) continue;
    result[field] = { ...result[field], [operator]: value };
  }
  return result;
}

/** A status filter makes the status of the rows known: they don't sort by it */
export function hasStatusFilter(
  conditions: readonly FilterCondition[],
): boolean {
  return conditions.some(
    (condition) => condition.field === '_status' && condition.value !== null,
  );
}

/** Some tiles have a value: the list is filtered */
export function hasActiveFilters(
  conditions: readonly FilterCondition[],
): boolean {
  return conditions.some((condition) => condition.value !== null);
}

const NAME = /^[a-z0-9_]+$/;

function isFilterValue(value: unknown, depth = 0): value is FilterValue {
  if (depth > 3) return false;
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isFilterValue(entry, depth + 1));
  }
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.entries(value).every(
      ([key, entry]) => NAME.test(key) && isFilterValue(entry, depth + 1),
    )
  );
}

/** The tiles in the URL of the page, keeping only the well-formed ones */
export function parseFilterConditions(raw: string | null): FilterCondition[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const result: FilterCondition[] = [];
  for (const entry of parsed) {
    if (!Array.isArray(entry) || entry.length !== 3) continue;
    const [field, operator, value] = entry as unknown[];
    if (
      typeof field === 'string' &&
      NAME.test(field) &&
      typeof operator === 'string' &&
      NAME.test(operator) &&
      (value === null || isFilterValue(value))
    ) {
      result.push({ field, operator, value });
    }
  }
  return result;
}

/** The tiles for the URL of the page: a list of [field, operator, value] */
export function serializeFilterConditions(
  conditions: readonly FilterCondition[],
): string | null {
  return conditions.length === 0
    ? null
    : JSON.stringify(
        conditions.map(({ field, operator, value }) => [
          field,
          operator,
          value,
        ]),
      );
}
