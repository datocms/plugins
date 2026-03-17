import type { SummaryRow } from '../types';

type Props = {
  rows: SummaryRow[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function SummaryTable({ rows, selectedId, onSelect }: Props) {
  return (
    <div className="summary-table">
      <table>
        <thead>
          <tr>
            <th>Group</th>
            <th>Changed</th>
            <th>Left only</th>
            <th>Right only</th>
            <th>Unchanged</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={selectedId === row.id ? 'is-selected' : undefined}
              onClick={() => onSelect(row.id)}
            >
              <td>
                <strong>{row.label}</strong>
                {row.description ? <div>{row.description}</div> : null}
              </td>
              <td>{row.counts.changed}</td>
              <td>{row.counts.leftOnly}</td>
              <td>{row.counts.rightOnly}</td>
              <td>{row.counts.unchanged}</td>
              <td>{row.counts.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
