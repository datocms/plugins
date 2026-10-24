import {
  Table,
  type TableColumn,
  useInMemoryTableLayout,
} from 'datocms-react-ui/Table';
import StatusCell from 'datocms-react-ui/Table/cells/StatusCell';
import type { DuplicationProgress } from '../services/duplicationTypes';
import { progressUpdateKey } from '../utils/progressLog';

const STATUS = {
  success: { tone: 'success', label: 'Done' },
  error: { tone: 'danger', label: 'Failed' },
  info: { tone: 'neutral', label: 'Info' },
} as const;

const COLUMNS: TableColumn<DuplicationProgress>[] = [
  {
    name: 'status',
    label: 'Status',
    renderCell: (entry) => (
      <StatusCell tone={STATUS[entry.type].tone}>
        {STATUS[entry.type].label}
      </StatusCell>
    ),
  },
  {
    name: 'message',
    label: 'Message',
    truncate: false,
    renderCell: (entry) => entry.message,
  },
];

const DEFAULT_LAYOUT = {
  columns: [
    { name: 'status', width: 1 },
    { name: 'message', width: 5 },
  ],
};

/** The entries of the duplication log, one row each */
export function LogTable({ entries }: { entries: DuplicationProgress[] }) {
  const [layout, setLayout] = useInMemoryTableLayout(DEFAULT_LAYOUT);

  return (
    <Table columns={COLUMNS} layout={layout} onLayoutChange={setLayout}>
      <Table.Header />
      <Table.Body>
        {entries.map((entry) => (
          <Table.Row key={progressUpdateKey(entry)} row={entry} />
        ))}
      </Table.Body>
    </Table>
  );
}
