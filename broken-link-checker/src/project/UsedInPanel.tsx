import EntityRow from 'datocms-react-ui/EntityRow';
import Pill from 'datocms-react-ui/Pill';
import RowList from 'datocms-react-ui/RowList';
import SidebarPanel, {
  type SidebarPanelCollapse,
} from 'datocms-react-ui/SidebarPanel';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useRef, useState } from 'react';
import { PenIcon } from '../icons';
import { countLabel, placeName } from '../report/format';
import {
  groupFacts,
  pageCount,
  type RecordUsagePreview,
  recordUsagePage,
} from '../report/view';
import type { LinkGroup } from '../types';
import { ExternalLink } from '../ui/ExternalLink';
import styles from './Detail.module.css';

const RECORD_CHUNK = 50;
const PLACES_PER_RECORD = 5;
const PAGINATE_ABOVE = 200;
/** The records of a widely used URL scroll inside their section. */
const RECORDS_MAX_HEIGHT = 400;

type UsedInPanelProps = {
  group: LinkGroup;
  changedRecordIds: ReadonlySet<string>;
  /** On a multi-locale site each place names its locale. */
  showLocale: boolean;
  uiLocale: string;
  /** The open state of the section, kept by the report across rows. */
  collapse: SidebarPanelCollapse;
  onOpenRecord: (recordId: string) => void;
};

type RecordEntryProps = {
  record: RecordUsagePreview;
  groupUrl: string;
  changed: boolean;
  showLocale: boolean;
  uiLocale: string;
  onOpenRecord: (recordId: string) => void;
};

/** A record without an ID is told apart by its model, as the report groups it. */
function recordKey(record: RecordUsagePreview): string {
  return (
    record.recordId ??
    `unsaved:${record.occurrences[0]?.modelId ?? record.modelName}:${record.title}`
  );
}

/**
 * One record, an item of the list of records: its row opens it, and the
 * places that hold the URL follow right under the row. The kit's row caps
 * its content at a few lines (it cuts the rest), so five places can't sit
 * inside it; out of the row's button, a spelling of the URL that differs
 * stays a link of its own, in the text of its line.
 */
function RecordEntry({
  record,
  groupUrl,
  changed,
  showLocale,
  uiLocale,
  onOpenRecord,
}: RecordEntryProps) {
  const { recordId } = record;
  const extra = record.occurrenceCount - PLACES_PER_RECORD;
  const row = (
    <EntityRow
      layout="row"
      kicker={record.modelName}
      title={record.title}
      multilineTitle
      afterTitle={changed ? <Pill>Content changed</Pill> : undefined}
      trailing={
        recordId === undefined ? undefined : <PenIcon className={styles.pen} />
      }
    />
  );
  return (
    <li className={styles.record}>
      <RowList>
        {recordId === undefined ? (
          <RowList.Item>{row}</RowList.Item>
        ) : (
          <RowList.Item onClick={() => onOpenRecord(recordId)}>
            {row}
            {/* The row takes its name from its content, which comes first: then what it does. */}
            <span className="visually-hidden">, open record</span>
          </RowList.Item>
        )}
      </RowList>
      <div className={styles.places}>
        <ul>
          {record.occurrences.slice(0, PLACES_PER_RECORD).map((occurrence) => (
            <li key={occurrence.id}>
              {placeName(occurrence, uiLocale, showLocale)}
              {occurrence.url !== groupUrl && (
                <span className={styles.variant}>
                  Links to <ExternalLink url={occurrence.url} inText />
                </span>
              )}
            </li>
          ))}
        </ul>
        {extra > 0 && (
          <p>
            {countLabel(
              extra,
              'and 1 more place',
              'and {n} more places',
              uiLocale,
            )}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * After a page change, brings the top of the records back into view when it
 * scrolled above the panel: the pages sit under the last record.
 */
function revealTop(element: HTMLElement | null) {
  if (!element) return;
  for (let box = element.parentElement; box; box = box.parentElement) {
    const { overflowY } = getComputedStyle(box);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    if (box.scrollHeight <= box.clientHeight) continue;
    const offset =
      element.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (offset < 0) box.scrollTop += offset;
    return;
  }
}

/**
 * The records that use the open URL, grouped by record in discovery order:
 * 50 at first and 50 more on each step, or pages of 50 above 200 records.
 */
export function UsedInPanel({
  group,
  changedRecordIds,
  showLocale,
  uiLocale,
  collapse,
  onOpenRecord,
}: UsedInPanelProps) {
  const [limit, setLimit] = useState(RECORD_CHUNK);
  const [page, setPage] = useState(1);
  const recordsRef = useRef<HTMLUListElement>(null);
  const total = groupFacts(group).recordCount;
  const paginated = total > PAGINATE_ABOVE;
  const current = Math.min(page, pageCount(total, RECORD_CHUNK));
  const records = recordUsagePage(
    group,
    paginated ? current : 1,
    paginated ? RECORD_CHUNK : limit,
    PLACES_PER_RECORD,
  );
  const remaining = total - limit;

  return (
    <SidebarPanel
      title="Records"
      count={total}
      flush
      maxHeight={RECORDS_MAX_HEIGHT}
      collapse={collapse}
    >
      {/* One list of records, each with its row and its places. */}
      <ul ref={recordsRef} className={styles.records}>
        {records.map((record) => {
          const { recordId } = record;
          return (
            <RecordEntry
              key={recordKey(record)}
              record={record}
              groupUrl={group.prepared.url}
              changed={recordId !== undefined && changedRecordIds.has(recordId)}
              showLocale={showLocale}
              uiLocale={uiLocale}
              onOpenRecord={onOpenRecord}
            />
          );
        })}
      </ul>
      {paginated ? (
        <Toolbar>
          <Toolbar.Pagination
            ariaLabel="Records using this URL"
            compact
            currentPage={current - 1}
            perPage={RECORD_CHUNK}
            totalEntries={total}
            onChange={(next) => {
              setPage(next + 1);
              revealTop(recordsRef.current);
            }}
          />
        </Toolbar>
      ) : (
        remaining > 0 && (
          <div className={styles.more}>
            <SidebarPanel.Action
              label={countLabel(
                Math.min(RECORD_CHUNK, remaining),
                'Show 1 more record',
                'Show {n} more records',
                uiLocale,
              )}
              onClick={() => setLimit((value) => value + RECORD_CHUNK)}
            />
          </div>
        )
      )}
    </SidebarPanel>
  );
}
