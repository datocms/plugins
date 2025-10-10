import { Column as TableColumn, Row as TableRow } from "react-table";
import Textarea from "react-textarea-autosize";
import { Actions, Row } from "../../types";

type Props = Actions & {
  value: string;
  row: TableRow<Row>;
  rows: TableRow<Row>[];
  columns: TableColumn<Row>[];
  column: TableColumn<Row>;
  onCellUpdate: (index: number, column: string, value: string) => void;
};

function toTable(transfer: DataTransfer) {
  const html = transfer.getData("text/html");
  if (html) {
    const document = new DOMParser().parseFromString(html, "text/html");
    const tableEl = document.querySelector("table");

    if (tableEl) {
      return Array.from(tableEl.rows).reduce((acc, row) => {
        const columns = Array.from(row.children).map(
          (column) =>
            column.textContent
              ?.replace(/\n/g, " ")
              .replace(/\s+/, " ")
              .trim() || ""
        );

        return [...acc, columns];
      }, [] as string[][]);
    }
  }

  const data = transfer.getData("text/plain");

  if (data.includes("\t")) {
    return data
      .trim()
      .split(/\r\n|\n|\r/)
      .map((row) => row.split("\t"));
  }

  return [[data.trim()]];
}

export default function EditableCell({
  value,
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
        const isMultiCell = table.length > 1 || (table[0]?.length || 0) > 1;
        const target = e.target as HTMLTextAreaElement;
        const start = target.selectionStart ?? 0;
        const end = target.selectionEnd ?? 0;

        if (isMultiCell) {
          onMultipleCellUpdate(index, id!, table);
        } else {
          const text = table[0]?.[0] ?? "";
          const newValue = value.slice(0, start) + text + value.slice(end);
          onCellUpdate(index, id as string, newValue);

          setTimeout(() => {
            const nextCursor = start + text.length;
            target.selectionStart = nextCursor;
            target.selectionEnd = nextCursor;
          });
        }
      }}
      onChange={(e) => {
        onCellUpdate(index, id as string, e.target.value);
      }}
    />
  );
}
