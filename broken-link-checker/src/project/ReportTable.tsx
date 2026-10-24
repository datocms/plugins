import Pill from 'datocms-react-ui/Pill';
import {
  Table,
  type TableColumn,
  type TableLayout,
  type TableSort,
} from 'datocms-react-ui/Table';
import StatusCell from 'datocms-react-ui/Table/cells/StatusCell';
import { useMemo } from 'react';
import { countLabel } from '../report/format';
import { groupFacts, type Sort, type SortKey } from '../report/view';
import type { LinkGroup } from '../types';
import { BreakableUrl } from '../ui/BreakableUrl';
import { STATUS_META } from '../ui/LogStatus';
import styles from './Report.module.css';

/** The columns as they show before the user moves or resizes them. */
export const DEFAULT_TABLE_LAYOUT: TableLayout = {
  columns: [
    { name: 'url', width: 6 },
    { name: 'status', width: 2 },
    { name: 'http', width: 2 },
    { name: 'usedIn', width: 2 },
  ],
};

const SORT_KEYS: readonly SortKey[] = ['url', 'status', 'usedIn'];

function isSortKey(name: string): name is SortKey {
  return (SORT_KEYS as readonly string[]).includes(name);
}

/** The plugin's sort as the table reads it. */
function tableSort(sort: Sort): TableSort | null {
  return sort ? { columnName: sort.key, direction: sort.direction } : null;
}

/** The table's sort as the plugin keeps it: only the sortable columns. */
function reportSort(sort: TableSort | null): Sort {
  if (!sort || !isSortKey(sort.columnName)) return null;
  return { key: sort.columnName, direction: sort.direction };
}

function useColumns(uiLocale: string) {
  return useMemo<TableColumn<LinkGroup>[]>(
    () => [
      {
        name: 'url',
        label: 'URL',
        sortable: true,
        // The last column a narrow table drops, wherever the user moves it:
        // without it, a row doesn't say which URL it is.
        priority: 4,
        // Long URLs wrap at their separators instead of ending with an ellipsis.
        truncate: false,
        minWidth: 240,
        renderCell: (group) => (
          <span className={styles.url}>
            <BreakableUrl url={group.prepared.url} />
            {group.stale && (
              <span className={styles.tag}>
                <Pill>Content changed</Pill>
              </span>
            )}
          </span>
        ),
      },
      {
        name: 'status',
        label: 'Status',
        sortable: true,
        priority: 3,
        renderCell: (group) => {
          const { label, tone } = STATUS_META[group.result.status];
          return <StatusCell tone={tone}>{label}</StatusCell>;
        },
      },
      {
        name: 'http',
        label: 'HTTP status',
        priority: 1,
        renderCell: (group) => group.result.httpStatus ?? '',
      },
      {
        name: 'usedIn',
        label: 'Used in',
        sortable: true,
        priority: 2,
        renderCell: (group) =>
          countLabel(
            groupFacts(group).recordCount,
            '1 record',
            '{n} records',
            uiLocale,
          ),
      },
    ],
    [uiLocale],
  );
}

type ReportTableProps = {
  /** The current page's slice, with each URL's live result. */
  groups: readonly LinkGroup[];
  layout: TableLayout;
  onLayoutChange: (layout: TableLayout) => void;
  sort: Sort;
  /** Gets the next sort, or null for discovery order. */
  onSortChange: (sort: Sort) => void;
  /** The key of the open URL. */
  openKey?: string;
  onOpen: (group: LinkGroup) => void;
  uiLocale: string;
};

/**
 * One row per URL. A header cycles none, ascending and descending; with a row
 * open, the arrows open the previous or the next one.
 */
export function ReportTable({
  groups,
  layout,
  onLayoutChange,
  sort,
  onSortChange,
  openKey,
  onOpen,
  uiLocale,
}: ReportTableProps) {
  const columns = useColumns(uiLocale);
  const sortState = useMemo(
    () => ({
      value: tableSort(sort),
      onChange: (next: TableSort | null) => onSortChange(reportSort(next)),
    }),
    [sort, onSortChange],
  );

  return (
    <Table
      columns={columns}
      layout={layout}
      onLayoutChange={onLayoutChange}
      sort={sortState}
    >
      <Table.Header />
      <Table.Body>
        {groups.map((group) => (
          <Table.Row
            key={group.key}
            row={group}
            active={group.key === openKey}
            openWithArrows={openKey !== undefined}
            onOpen={() => onOpen(group)}
          />
        ))}
      </Table.Body>
    </Table>
  );
}
