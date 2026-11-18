import Pill from 'datocms-react-ui/Pill';
import RecordRow from 'datocms-react-ui/RecordRow';
import RowList from 'datocms-react-ui/RowList';
import SidebarPanel, {
  type SidebarPanelCollapse,
} from 'datocms-react-ui/SidebarPanel';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useRef, useState } from 'react';
import { countLabel, placeName } from '../report/format';
import {
  groupFacts,
  pageCount,
  type RecordUsagePreview,
  recordUsagePage,
} from '../report/view';
import type { LinkGroup, LinkOccurrence } from '../types';
import styles from './Detail.module.css';

const RECORD_CHUNK = 50;
/**
 * The places that a row lists under the title of its record. The kit's row
 * cuts its content at a fixed height, so a record with more places lists the
 * first one and how many more there are.
 */
const PLACES_PER_RECORD = 2;
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

/** A record without an ID (an unsaved one) is told apart by its model, as the report groups it. */
function recordKey(record: RecordUsagePreview): string {
  return record.recordId ?? `unsaved:${record.modelId}`;
}

/** A place, and the spelling of the URL it links to when it differs from the link. */
function placeLine(
  occurrence: LinkOccurrence,
  groupUrl: string,
  uiLocale: string,
  showLocale: boolean,
): string {
  const place = placeName(occurrence, uiLocale, showLocale);
  return occurrence.url === groupUrl
    ? place
    : `${place} · links to ${occurrence.url}`;
}

/**
 * The lines under the title of a record: the places that hold the URL, or
 * the first one and how many more there are. A record that the user edited
 * since the scan says so first.
 */
function PlaceLines({
  record,
  groupUrl,
  changed,
  showLocale,
  uiLocale,
}: Omit<RecordEntryProps, 'onOpenRecord'>) {
  const all = record.occurrenceCount <= PLACES_PER_RECORD;
  const shown = record.occurrences.slice(0, all ? PLACES_PER_RECORD : 1);
  const extra = record.occurrenceCount - shown.length;
  return (
    <>
      {shown.map((occurrence, index) => (
        <span key={occurrence.id} className={styles.line}>
          {changed && index === 0 && (
            <>
              <Pill>Content changed</Pill>{' '}
            </>
          )}
          {placeLine(occurrence, groupUrl, uiLocale, showLocale)}
        </span>
      ))}
      {extra > 0 && (
        <span className={styles.line}>
          {countLabel(
            extra,
            'and 1 more place',
            'and {n} more places',
            uiLocale,
          )}
        </span>
      )}
    </>
  );
}

/**
 * One record, as DatoCMS lists records: the host gives its model, title,
 * image and status, and the places that hold the URL follow under the
 * title. The row opens the record.
 */
function RecordEntry({ onOpenRecord, ...props }: RecordEntryProps) {
  const { recordId, modelName } = props.record;
  const lines = <PlaceLines {...props} />;
  if (recordId === undefined)
    return (
      <RowList.Item>
        <RecordRow
          layout="row"
          model={{ name: modelName, draftModeActive: false }}
          presentation={{ title: 'New record', image: null }}
        >
          {lines}
        </RecordRow>
      </RowList.Item>
    );
  return (
    <RowList.Item onClick={() => onOpenRecord(recordId)}>
      <RecordRow layout="row" item={recordId} multilineTitle>
        {lines}
      </RecordRow>
      {/* The row takes its name from its content, which comes first: then what it does. */}
      <span className="visually-hidden">, open record</span>
    </RowList.Item>
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
  const recordsRef = useRef<HTMLDivElement>(null);
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
      maxHeight={RECORDS_MAX_HEIGHT}
      collapse={collapse}
    >
      {/* The pagination brings the top of the records back into view. */}
      <div ref={recordsRef}>
        <RecordRow.List>
          <RowList density="compact">
            {records.map((record) => {
              const { recordId } = record;
              return (
                <RecordEntry
                  key={recordKey(record)}
                  record={record}
                  groupUrl={group.prepared.url}
                  changed={
                    recordId !== undefined && changedRecordIds.has(recordId)
                  }
                  showLocale={showLocale}
                  uiLocale={uiLocale}
                  onOpenRecord={onOpenRecord}
                />
              );
            })}
          </RowList>
        </RecordRow.List>
      </div>
      {paginated ? (
        <Toolbar>
          <Toolbar.Pagination
            ariaLabel="Records using this link"
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
          <div>
            <SidebarPanel.Action
              label={{
                id: 'brokenLinkChecker.showMoreRecords',
                values: { count: Math.min(RECORD_CHUNK, remaining) },
              }}
              onClick={() => setLimit((value) => value + RECORD_CHUNK)}
            />
          </div>
        )
      )}
    </SidebarPanel>
  );
}
