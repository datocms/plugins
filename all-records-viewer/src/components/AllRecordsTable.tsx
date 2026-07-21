import {
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ColumnId, ColumnSetting, OrderBy } from '../types';
import styles from './AllRecordsTable.module.css';
import { ColumnSettingsMenu } from './ColumnSettingsMenu';
import {
  normalizeColumnSettings,
  reorderColumn,
  resizeAdjacentColumns,
} from './columnSettings';
import { StatusDot } from './StatusDot';
import type {
  ColumnSettingsHandler,
  TableColumn,
  TableRecord,
  TableSortHandler,
} from './types';
import { ValidityIndicators } from './ValidityIndicators';

const TABLE_COLUMN_BY_ID: Record<ColumnId, TableColumn> = {
  _preview: { id: '_preview', label: 'Preview', sortable: true },
  _model: { id: '_model', label: 'Model', sortable: true },
  _status: { id: '_status', label: 'Status', sortable: true },
  _updated_at: { id: '_updated_at', label: 'Last update', sortable: true },
  _created_at: { id: '_created_at', label: 'Created', sortable: true },
  id: { id: 'id', label: 'ID', sortable: true },
};

export const TABLE_COLUMNS: readonly TableColumn[] =
  Object.values(TABLE_COLUMN_BY_ID);

export type AllRecordsTableProps = {
  columns: readonly ColumnSetting[];
  rows: readonly TableRecord[];
  selectedIds: ReadonlySet<string>;
  orderBy: OrderBy | null;
  onColumnsChange: ColumnSettingsHandler;
  onOrderByChange: TableSortHandler;
  onToggleRow: (id: string) => void;
  onTogglePage: (selected: boolean) => void;
  onOpenRow: (row: TableRecord) => void;
  loading?: boolean;
  disabled?: boolean;
  sortingDisabled?: boolean;
  emptyState?: ReactNode;
  sortableColumnIds?: ReadonlySet<ColumnId>;
};

function orderDirection(orderBy: OrderBy | null, columnId: ColumnId) {
  if (!orderBy?.startsWith(`${columnId}_`)) return null;
  return orderBy.endsWith('_ASC') ? 'ASC' : 'DESC';
}

const SKELETON_ROW_IDS = [
  'skeleton-1',
  'skeleton-2',
  'skeleton-3',
  'skeleton-4',
  'skeleton-5',
  'skeleton-6',
] as const;

function nextOrder(
  orderBy: OrderBy | null,
  columnId: ColumnId,
): OrderBy | null {
  const direction = orderDirection(orderBy, columnId);
  if (!direction) return `${columnId}_ASC` as OrderBy;
  if (direction === 'ASC') return `${columnId}_DESC` as OrderBy;
  return null;
}

function statusLabel(status: TableRecord['status']): ReactNode {
  if (status === 'published') return 'Published';
  if (status === 'updated') return 'Unpublished changes';
  return 'Draft';
}

function HeaderCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all records on this page"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

function cellContent(row: TableRecord, columnId: ColumnId) {
  switch (columnId) {
    case '_preview':
      return (
        <div className={styles.titleCell}>
          {row.imageUrl && (
            <img
              className={styles.titleImage}
              src={row.imageUrl}
              alt={row.imageAlt ?? ''}
            />
          )}
          <div className={styles.titleText}>
            {row.title}
            <ValidityIndicators
              publishedValid={row.publishedValid}
              currentValid={row.currentValid}
              draftModeActive={row.draftModeActive}
            />
          </div>
        </div>
      );
    case '_model':
      return <div className={styles.truncated}>{row.model}</div>;
    case '_status':
      return (
        <div className={styles.statusCell}>
          <StatusDot status={row.status} />
          <span className={styles.truncated}>
            {row.statusLabel ?? statusLabel(row.status)}
          </span>
        </div>
      );
    case '_updated_at':
      return <div className={styles.truncated}>{row.updatedAt}</div>;
    case '_created_at':
      return <div className={styles.truncated}>{row.createdAt}</div>;
    case 'id':
      return <div className={styles.id}>{row.id}</div>;
  }
}

type HeaderColumnProps = {
  column: ColumnSetting;
  index: number;
  columnCount: number;
  orderBy: OrderBy | null;
  draggedColumn: ColumnId | null;
  dragTarget: ColumnId | null;
  disabled: boolean;
  loading: boolean;
  sortingDisabled: boolean;
  sortable: boolean;
  onDragStart: (
    event: DragEvent<HTMLButtonElement>,
    columnId: ColumnId,
  ) => void;
  onDragEnd: () => void;
  onDragOver: (columnId: ColumnId) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>, columnId: ColumnId) => void;
  onReorderKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    columnId: ColumnId,
    index: number,
  ) => void;
  onResizeStart: (
    event: PointerEvent<HTMLButtonElement>,
    index: number,
  ) => void;
  onResizeKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => void;
  onOrderByChange: TableSortHandler;
};

function ariaSortValue(
  sortable: boolean,
  direction: 'ASC' | 'DESC' | null,
): 'ascending' | 'descending' | 'none' | undefined {
  if (!sortable) return undefined;
  if (direction === 'ASC') return 'ascending';
  if (direction === 'DESC') return 'descending';
  return 'none';
}

function HeaderColumnLabel({
  definition,
  sortable,
  direction,
  disabled,
  loading,
  sortingDisabled,
  orderBy,
  onOrderByChange,
}: {
  definition: TableColumn;
  sortable: boolean;
  direction: 'ASC' | 'DESC' | null;
  disabled: boolean;
  loading: boolean;
  sortingDisabled: boolean;
  orderBy: OrderBy | null;
  onOrderByChange: TableSortHandler;
}) {
  if (!sortable) {
    return definition.label;
  }

  return (
    <button
      type="button"
      className={styles.sortButton}
      disabled={disabled || loading || sortingDisabled}
      title={
        sortingDisabled ? 'Sorting is unavailable while searching' : undefined
      }
      onClick={() => onOrderByChange(nextOrder(orderBy, definition.id))}
    >
      {definition.label}
      {direction && (
        <span className={styles.direction}>
          {direction === 'ASC' ? '▲' : '▼'}
        </span>
      )}
    </button>
  );
}

function HeaderColumn({
  column,
  index,
  columnCount,
  orderBy,
  draggedColumn,
  dragTarget,
  disabled,
  loading,
  sortingDisabled,
  sortable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onReorderKeyDown,
  onResizeStart,
  onResizeKeyDown,
  onOrderByChange,
}: HeaderColumnProps) {
  const definition = TABLE_COLUMN_BY_ID[column.id];
  const direction = orderDirection(orderBy, column.id);

  return (
    <div
      className={`${styles.headerCell} ${
        draggedColumn === column.id ? styles.dragging : ''
      } ${dragTarget === column.id ? styles.dragTarget : ''}`}
      role="columnheader"
      aria-sort={ariaSortValue(sortable, direction)}
      style={{ width: `${column.width * 100}%` }}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver(column.id);
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => onDrop(event, column.id)}
    >
      <button
        type="button"
        draggable
        className={styles.reorder}
        aria-label={`Move ${definition.label} column`}
        title={`Drag to move ${definition.label}`}
        onDragStart={(event) => onDragStart(event, column.id)}
        onDragEnd={onDragEnd}
        onKeyDown={(event) => onReorderKeyDown(event, column.id, index)}
      >
        <svg aria-hidden="true" viewBox="0 0 32 64">
          <circle cx="8" cy="8" r="5" />
          <circle cx="24" cy="8" r="5" />
          <circle cx="8" cy="32" r="5" />
          <circle cx="24" cy="32" r="5" />
          <circle cx="8" cy="56" r="5" />
          <circle cx="24" cy="56" r="5" />
        </svg>
      </button>
      <div className={styles.headerCellContent}>
        <HeaderColumnLabel
          definition={definition}
          sortable={sortable}
          direction={direction}
          disabled={disabled}
          loading={loading}
          sortingDisabled={sortingDisabled}
          orderBy={orderBy}
          onOrderByChange={onOrderByChange}
        />
      </div>
      {index < columnCount - 1 && (
        <button
          type="button"
          className={styles.resize}
          aria-label={`Resize ${definition.label} column`}
          title="Use Left and Right arrows to resize; hold Shift for larger steps"
          onPointerDown={(event) => onResizeStart(event, index)}
          onKeyDown={(event) => onResizeKeyDown(event, index)}
        />
      )}
    </div>
  );
}

export function AllRecordsTable({
  columns,
  rows,
  selectedIds,
  orderBy,
  onColumnsChange,
  onOrderByChange,
  onToggleRow,
  onTogglePage,
  onOpenRow,
  loading = false,
  disabled = false,
  sortingDisabled = false,
  emptyState = 'No records match the current filters.',
  sortableColumnIds,
}: AllRecordsTableProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const [displayColumns, setDisplayColumns] = useState(() =>
    normalizeColumnSettings(columns),
  );
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const [dragTarget, setDragTarget] = useState<ColumnId | null>(null);

  useEffect(() => {
    setDisplayColumns(normalizeColumnSettings(columns));
  }, [columns]);

  const pageSelectedCount = rows.reduce(
    (count, row) => count + Number(selectedIds.has(row.id)),
    0,
  );
  const allPageSelected = rows.length > 0 && pageSelectedCount === rows.length;
  const somePageSelected = pageSelectedCount > 0 && !allPageSelected;

  function handleHeaderDragStart(
    event: DragEvent<HTMLButtonElement>,
    columnId: ColumnId,
  ) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', columnId);
    setDraggedColumn(columnId);
  }

  function handleHeaderDrop(
    event: DragEvent<HTMLDivElement>,
    targetId: ColumnId,
  ) {
    event.preventDefault();
    const sourceId = (event.dataTransfer.getData('text/plain') ||
      draggedColumn) as ColumnId;
    const reordered = reorderColumn(displayColumns, sourceId, targetId);
    setDisplayColumns(reordered);
    onColumnsChange(reordered);
    setDraggedColumn(null);
    setDragTarget(null);
  }

  function handleResizeStart(
    event: PointerEvent<HTMLButtonElement>,
    leftIndex: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const tableWidth = tableRef.current?.getBoundingClientRect().width ?? 0;
    if (!tableWidth) return;

    const origin = normalizeColumnSettings(displayColumns);
    const startX = event.clientX;
    let latest = origin;

    function handleMove(moveEvent: globalThis.PointerEvent) {
      const delta = (moveEvent.clientX - startX) / tableWidth;
      latest = resizeAdjacentColumns(origin, leftIndex, delta);
      setDisplayColumns(latest);
    }

    function handleEnd() {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      onColumnsChange(latest);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  }

  function handleReorderKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    columnId: ColumnId,
    index: number,
  ) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const targetIndex = index + (event.key === 'ArrowLeft' ? -1 : 1);
    const target = displayColumns[targetIndex];
    if (!target) {
      return;
    }

    const reordered = reorderColumn(displayColumns, columnId, target.id);
    setDisplayColumns(reordered);
    onColumnsChange(reordered);
  }

  function handleResizeKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    leftIndex: number,
  ) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.01;
    const resized = resizeAdjacentColumns(
      displayColumns,
      leftIndex,
      event.key === 'ArrowLeft' ? -step : step,
    );
    setDisplayColumns(resized);
    onColumnsChange(resized);
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    row: TableRecord,
  ) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenRow(row);
    }
  }

  return (
    <div
      ref={tableRef}
      className={`${styles.table} ${disabled ? styles.disabled : ''}`}
      role="table"
      aria-label="All records"
      aria-busy={loading}
    >
      <div className={styles.header}>
        <div className={styles.row} role="row">
          <div
            className={`${styles.selectionCell} ${styles.headerSelectionCell}`}
            role="columnheader"
          >
            <HeaderCheckbox
              checked={allPageSelected}
              indeterminate={somePageSelected}
              disabled={disabled || loading || rows.length === 0}
              onChange={onTogglePage}
            />
          </div>
          <div className={styles.rowInner}>
            {displayColumns.map((column, index) => (
              <HeaderColumn
                key={column.id}
                column={column}
                index={index}
                columnCount={displayColumns.length}
                orderBy={orderBy}
                draggedColumn={draggedColumn}
                dragTarget={dragTarget}
                disabled={disabled}
                loading={loading}
                sortingDisabled={sortingDisabled}
                sortable={
                  sortableColumnIds
                    ? sortableColumnIds.has(column.id)
                    : TABLE_COLUMN_BY_ID[column.id].sortable
                }
                onDragStart={handleHeaderDragStart}
                onDragEnd={() => {
                  setDraggedColumn(null);
                  setDragTarget(null);
                }}
                onDragOver={setDragTarget}
                onDragLeave={() => setDragTarget(null)}
                onDrop={handleHeaderDrop}
                onReorderKeyDown={handleReorderKeyDown}
                onResizeStart={handleResizeStart}
                onResizeKeyDown={handleResizeKeyDown}
                onOrderByChange={onOrderByChange}
              />
            ))}
          </div>
        </div>
        <ColumnSettingsMenu
          availableColumns={TABLE_COLUMNS}
          columns={displayColumns}
          onChange={(next) => {
            setDisplayColumns(normalizeColumnSettings(next));
            onColumnsChange(next);
          }}
        />
      </div>

      <div className={styles.contentRows} role="rowgroup">
        {loading && rows.length === 0
          ? SKELETON_ROW_IDS.map((rowId) => (
              <div
                className={styles.row}
                key={rowId}
                role="row"
                aria-hidden="true"
              >
                <div className={styles.selectionCell} />
                <div className={styles.rowInner}>
                  {displayColumns.map((column) => (
                    <div
                      key={column.id}
                      className={`${styles.cell} ${styles.skeletonCell}`}
                      style={{ width: `${column.width * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            ))
          : rows.map((row) => {
              const selected = selectedIds.has(row.id);
              return (
                <div
                  key={row.id}
                  className={`${styles.row} ${styles.bodyRow} ${
                    selected ? styles.selected : ''
                  } ${loading ? styles.fetching : ''}`}
                  role="row"
                >
                  <div
                    className={styles.selectionCell}
                    role="cell"
                    onClick={() => {
                      if (!disabled && !loading) {
                        onToggleRow(row.id);
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select record ${row.id}`}
                      checked={selected}
                      disabled={disabled || loading}
                      readOnly
                    />
                  </div>
                  <div
                    className={styles.rowInner}
                    role="link"
                    tabIndex={disabled ? -1 : 0}
                    onClick={() => onOpenRow(row)}
                    onKeyDown={(event) => handleRowKeyDown(event, row)}
                  >
                    {displayColumns.map((column) => (
                      <div
                        key={column.id}
                        className={styles.cell}
                        role="cell"
                        style={{ width: `${column.width * 100}%` }}
                      >
                        {cellContent(row, column.id)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        {!loading && rows.length === 0 && (
          <div className={styles.empty}>{emptyState}</div>
        )}
      </div>
    </div>
  );
}
