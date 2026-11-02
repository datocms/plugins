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
import { DEFAULT_ORDER_BY } from '../data/query';
import type { ColumnId, ColumnSetting, OrderBy } from '../types';
import {
  ALL_COLUMN_IDS,
  fromTableLayout,
  toTableLayout,
} from './columnSettings';
import type { TableRecord } from './types';

export type AllRecordsTableProps = {
  /** The stored layout: the visible columns, in order, with their widths */
  columns: readonly ColumnSetting[];
  onColumnsChange: (columns: readonly ColumnSetting[]) => void;
  rows: readonly TableRecord[];
  /** Every selected record, also the ones of other pages */
  selectedIds: ReadonlySet<string>;
  /** The order the rows show in, or null while a search sorts by relevance */
  orderBy: OrderBy | null;
  sortableColumnIds: ReadonlySet<ColumnId>;
  /** False while searching: the headers do not sort */
  sortingEnabled: boolean;
  onOrderByChange: (orderBy: OrderBy | null) => void;
  /** False while the records load or an action runs */
  selectionEnabled: boolean;
  /**
   * True while a bulk action runs, which can take minutes: the header has no
   * checkbox meanwhile, since the table can't show it as disabled
   */
  selectAllHidden: boolean;
  onToggleRow: (id: string) => void;
  onTogglePage: (selected: boolean) => void;
};

// The narrowest Status and date columns that show "Unpublished changes" and
// a full date: on a narrow table, the columns of a lower priority hide first
const STATUS_MIN_WIDTH = 180;
const DATE_MIN_WIDTH = 170;

function ignore(): void {}

function orderDirection(orderBy: OrderBy | null, columnId: ColumnId) {
  if (!orderBy?.startsWith(`${columnId}_`)) return null;
  return orderBy.endsWith('_ASC') ? 'ASC' : 'DESC';
}

// An unsorted column goes to ASC, ASC goes to DESC, and DESC goes back to the
// default order, except the default column itself, whose DESC goes to ASC.
function nextOrder(
  orderBy: OrderBy | null,
  columnId: ColumnId,
): OrderBy | null {
  const direction = orderDirection(orderBy, columnId);
  if (!direction) return `${columnId}_ASC` as OrderBy;
  if (direction === 'ASC') return `${columnId}_DESC` as OrderBy;
  return orderBy === DEFAULT_ORDER_BY ? (`${columnId}_ASC` as OrderBy) : null;
}

function isColumnId(value: string): value is ColumnId {
  return ALL_COLUMN_IDS.includes(value as ColumnId);
}

function tableSort(orderBy: OrderBy | null): TableSort | null {
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

function buildColumns(
  sortableColumnIds: ReadonlySet<ColumnId>,
): TableColumn<TableRecord>[] {
  return [
    {
      name: '_preview',
      label: 'Title',
      sortable: sortableColumnIds.has('_preview'),
      minWidth: 200,
      priority: 5,
      renderCell: (row) => (
        <EntityCell
          title={row.title}
          image={row.imageUrl && <img src={row.imageUrl} alt="" />}
          afterTitle={
            <ItemValidityTriangles
              publishedValid={row.publishedValid}
              currentValid={row.currentValid}
              draftModeActive={row.draftModeActive}
            />
          }
        />
      ),
    },
    {
      name: '_model',
      label: 'Model',
      sortable: sortableColumnIds.has('_model'),
      priority: 3,
      renderCell: (row) => row.model,
    },
    {
      name: '_status',
      label: 'Status',
      sortable: sortableColumnIds.has('_status'),
      minWidth: STATUS_MIN_WIDTH,
      priority: 4,
      renderCell: (row) => <ItemStatus status={row.status} display="label" />,
    },
    {
      name: '_updated_at',
      label: 'Last update',
      sortable: sortableColumnIds.has('_updated_at'),
      minWidth: DATE_MIN_WIDTH,
      priority: 2,
      renderCell: (row) =>
        row.updatedAt ? <TimeCell value={row.updatedAt} /> : null,
    },
    {
      name: '_created_at',
      label: 'Created',
      sortable: sortableColumnIds.has('_created_at'),
      minWidth: DATE_MIN_WIDTH,
      priority: 1,
      renderCell: (row) =>
        row.createdAt ? <TimeCell value={row.createdAt} /> : null,
    },
    {
      name: 'id',
      label: 'ID',
      sortable: sortableColumnIds.has('id'),
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

export function AllRecordsTable({
  columns,
  onColumnsChange,
  rows,
  selectedIds,
  orderBy,
  sortableColumnIds,
  sortingEnabled,
  onOrderByChange,
  selectionEnabled,
  selectAllHidden,
  onToggleRow,
  onTogglePage,
}: AllRecordsTableProps) {
  const tableColumns = useMemo(
    () => buildColumns(sortableColumnIds),
    [sortableColumnIds],
  );
  const layout = useMemo(() => toTableLayout(columns), [columns]);
  const handleLayoutChange = useCallback(
    (next: TableLayout) => onColumnsChange(fromTableLayout(next)),
    [onColumnsChange],
  );

  // The latest handlers, so that the rows keep one stable callback
  const latest = useRef({ onToggleRow, onOrderByChange });
  latest.current = { onToggleRow, onOrderByChange };
  const toggleRow = useCallback(
    (id: string) => latest.current.onToggleRow(id),
    [],
  );

  const sort = useMemo<TableSortState>(() => {
    const value = tableSort(orderBy);
    if (!sortingEnabled) return { value };
    return {
      value,
      // The table goes from DESC to no order with `null`, which names no
      // column: the sorted column then runs the cycle of nextOrder().
      onChange: (next) => {
        const columnName = next?.columnName ?? value?.columnName;
        if (!columnName || !isColumnId(columnName)) return;
        latest.current.onOrderByChange(nextOrder(orderBy, columnName));
      },
    };
  }, [orderBy, sortingEnabled]);

  const allPageSelected =
    rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  return (
    <Table
      columns={tableColumns}
      layout={layout}
      onLayoutChange={handleLayoutChange}
      sort={sort}
      checkboxes={{ alwaysVisible: selectedIds.size > 0 }}
    >
      {/* The checkbox stays while the records reload, thus the labels of
          the header stay above their columns; it does nothing meanwhile */}
      <Table.Header
        selectAll={
          rows.length > 0 && !selectAllHidden
            ? {
                selected: allPageSelected,
                onChange: selectionEnabled ? onTogglePage : ignore,
              }
            : undefined
        }
      />
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
