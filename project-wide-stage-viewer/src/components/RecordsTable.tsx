import IdText from 'datocms-react-ui/IdText';
import ItemStatus from 'datocms-react-ui/ItemStatus';
import {
  Table,
  type TableColumn,
  type TableLayout,
  type TableSort,
  type TableSortState,
} from 'datocms-react-ui/Table';
import EntityCell from 'datocms-react-ui/Table/cells/EntityCell';
import TimeCell from 'datocms-react-ui/Table/cells/TimeCell';
import { ItemValidityTriangles } from 'datocms-react-ui/ValidityTriangles';
import { memo, useCallback, useMemo, useRef } from 'react';
import { DEFAULT_ORDER_BY } from '../lib/records';
import type { ColumnId, ColumnSetting, OrderBy } from '../types';
import {
  ALL_COLUMN_IDS,
  fromTableLayout,
  toTableLayout,
} from './columnSettings';
import type { TableRecord } from './types';

export type RecordsTableProps = {
  /** The stored layout: the visible columns, in order, with their widths */
  columns: readonly ColumnSetting[];
  onColumnsChange: (columns: readonly ColumnSetting[]) => void;
  /** The rows of the current page */
  rows: readonly TableRecord[];
  /** Every selected record, also the ones of other pages */
  selectedIds: ReadonlySet<string>;
  /** The order the rows show in */
  orderBy: OrderBy;
  /** The columns the user can sort by now; undefined when all can */
  sortableColumnIds?: ReadonlySet<ColumnId>;
  /** False while the records load or an action runs: a click on a header does nothing */
  sortingEnabled: boolean;
  onOrderByChange: (orderBy: OrderBy | null) => void;
  /** False while the records load or an action runs: the checkboxes do nothing */
  selectionEnabled: boolean;
  onToggleRow: (id: string) => void;
  onTogglePage: (selected: boolean) => void;
};

function orderDirection(orderBy: OrderBy, columnId: ColumnId) {
  if (!orderBy.startsWith(`${columnId}_`)) return null;
  return orderBy.endsWith('_ASC') ? 'ASC' : 'DESC';
}

// An unsorted column goes to ASC, ASC goes to DESC, and DESC goes back to the
// default order, except the default column itself, whose DESC goes to ASC.
function nextOrder(orderBy: OrderBy, columnId: ColumnId): OrderBy | null {
  const direction = orderDirection(orderBy, columnId);
  if (!direction) return `${columnId}_ASC` as OrderBy;
  if (direction === 'ASC') return `${columnId}_DESC` as OrderBy;
  return orderBy === DEFAULT_ORDER_BY ? (`${columnId}_ASC` as OrderBy) : null;
}

function isColumnId(value: string): value is ColumnId {
  return ALL_COLUMN_IDS.includes(value as ColumnId);
}

function tableSort(orderBy: OrderBy): TableSort | null {
  for (const columnId of ALL_COLUMN_IDS) {
    const direction = orderDirection(orderBy, columnId);
    if (direction) {
      return {
        columnName: columnId,
        direction: direction === 'ASC' ? 'asc' : 'desc',
      };
    }
  }
  return null;
}

// The title of the record, with its image and its validity triangles
function TitleCell({ row }: { row: TableRecord }) {
  return (
    <EntityCell
      title={row.title}
      image={row.imageUrl && <img alt="" src={row.imageUrl} />}
      afterTitle={
        <ItemValidityTriangles
          publishedValid={row.publishedValid}
          currentValid={row.currentValid}
          draftModeActive={row.draftModeActive}
        />
      }
    />
  );
}

// The page can give a new set on each render: the columns are keyed by the
// sortable IDs, so that they (and every row) render again only when those change.
function sortableKey(sortableColumnIds: ReadonlySet<ColumnId> | undefined) {
  return ALL_COLUMN_IDS.filter(
    (columnId) => sortableColumnIds?.has(columnId) ?? true,
  ).join(' ');
}

function buildColumns(key: string): TableColumn<TableRecord>[] {
  const sortableIds = new Set(key.split(' '));
  const sortable = (columnId: ColumnId) => sortableIds.has(columnId);

  return [
    {
      name: '_preview',
      label: 'Title',
      sortable: sortable('_preview'),
      minWidth: 200,
      priority: 5,
      renderCell: (row) => <TitleCell row={row} />,
    },
    {
      name: '_model',
      label: 'Model',
      sortable: sortable('_model'),
      priority: 3,
      renderCell: (row) => row.model,
    },
    {
      name: '_status',
      label: 'Status',
      sortable: sortable('_status'),
      priority: 4,
      renderCell: (row) => <ItemStatus status={row.status} display="label" />,
    },
    {
      name: '_updated_at',
      label: 'Last update',
      sortable: sortable('_updated_at'),
      priority: 2,
      renderCell: (row) =>
        row.updatedAt ? <TimeCell value={row.updatedAt} /> : null,
    },
    {
      name: '_created_at',
      label: 'Created',
      sortable: sortable('_created_at'),
      priority: 1,
      renderCell: (row) =>
        row.createdAt ? <TimeCell value={row.createdAt} /> : null,
    },
    {
      name: 'id',
      label: 'ID',
      sortable: sortable('id'),
      priority: 0,
      renderCell: (row) => <IdText id={row.id} />,
    },
  ];
}

type RecordRowProps = {
  row: TableRecord;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
};

// Memoized, so that a change of one row (or of the page around the table)
// does not render every row again
const RecordRow = memo(function RecordRow({
  row,
  selected,
  disabled,
  onToggle,
}: RecordRowProps) {
  const selection = useMemo(
    () => ({ selected, disabled, onSelect: () => onToggle(row.id) }),
    [disabled, onToggle, row.id, selected],
  );

  return <Table.Row row={row} to={row.url} selection={selection} />;
});

export function RecordsTable({
  columns,
  onColumnsChange,
  rows,
  selectedIds,
  orderBy,
  sortableColumnIds,
  sortingEnabled,
  onOrderByChange,
  selectionEnabled,
  onToggleRow,
  onTogglePage,
}: RecordsTableProps) {
  const columnsKey = sortableKey(sortableColumnIds);
  const tableColumns = useMemo(() => buildColumns(columnsKey), [columnsKey]);
  const layout = useMemo(() => toTableLayout(columns), [columns]);
  const handleLayoutChange = useCallback(
    (next: TableLayout) => onColumnsChange(fromTableLayout(next)),
    [onColumnsChange],
  );

  // The latest handlers, so that the rows keep one stable callback
  const latest = useRef({ onToggleRow, onOrderByChange, onTogglePage });
  latest.current = { onToggleRow, onOrderByChange, onTogglePage };
  const toggleRow = useCallback(
    (id: string) => latest.current.onToggleRow(id),
    [],
  );

  // The header keeps its sort buttons and its checkbox while they wait, thus
  // the labels and the arrow of the order do not move.
  const sort = useMemo<TableSortState>(() => {
    const value = tableSort(orderBy);
    return {
      value,
      // The table goes from DESC to no order with `null`, which names no
      // column: the sorted column then runs the cycle of nextOrder().
      onChange: (next) => {
        const columnName = next?.columnName ?? value?.columnName;
        if (!sortingEnabled || !columnName || !isColumnId(columnName)) return;
        latest.current.onOrderByChange(nextOrder(orderBy, columnName));
      },
    };
  }, [orderBy, sortingEnabled]);

  const allPageSelected =
    rows.length > 0 && rows.every((row) => selectedIds.has(row.id));
  const selectAll = useMemo(
    () => ({
      selected: allPageSelected,
      onChange: (selected: boolean) => {
        if (selectionEnabled) latest.current.onTogglePage(selected);
      },
    }),
    [allPageSelected, selectionEnabled],
  );

  return (
    <Table
      columns={tableColumns}
      layout={layout}
      onLayoutChange={handleLayoutChange}
      sort={sort}
      checkboxes={{ alwaysVisible: selectedIds.size > 0 }}
    >
      <Table.Header selectAll={rows.length > 0 ? selectAll : undefined} />
      <Table.Body>
        {rows.map((row) => (
          <RecordRow
            key={row.id}
            row={row}
            selected={selectedIds.has(row.id)}
            disabled={!selectionEnabled}
            onToggle={toggleRow}
          />
        ))}
      </Table.Body>
    </Table>
  );
}
