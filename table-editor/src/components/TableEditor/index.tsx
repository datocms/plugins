import { useEffect, useMemo, useRef } from 'react';
import {
  useTable,
  useFlexLayout,
  useResizeColumns,
  Column,
  TableOptions,
} from 'react-table';
import { useDeepCompareMemo } from 'use-deep-compare';
import { Actions, Row, Value } from '../../types';
import EditableCell from '../EditableCell';
import { Button, useCtx } from 'datocms-react-ui';
import omit from 'lodash-es/omit';
import EditableHeader from '../EditableHeader';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExpand, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import {
  faLongArrowAltDown,
  faLongArrowAltUp,
  faTrashAlt,
} from '@fortawesome/free-solid-svg-icons';
import {
  Dropdown,
  DropdownMenu,
  DropdownOption,
  DropdownSeparator,
} from 'datocms-react-ui';
import classNames from 'classnames';
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
    const newRow = value.columns.reduce<Row>(
      (acc, column) => ({ ...acc, [column]: '' }),
      {},
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

    const newRow = value.columns.reduce<Row>(
      (acc, column) => ({ ...acc, [column]: '' }),
      {},
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
      title: 'Clear the table?',
      content:
        'Are you sure you want to clear the table and start over? All rows and headers will be destroyed.',
      choices: [
        {
          label: 'Yes, clear the table',
          value: true,
          intent: 'negative',
        },
      ],
      cancel: {
        label: 'Go back',
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

  const tbodyRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tbodyRef.current) {
      return;
    }

    const tbody = tbodyRef.current;

    const handler = (event: Event) => {
      if (!theadRef.current) {
        return;
      }

      theadRef.current.scrollLeft = (event.target as any).scrollLeft;
    };

    tbody.addEventListener('scroll', handler);

    return () => {
      tbody.removeEventListener('scroll', handler);
    };
  }, []);

  return (
    <div>
      <div {...getTableProps()} className={s.table}>
        <div className={s.thead} ref={theadRef} style={{ overflowX: 'hidden' }}>
          {headerGroups.map((headerGroup) => (
            <div {...headerGroup.getHeaderGroupProps()} className={s.tr}>
              {headerGroup.headers.map((column) => (
                <div {...column.getHeaderProps()} className={s.th}>
                  {column.render('Header')}
                  <div
                    {...column.getResizerProps()}
                    className={classNames(s.resizer, {
                      [s.isResizing]: column.isResizing,
                    })}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>

        <div
          {...getTableBodyProps()}
          ref={tbodyRef}
          style={{ overflowX: 'auto' }}
        >
          {rows.map((row, i) => {
            prepareRow(row);
            return (
              <div {...row.getRowProps()} className={s.tr}>
                <div className={s.dropdownWrapper}>
                  <Dropdown
                    renderTrigger={({ onClick }) => (
                      <button
                        onClick={onClick}
                        className={s.handle}
                        type="button"
                      />
                    )}
                  >
                    <DropdownMenu>
                      <DropdownOption
                        onClick={onMoveRow.bind(null, i, false)}
                        disabled={i === 0}
                      >
                        <FontAwesomeIcon icon={faLongArrowAltUp} /> Move row up
                      </DropdownOption>
                      <DropdownOption
                        onClick={onMoveRow.bind(null, i, true)}
                        disabled={i === rows.length - 1}
                      >
                        <FontAwesomeIcon icon={faLongArrowAltDown} /> Move row
                        down
                      </DropdownOption>
                      <DropdownSeparator />
                      <DropdownOption onClick={onAddRow.bind(null, i, false)}>
                        <FontAwesomeIcon icon={faLongArrowAltUp} /> Add row
                        above
                      </DropdownOption>
                      <DropdownOption onClick={onAddRow.bind(null, i, true)}>
                        <FontAwesomeIcon icon={faLongArrowAltDown} /> Add row
                        below
                      </DropdownOption>
                      <DropdownSeparator />
                      <DropdownOption red onClick={onRemoveRow.bind(null, i)}>
                        <FontAwesomeIcon icon={faTrashAlt} /> Remove row
                      </DropdownOption>
                    </DropdownMenu>
                  </Dropdown>
                </div>
                {row.cells.map((cell) => {
                  return (
                    <div {...cell.getCellProps()} className={s.td}>
                      {cell.render('Cell')}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className={s.actions}>
        <Button
          onClick={onAddRow.bind(null, value.data.length, true)}
          buttonSize="s"
          leftIcon={<FontAwesomeIcon icon={faPlus} />}
        >
          Add new row
        </Button>

        <div className={s.actionsSpacer} />

        {onOpenInFullScreen && (
          <Button
            onClick={onOpenInFullScreen}
            buttonSize="s"
            leftIcon={<FontAwesomeIcon icon={faExpand} />}
          >
            Edit in full-screen
          </Button>
        )}
        <Button
          onClick={handleClear}
          buttonSize="s"
          leftIcon={<FontAwesomeIcon icon={faTrash} />}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
