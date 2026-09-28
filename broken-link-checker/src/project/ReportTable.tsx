import type { KeyboardEvent } from 'react';
import { countLabel, FACT_SEPARATOR, joinFacts } from '../report/format';
import { groupFacts, type Sort, type SortKey } from '../report/view';
import type { LinkGroup } from '../types';
import { BreakableUrl } from '../ui/BreakableUrl';
import { LogStatus, STATUS_META } from '../ui/LogStatus';

type ReportTableProps = {
  /** The current page's slice. */
  groups: LinkGroup[];
  sort: Sort;
  onSort: (key: SortKey) => void;
  selectedKey: string | null;
  /** `open` expands the sidebar too. */
  onSelect: (key: string, open: boolean) => void;
  onClearSelection: () => void;
  uiLocale: string;
};

type SortHeaderProps = {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
};

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: SortHeaderProps) {
  const direction = sort?.key === sortKey ? sort.direction : null;
  const ariaSort =
    direction === 'asc'
      ? 'ascending'
      : direction === 'desc'
        ? 'descending'
        : 'none';
  const arrow = direction === 'asc' ? ' ▲' : direction === 'desc' ? ' ▼' : '';
  return (
    <th className={className} aria-sort={ariaSort}>
      <button
        type="button"
        className="dl-table__sort"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {arrow && <span aria-hidden="true">{arrow}</span>}
      </button>
    </th>
  );
}

type ReportRowProps = {
  group: LinkGroup;
  selected: boolean;
  onSelect: (key: string, open: boolean) => void;
  onClearSelection: () => void;
  uiLocale: string;
};

function siblingRow(row: HTMLTableRowElement, key: string) {
  const sibling =
    key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
  return sibling instanceof HTMLTableRowElement ? sibling : null;
}

function ReportRow({
  group,
  selected,
  onSelect,
  onClearSelection,
  uiLocale,
}: ReportRowProps) {
  const { url } = group.prepared;
  const { status, httpStatus } = group.result;
  const records = countLabel(
    groupFacts(group).recordCount,
    '1 record',
    '{n} records',
    uiLocale,
  );
  const http = httpStatus === undefined ? null : `HTTP ${httpStatus}`;
  const rowLabel = [
    url,
    STATUS_META[status].label,
    http,
    `used in ${records}`,
    group.stale && 'content changed',
  ]
    .filter(Boolean)
    .join(', ');

  const handleKey = (event: KeyboardEvent<HTMLTableRowElement>) => {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect(group.key, true);
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const sibling = siblingRow(event.currentTarget, event.key);
        const siblingKey = sibling?.dataset.key;
        if (!sibling || !siblingKey) break;
        sibling.focus();
        onSelect(siblingKey, false);
        break;
      }
      case 'Escape':
        onClearSelection();
        break;
    }
  };

  return (
    <tr
      tabIndex={0}
      data-key={group.key}
      aria-current={selected ? 'true' : undefined}
      aria-label={rowLabel}
      onClick={() => onSelect(group.key, true)}
      onKeyDown={handleKey}
    >
      <td>
        <span className="blc-url">
          <BreakableUrl url={url} />
        </span>
        {group.stale && <span className="dl-row-tag">Content changed</span>}
        <span className="blc-url__meta" aria-hidden="true">
          <span className="blc-url__meta-status">
            <LogStatus status={status} />
            {FACT_SEPARATOR}
          </span>
          {joinFacts([http, records])}
        </span>
      </td>
      <td className="blc-col-status dl-table__cell--nowrap">
        <LogStatus status={status} />
      </td>
      <td className="blc-col-http dl-table__cell--nowrap">
        {httpStatus ?? ''}
      </td>
      <td className="blc-col-used dl-table__cell--nowrap">{records}</td>
    </tr>
  );
}

/** One row per URL. Sorting cycles none → ascending → descending on each header. */
export function ReportTable({
  groups,
  sort,
  onSort,
  selectedKey,
  onSelect,
  onClearSelection,
  uiLocale,
}: ReportTableProps) {
  return (
    <table
      className="dl-table dl-table--hover blc-table"
      aria-label="Link check results"
    >
      <thead>
        <tr>
          <SortHeader label="URL" sortKey="url" sort={sort} onSort={onSort} />
          <SortHeader
            label="Status"
            sortKey="status"
            sort={sort}
            onSort={onSort}
            className="blc-col-status"
          />
          <th className="blc-col-http">HTTP status</th>
          <SortHeader
            label="Used in"
            sortKey="usedIn"
            sort={sort}
            onSort={onSort}
            className="blc-col-used"
          />
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <ReportRow
            key={group.key}
            group={group}
            selected={group.key === selectedKey}
            onSelect={onSelect}
            onClearSelection={onClearSelection}
            uiLocale={uiLocale}
          />
        ))}
      </tbody>
    </table>
  );
}
