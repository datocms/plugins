import { Column as TableColumn, Row as TableRow } from 'react-table';
import Textarea from 'react-textarea-autosize';
import { Actions, Row } from '../../types';

type Props = Actions & {
  value: string;
  row: TableRow<Row>;
  rows: TableRow<Row>[];
  columns: TableColumn<Row>[];
  column: TableColumn<Row>;
  onCellUpdate: (index: number, column: string, value: string) => void;
};

function toTable(transfer: DataTransfer) {
  const html = transfer.getData('text/html');
  if (html) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const tableEl = document.querySelector('table');

    if (tableEl) {
      return Array.from(tableEl.rows).reduce((acc, row) => {
        const columns = Array.from(row.children).map(
          (column) =>
            column.textContent
              ?.replace(/\n/g, ' ')
              .replace(/\s+/, ' ')
              .trim() || '',
        );

        return [...acc, columns];
      }, [] as string[][]);
    }
  }

  const data = transfer.getData('text/plain');

  return data
    .trim()
    .split(/\r\n|\n|\r/)
    .map((row) => row.split('\t'));
}

export default function EditableCell({
  value,
  columns,
  row: { index },
  column: { id },
  onCellUpdate,
  onMultipleCellUpdate,
}: Props) {
  return (
    <Textarea
      value={value}
      onPaste={(e) => {
        e.preventDefault();
        const table = toTable(e.clipboardData);
        onMultipleCellUpdate(index, id!, table);
      }}
      onChange={(e) => {
        onCellUpdate(index, id as string, e.target.value);
      }}
    />
  );
}
