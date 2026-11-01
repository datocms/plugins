import Button from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import IconTrigger from 'datocms-react-ui/Dropdown/triggers/IconTrigger';
import omit from 'lodash-es/omit';
import { useMemo, useRef } from 'react';
import {
  type Column,
  type TableOptions,
  useFlexLayout,
  useResizeColumns,
  useTable,
} from 'react-table';
import { useDeepCompareMemo } from 'use-deep-compare';
import {
  ActionToggleIcon,
  AddIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  DeleteIcon,
  ExpandIcon,
} from '../../icons';
import type { Actions, Row, Value } from '../../types';
import { useMenuRoom } from '../../utils/useMenuRoom';
import EditableCell from '../EditableCell';
import EditableHeader from '../EditableHeader';
import s from './styles.module.css';

type Props = {
  value: Value;
  onChange: (value: Value | null) => void;
  onOpenInFullScreen?: () => void;
};

function orderedKeys<T extends { [k: string]: unknown }>(
  object: T,
  columns: string[],
): T {
  return Object.fromEntries(
    Object.entries(object).sort(
      ([key1], [key2]) => columns.indexOf(key1) - columns.indexOf(key2),
    ),
  ) as T;
}

function moveItemInArray<T>(
  arr: T[],
  fromIndex: number,
  toTheLeft: boolean,
): T[] {
  const newArray = [...arr];
  const toIndex = toTheLeft ? fromIndex - 1 : fromIndex + 1;

  const element = newArray[fromIndex];
  newArray.splice(fromIndex, 1);
  newArray.splice(toIndex, 0, element);

  return newArray;
}

export default function TableEditor({
  value,
  onChange,
  onOpenInFullScreen,
}: Props) {
  const ctx = useCtx();

  const defaultColumn = useMemo(
    () => ({
      minWidth: 30,
      width: 150,
      maxWidth: 400,
    }),
    [],
  );

  const tableColumns = useDeepCompareMemo<Column<Row>[]>(
    () =>
      value.columns.map((column) => ({
        Header: EditableHeader,
        Cell: EditableCell,
        id: column,
        accessor: (row) => row[column],
      })),
    [value.columns],
  );

  const onCellUpdate: Actions['onCellUpdate'] = (index, column, cellValue) => {
    onChange({
      ...value,
      data: value.data.map((row, i) =>
        i !== index
          ? row
          : orderedKeys(
              {
                ...row,
                [column]: cellValue,
              },
              value.columns,
            ),
      ),
    });
  };

  const onColumnRename: Actions['onColumnRename'] = (oldColumn, newColumn) => {
    const newColumns = value.columns.map((c) =>
      c === oldColumn ? newColumn : c,
    );
    onChange({
      columns: newColumns,
      data: value.data.map((row) =>
        orderedKeys(
          {
            ...omit(row, [oldColumn]),
            [newColumn]: row[oldColumn],
          },
          newColumns,
        ),
      ),
    });
  };

  const onRemoveColumn: Actions['onRemoveColumn'] = (column) => {
    onChange({
      columns: value.columns.filter((c) => c !== column),
      data: value.data.map((row) => omit(row, [column])),
    });
  };

  const findNewColumnName = () => {
    let columnName = 'New Column';
    let i = 1;

    while (value.columns.indexOf(columnName) !== -1) {
      columnName = `New Column ${i}`;
      i += 1;
    }

    return columnName;
  };

  const onAddColumn: Actions['onAddColumn'] = (column, toTheLeft) => {
    const columnName = findNewColumnName();

    const newColumns = [...value.columns];
    newColumns.splice(
      value.columns.indexOf(column) + (toTheLeft ? 0 : 1),
      0,
      columnName,
    );

    onChange({
      columns: newColumns,
      data: value.data.map((row) =>
        orderedKeys(
          {
            ...row,
            [columnName]: '',
          },
          newColumns,
        ),
      ),
    });
  };

  const onMoveColumn: Actions['onMoveColumn'] = (column, toTheLeft) => {
    const newColumns = moveItemInArray(
      value.columns,
      value.columns.indexOf(column),
      toTheLeft,
    );

    onChange({
      columns: newColumns,
      data: value.data.map((row) => orderedKeys(row, newColumns)),
    });
  };

  const onAddRow: Actions['onAddRow'] = (row, toTheBottom) => {
    const newRow = Object.fromEntries(
      value.columns.map((column) => [column, '']),
    );

    const newData = [...value.data];
    newData.splice(row + (toTheBottom ? 1 : 0), 0, newRow);

    onChange({
      ...value,
      data: newData,
    });
  };

  const onMoveRow: Actions['onMoveRow'] = (row, toTheBottom) => {
    onChange({
      ...value,
      data: moveItemInArray(value.data, row, !toTheBottom),
    });
  };

  const onRemoveRow: Actions['onRemoveRow'] = (row) => {
    const newData = [...value.data];
    newData.splice(row, 1);

    onChange({
      ...value,
      data: newData,
    });
  };

  const onMultipleCellUpdate: Actions['onMultipleCellUpdate'] = (
    index,
    id,
    table,
  ) => {
    let currentRow = index;
    let currentCol = value.columns.indexOf(id);

    const newData = [...value.data];

    const newRow = Object.fromEntries(
      value.columns.map((column) => [column, '']),
    );

    for (const row of table) {
      if (currentRow === newData.length) {
        newData.push({ ...newRow });
      }
      for (const cellValue of row) {
        if (currentCol < value.columns.length) {
          newData[currentRow][value.columns[currentCol]] = cellValue;
          currentCol += 1;
        }
      }
      currentRow += 1;
      currentCol = value.columns.indexOf(id);
    }

    onChange({
      ...value,
      data: newData,
    });
  };

  const handleClear = async () => {
    const result = await ctx.openConfirm({
      title: 'Delete the table?',
      content: 'All its rows and columns go away.',
      choices: [
        {
          label: 'Delete table',
          value: true,
          intent: 'negative',
        },
      ],
      cancel: {
        label: 'Cancel',
        value: false,
      },
    });

    if (result === true) {
      onChange(null);
    }
  };

  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } =
    useTable(
      {
        columns: tableColumns,
        data: value.data,
        defaultColumn,
        onCellUpdate,
        onColumnRename,
        onAddColumn,
        onAddRow,
        onMoveColumn,
        onRemoveColumn,
        onRemoveRow,
        onMultipleCellUpdate,
      } as TableOptions<Row>,
      useResizeColumns,
      useFlexLayout,
    );

  return (
    <div>
      <div {...getTableProps()} className={s.table}>
        {headerGroups.map((headerGroup) => {
          const { key, ...headerGroupProps } =
            headerGroup.getHeaderGroupProps();
          return (
            <div key={key} {...headerGroupProps} className={s.tr}>
              {headerGroup.headers.map((column) => {
                const { key, ...headerProps } = column.getHeaderProps();
                return (
                  <div key={key} {...headerProps} className={s.th}>
                    {column.render('Header')}
                    <div {...column.getResizerProps()} className={s.resizer} />
                  </div>
                );
              })}
              <div className={s.rowActions} />
            </div>
          );
        })}

        <div {...getTableBodyProps()} className={s.body}>
          {rows.map((row, i) => {
            prepareRow(row);
            const { key, ...rowProps } = row.getRowProps();
            return (
              <div key={key} {...rowProps} className={s.tr}>
                {row.cells.map((cell) => {
                  const { key, ...cellProps } = cell.getCellProps();
                  return (
                    <div key={key} {...cellProps} className={s.td}>
                      {cell.render('Cell')}
                    </div>
                  );
                })}
                <RowMenu
                  index={i}
                  count={rows.length}
                  onMoveRow={onMoveRow}
                  onAddRow={onAddRow}
                  onRemoveRow={onRemoveRow}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className={s.actions}>
        <Button
          icon={AddIcon}
          label="Add row"
          onClick={() => onAddRow(value.data.length, true)}
        />
        <div className={s.spacer} />
        {onOpenInFullScreen && (
          <Button
            tone="ghost"
            icon={ExpandIcon}
            label="Edit in full screen"
            onClick={onOpenInFullScreen}
          />
        )}
        <Button
          tone="ghost-alert"
          icon={DeleteIcon}
          label="Delete table"
          onClick={handleClear}
        />
      </div>
    </div>
  );
}

type RowMenuProps = Pick<Actions, 'onMoveRow' | 'onAddRow' | 'onRemoveRow'> & {
  index: number;
  count: number;
};

// The "⋮" at the end of a row
function RowMenu({
  index,
  count,
  onMoveRow,
  onAddRow,
  onRemoveRow,
}: RowMenuProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const menuRef = useMenuRoom(anchor);

  return (
    <div ref={anchor} className={s.rowActions}>
      <Dropdown
        triggerComponent={IconTrigger}
        icon={ActionToggleIcon}
        label={`Actions for row ${index + 1}`}
      >
        <Dropdown.Menu ref={menuRef} placement="bottom-end">
          <Dropdown.Option
            icon={<ArrowUpIcon />}
            disabled={
              index === 0 ? { reason: 'This is the first row.' } : false
            }
            onPick={() => onMoveRow(index, false)}
          >
            Move up
          </Dropdown.Option>
          <Dropdown.Option
            icon={<ArrowDownIcon />}
            disabled={
              index === count - 1 ? { reason: 'This is the last row.' } : false
            }
            onPick={() => onMoveRow(index, true)}
          >
            Move down
          </Dropdown.Option>
          <Dropdown.Separator />
          <Dropdown.Option
            icon={<AddIcon />}
            onPick={() => onAddRow(index, false)}
          >
            Add row above
          </Dropdown.Option>
          <Dropdown.Option
            icon={<AddIcon />}
            onPick={() => onAddRow(index, true)}
          >
            Add row below
          </Dropdown.Option>
          <Dropdown.Separator />
          <Dropdown.Option
            icon={<DeleteIcon />}
            alert
            onPick={() => onRemoveRow(index)}
          >
            Delete row
          </Dropdown.Option>
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
}
