import { faPenToSquare } from '@fortawesome/free-regular-svg-icons';
import { useId, useState } from 'react';
import { countLabel, placeName } from '../report/format';
import {
  groupFacts,
  pageCount,
  type RecordUsagePreview,
  recordUsagePage,
} from '../report/view';
import type { LinkGroup } from '../types';
import { Button } from '../ui/Button';
import { ExternalLink } from '../ui/ExternalLink';
import { Icon } from '../ui/Icon';
import { PlaceLabel } from '../ui/PlaceLabel';

const RECORD_CHUNK = 50;
const PLACES_PER_RECORD = 5;
const PAGINATE_ABOVE = 200;

type UsedInPanelProps = {
  group: LinkGroup;
  changedRecordIds: ReadonlySet<string>;
  /** On a multi-locale site each place names its locale. */
  showLocale: boolean;
  uiLocale: string;
  onOpenRecord: (recordId: string) => void;
};

type RecordContentProps = {
  record: RecordUsagePreview;
  groupUrl: string;
  changed: boolean;
  showLocale: boolean;
  uiLocale: string;
};

function moreText(extra: number, uiLocale: string) {
  return countLabel(extra, 'and 1 more place', 'and {n} more places', uiLocale);
}

function RecordContent({
  record,
  groupUrl,
  changed,
  showLocale,
  uiLocale,
}: RecordContentProps) {
  const extra = record.occurrenceCount - PLACES_PER_RECORD;
  return (
    <span className="dl-record">
      <span className="dl-record__model">{record.modelName}</span>
      <span className="dl-record__title">{record.title}</span>
      {/* On its own line, like the table's: the title's 2-line clamp would cut it off */}
      {changed && (
        <span className="dl-row-tag blc-record-row__tag">Content changed</span>
      )}
      {record.occurrences.slice(0, PLACES_PER_RECORD).map((occurrence) => (
        <span key={occurrence.id} className="blc-record-row__place">
          <PlaceLabel
            occurrence={occurrence}
            uiLocale={uiLocale}
            showLocale={showLocale}
          />
          {occurrence.url !== groupUrl && (
            <span className="blc-record-row__variant">
              Links to <ExternalLink url={occurrence.url} />
            </span>
          )}
        </span>
      ))}
      {extra > 0 && (
        <span className="blc-record-row__more">
          {moreText(extra, uiLocale)}
        </span>
      )}
    </span>
  );
}

/** What the row shows besides its title, for screen readers: the button's name is only "Open record …". */
function recordDescription({
  record,
  groupUrl,
  changed,
  showLocale,
  uiLocale,
}: RecordContentProps): string {
  const extra = record.occurrenceCount - PLACES_PER_RECORD;
  return [
    record.modelName,
    changed && 'Content changed',
    ...record.occurrences.slice(0, PLACES_PER_RECORD).map((occurrence) => {
      const place = placeName(occurrence, uiLocale, showLocale);
      return occurrence.url === groupUrl
        ? place
        : `${place}, links to ${occurrence.url}`;
    }),
    extra > 0 && moreText(extra, uiLocale),
  ]
    .filter(Boolean)
    .join('. ');
}

/**
 * The whole row opens the record: its button is stretched under the content,
 * so the URLs in the row stay real links above it (a link can't sit inside a
 * button).
 */
function RecordRow({
  onOpenRecord,
  ...props
}: RecordContentProps & { onOpenRecord: (recordId: string) => void }) {
  const descriptionId = useId();
  const { recordId, title } = props.record;
  if (recordId === undefined)
    return (
      <div className="blc-record-row">
        <RecordContent {...props} />
      </div>
    );
  return (
    <div className="blc-record-row blc-record-row--openable">
      <button
        type="button"
        className="blc-record-row__open"
        aria-label={`Open record ${title}`}
        aria-describedby={descriptionId}
        onClick={() => onOpenRecord(recordId)}
      />
      <RecordContent {...props} />
      <Icon icon={faPenToSquare} className="blc-record-row__icon" />
      <span id={descriptionId} hidden>
        {recordDescription(props)}
      </span>
    </div>
  );
}

/** The records that use the selected URL, grouped by record; each row opens the record. */
export function UsedInPanel({
  group,
  changedRecordIds,
  showLocale,
  uiLocale,
  onOpenRecord,
}: UsedInPanelProps) {
  const [limit, setLimit] = useState(RECORD_CHUNK);
  const [page, setPage] = useState(1);
  const total = groupFacts(group).recordCount;
  const paginated = total > PAGINATE_ABOVE;
  const pages = pageCount(total, RECORD_CHUNK);
  const current = Math.min(page, pages);
  const records = recordUsagePage(
    group,
    paginated ? current : 1,
    paginated ? RECORD_CHUNK : limit,
    PLACES_PER_RECORD,
  );
  const remaining = total - limit;

  return (
    <ul className="blc-records">
      {records.map((record) => {
        const { recordId } = record;
        return (
          <li key={recordId ?? `${record.modelName}:${record.title}`}>
            <RecordRow
              record={record}
              groupUrl={group.prepared.url}
              changed={recordId !== undefined && changedRecordIds.has(recordId)}
              showLocale={showLocale}
              uiLocale={uiLocale}
              onOpenRecord={onOpenRecord}
            />
          </li>
        );
      })}
      {paginated ? (
        <li className="blc-records__more">
          <nav className="dl-pagination" aria-label="Records using this URL">
            <button
              type="button"
              className="dl-pagination__nav"
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
            >
              « Previous
            </button>
            <span>
              Page {current.toLocaleString(uiLocale)} of{' '}
              {pages.toLocaleString(uiLocale)}
            </span>
            <button
              type="button"
              className="dl-pagination__nav"
              disabled={current >= pages}
              onClick={() => setPage(current + 1)}
            >
              Next »
            </button>
          </nav>
        </li>
      ) : remaining > 0 ? (
        <li className="blc-records__more">
          <Button
            buttonSize="xs"
            fullWidth
            onClick={() => setLimit((value) => value + RECORD_CHUNK)}
          >
            {countLabel(
              Math.min(RECORD_CHUNK, remaining),
              'Show 1 more record',
              'Show {n} more records',
              uiLocale,
            )}
          </Button>
        </li>
      ) : null}
    </ul>
  );
}
