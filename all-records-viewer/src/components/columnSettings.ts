import type { ColumnId, ColumnSetting } from '../types';

export const MIN_COLUMN_WIDTH = 0.05;
export const ADDED_COLUMN_WIDTH = 0.15;

export const ALL_COLUMN_IDS: readonly ColumnId[] = [
  '_preview',
  '_model',
  '_status',
  '_updated_at',
  '_created_at',
  'id',
];

export const DEFAULT_COLUMN_SETTINGS: readonly ColumnSetting[] = [
  { id: '_preview', width: 0.45 },
  { id: '_model', width: 0.2 },
  { id: '_status', width: 0.15 },
  { id: '_updated_at', width: 0.2 },
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

export function toggleColumn(
  columns: readonly ColumnSetting[],
  columnId: ColumnId,
): ColumnSetting[] {
  const current = normalizeColumnSettings(columns);
  const existingIndex = current.findIndex((column) => column.id === columnId);

  if (existingIndex >= 0) {
    if (current.length === 1) return current;
    const removedWidth = current[existingIndex].width;
    const share = removedWidth / (current.length - 1);
    return current
      .filter((_, index) => index !== existingIndex)
      .map((column) => ({ ...column, width: column.width + share }));
  }

  const totalShrinkCapacity = current.reduce(
    (total, column) => total + (column.width - MIN_COLUMN_WIDTH),
    0,
  );
  return [
    ...current.map((column) => ({
      ...column,
      width:
        column.width -
        (ADDED_COLUMN_WIDTH * (column.width - MIN_COLUMN_WIDTH)) /
          totalShrinkCapacity,
    })),
    { id: columnId, width: ADDED_COLUMN_WIDTH },
  ];
}

export function reorderColumn(
  columns: readonly ColumnSetting[],
  sourceId: ColumnId,
  targetId: ColumnId,
): ColumnSetting[] {
  const current = normalizeColumnSettings(columns);
  const sourceIndex = current.findIndex((column) => column.id === sourceId);
  const targetIndex = current.findIndex((column) => column.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return current;
  }

  const reordered = [...current];
  const [source] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, source);
  return reordered;
}

export function resizeAdjacentColumns(
  columns: readonly ColumnSetting[],
  leftIndex: number,
  delta: number,
): ColumnSetting[] {
  const current = normalizeColumnSettings(columns);
  const rightIndex = leftIndex + 1;
  if (
    leftIndex < 0 ||
    rightIndex >= current.length ||
    !Number.isFinite(delta)
  ) {
    return current;
  }

  const clampedDelta = Math.max(
    MIN_COLUMN_WIDTH - current[leftIndex].width,
    Math.min(current[rightIndex].width - MIN_COLUMN_WIDTH, delta),
  );
  const left = current[leftIndex].width + clampedDelta;
  const right = current[rightIndex].width - clampedDelta;

  return current.map((column, index) => {
    if (index === leftIndex) return { ...column, width: left };
    if (index === rightIndex) return { ...column, width: right };
    return column;
  });
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
