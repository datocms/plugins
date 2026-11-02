import type { TableLayout } from 'datocms-react-ui/Table';
import type { ColumnId, ColumnSetting } from '../types';

export const MIN_COLUMN_WIDTH = 0.05;

export const ALL_COLUMN_IDS: readonly ColumnId[] = [
  '_preview',
  '_model',
  '_status',
  '_updated_at',
  '_created_at',
  'id',
];

// Status and Last update get the room of "Unpublished changes" and of a full
// date on a 1000px page. A stored layout keeps its own widths.
export const DEFAULT_COLUMN_SETTINGS: readonly ColumnSetting[] = [
  { id: '_preview', width: 0.38 },
  { id: '_model', width: 0.16 },
  { id: '_status', width: 0.21 },
  { id: '_updated_at', width: 0.25 },
];

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function isColumnId(value: unknown): value is ColumnId {
  return (
    typeof value === 'string' && ALL_COLUMN_IDS.includes(value as ColumnId)
  );
}

function isColumnSetting(value: unknown): value is ColumnSetting {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ColumnSetting>;
  return (
    isColumnId(candidate.id) &&
    typeof candidate.width === 'number' &&
    Number.isFinite(candidate.width) &&
    candidate.width > 0
  );
}

function normalizedWidths(columns: readonly ColumnSetting[]): ColumnSetting[] {
  const total = columns.reduce((sum, column) => sum + column.width, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return DEFAULT_COLUMN_SETTINGS.map((column) => ({ ...column }));
  }

  const normalized = columns.map((column) => ({
    ...column,
    width: column.width / total,
  }));

  // Correct floating point drift on the last column so the table always
  // occupies its full width.
  const correction =
    1 - normalized.reduce((sum, column) => sum + column.width, 0);
  normalized[normalized.length - 1].width += correction;
  return normalized;
}

export function normalizeColumnSettings(value: unknown): ColumnSetting[] {
  if (!Array.isArray(value)) {
    return DEFAULT_COLUMN_SETTINGS.map((column) => ({ ...column }));
  }

  const seen = new Set<ColumnId>();
  const valid = value.filter((entry): entry is ColumnSetting => {
    if (!isColumnSetting(entry) || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });

  if (valid.length === 0) {
    return DEFAULT_COLUMN_SETTINGS.map((column) => ({ ...column }));
  }

  const normalized = normalizedWidths(valid);
  if (normalized.some((column) => column.width < MIN_COLUMN_WIDTH)) {
    return DEFAULT_COLUMN_SETTINGS.map((column) => ({ ...column }));
  }

  return normalized;
}

// The kit's Table keeps its layout as { columns: [{ name, width }] }; the
// stored setting stays an array of { id, width }. The two adapters below
// convert between them in memory only.

export function toTableLayout(columns: readonly ColumnSetting[]): TableLayout {
  return {
    columns: columns.map((column) => ({
      name: column.id,
      width: column.width,
    })),
  };
}

// A hair above the minimum, so that the division by a total of 1 ± rounding
// in normalizeColumnSettings never puts a column under MIN_COLUMN_WIDTH (which
// would reset the whole layout to the defaults).
const MIN_LAYOUT_WIDTH = MIN_COLUMN_WIDTH + 1e-6;

// Widths that sum to 1 with none under the minimum: the columns under it get
// the minimum, and the others share the rest in their own proportions.
function widthsWithMinimum(widths: readonly number[]): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return widths.map(() => 1 / widths.length);
  }

  const pinned = new Set<number>();
  let result = widths.map((width) => width / total);
  while (pinned.size < widths.length) {
    const freeTotal = widths.reduce(
      (sum, width, index) => (pinned.has(index) ? sum : sum + width),
      0,
    );
    const budget = 1 - pinned.size * MIN_LAYOUT_WIDTH;
    result = widths.map((width, index) =>
      pinned.has(index) || freeTotal <= 0
        ? MIN_LAYOUT_WIDTH
        : (width / freeTotal) * budget,
    );
    const under = result.flatMap((width, index) =>
      !pinned.has(index) && width < MIN_LAYOUT_WIDTH ? [index] : [],
    );
    if (under.length === 0) break;
    for (const index of under) pinned.add(index);
  }

  return result;
}

export function fromTableLayout(layout: TableLayout): ColumnSetting[] {
  const seen = new Set<ColumnId>();
  const columns: ColumnSetting[] = [];
  for (const { name, width } of layout.columns) {
    if (!isColumnId(name) || seen.has(name)) continue;
    seen.add(name);
    columns.push({
      id: name,
      width: Number.isFinite(width) && width > 0 ? width : 0,
    });
  }

  if (columns.length === 0) {
    return DEFAULT_COLUMN_SETTINGS.map((column) => ({ ...column }));
  }

  const widths = widthsWithMinimum(columns.map((column) => column.width));
  return columns.map((column, index) => ({
    id: column.id,
    width: widths[index],
  }));
}

export function columnSettingsStorageKey({
  siteId,
  environment,
  userId,
}: {
  siteId: string;
  environment: string;
  userId: string;
}): string {
  return `datocms-all-records:${siteId}:${environment}:${userId}:columns`;
}

export function loadColumnSettings(
  storage: StorageLike,
  key: string,
): ColumnSetting[] {
  try {
    const stored = storage.getItem(key);
    return stored
      ? normalizeColumnSettings(JSON.parse(stored))
      : normalizeColumnSettings(null);
  } catch {
    return normalizeColumnSettings(null);
  }
}

export function saveColumnSettings(
  storage: StorageLike,
  key: string,
  columns: readonly ColumnSetting[],
): ColumnSetting[] {
  const normalized = normalizeColumnSettings(columns);
  try {
    storage.setItem(key, JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable in privacy mode. The in-memory setting is
    // still valid and should remain usable for the current session.
  }
  return normalized;
}
