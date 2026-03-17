import type { TableColumn } from '../types';

type Props<Row> = {
  rows: Row[];
  columns: TableColumn<Row>[];
  selectedId?: string;
  rowId: (row: Row) => string;
  onSelect: (row: Row) => void;
};

export function ResultsTable<Row>({
  rows,
  columns,
  selectedId,
  rowId,
  onSelect,
}: Props<Row>) {
  return (
    <div className="results-table">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className}>
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = rowId(row);
            return (
              <tr
                key={id}
                className={selectedId === id ? 'is-selected' : undefined}
                onClick={() => onSelect(row)}
              >
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
