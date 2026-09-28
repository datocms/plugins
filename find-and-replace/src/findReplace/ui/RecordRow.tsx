import { Spinner } from 'datocms-react-ui';
import {
  memo,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DisabledWithReason } from '../../ui/DisabledWithReason';
import {
  faArrowUpRightFromSquare,
  faCircleCheck,
  faCircleExclamation,
  faTriangleExclamation,
  Icon,
} from '../../ui/icons';
import { Tip } from '../../ui/Tip';
import {
  type FieldView,
  type MatchView,
  type RecordPublishStatus,
  type RecordRunStatus,
  type RecordView,
  UI_LIMITS,
} from '../contract';
import { STRINGS } from './copy';
import { FieldGroup } from './FieldGroup';
import { useResultsEnv } from './ResultsEnv';
import { TriCheckbox } from './TriCheckbox';

type VisibleField = { field: FieldView; matches: ReadonlyArray<MatchView> };

/** The first `limit` matches of the record in document order, grouped by field. */
export function visibleFields(
  fields: ReadonlyArray<FieldView>,
  limit: number,
): VisibleField[] {
  const visible: VisibleField[] = [];
  let left = limit;
  for (const field of fields) {
    if (left <= 0) {
      break;
    }
    const matches = field.matches.slice(0, left);
    left -= matches.length;
    if (matches.length > 0) {
      visible.push({ field, matches });
    }
  }
  return visible;
}

/** The record draws per-match checkboxes (2+ matches, not attempted, selection visible). */
export function hasMatchChecks(
  record: RecordView,
  selecting: boolean,
): boolean {
  if (!selecting) {
    return false;
  }
  for (const field of record.fields) {
    for (const match of field.matches) {
      if (match.selectable) {
        return true;
      }
    }
  }
  return false;
}

function countMatches(fields: ReadonlyArray<FieldView>): number {
  let count = 0;
  for (const field of fields) {
    count += field.matches.length;
  }
  return count;
}

function RecordStatus({
  status,
  publish,
}: {
  status: RecordRunStatus;
  publish: RecordPublishStatus;
}) {
  const { copy } = useResultsEnv();

  // Publishing comes after a successful write, so it replaces "Replaced".
  if (publish.kind === 'publishing') {
    return (
      <>
        <span className="fr-status-spinner">
          <Spinner size={20} placement="centered" />
        </span>
        <span className="fr-sr-only">{STRINGS.publishing}</span>
      </>
    );
  }
  if (publish.kind === 'published') {
    return (
      <span className="dl-log-status">
        <svg
          className="dl-status-dot dl-status-dot--published"
          viewBox="0 0 100 100"
          aria-hidden="true"
        >
          <circle cx="50" cy="50" r="45" />
        </svg>
        {STRINGS.published}
      </span>
    );
  }

  switch (status.kind) {
    case 'untouched':
      return null;
    case 'writing':
      return (
        <>
          <span className="fr-status-spinner">
            <Spinner size={20} placement="centered" />
          </span>
          <span className="fr-sr-only">{STRINGS.updating}</span>
        </>
      );
    case 'replaced':
      return (
        <span className="dl-log-status dl-log-status--success">
          <Icon glyph={faCircleCheck} />
          {copy.statusWord('replaced')}
        </span>
      );
    case 'skipped':
      return (
        <span className="dl-log-status dl-log-status--warning">
          <Icon glyph={faTriangleExclamation} />
          {copy.statusWord('skipped')}
        </span>
      );
    case 'failed':
      return (
        <span className="dl-log-status dl-log-status--failed">
          <Icon glyph={faCircleExclamation} />
          {copy.statusWord('failed')}
        </span>
      );
  }
}

/** ↗: a new-tab link, or (no internal domain) a same-tab button locked while a run is going. */
function OpenRecord({
  recordKey,
  runActive,
}: {
  recordKey: string;
  runActive: boolean;
}) {
  const { controller, navigateTo } = useResultsEnv();
  const link = controller.recordLink(recordKey);

  if (link.kind === 'href') {
    return (
      <Tip label={STRINGS.openRecordNewTab}>
        <a
          className="dl-icon-button fr-record__open"
          href={link.href}
          target="_blank"
          rel="noopener"
        >
          <Icon
            glyph={faArrowUpRightFromSquare}
            title={STRINGS.openRecordNewTab}
          />
        </a>
      </Tip>
    );
  }

  if (runActive) {
    return (
      <DisabledWithReason
        reason={STRINGS.openRecordDisabled}
        placement="top"
        className="fr-record__open"
      >
        <button
          type="button"
          className="dl-icon-button"
          disabled
          style={{ pointerEvents: 'none' }}
        >
          <Icon glyph={faArrowUpRightFromSquare} title={STRINGS.openRecord} />
        </button>
      </DisabledWithReason>
    );
  }

  return (
    <Tip label={STRINGS.openRecord}>
      <button
        type="button"
        className="dl-icon-button fr-record__open"
        onClick={() => navigateTo(link.path)}
      >
        <Icon glyph={faArrowUpRightFromSquare} title={STRINGS.openRecord} />
      </button>
    </Tip>
  );
}

type MoreLinksProps = {
  total: number;
  shown: number;
  onShow: (count: number) => void;
  containerRef: RefObject<HTMLDivElement | null>;
};

/** "Show N more matches" (up to 20 per click) and "Show fewer matches" (back to 3). */
function MoreLinks({ total, shown, onShow, containerRef }: MoreLinksProps) {
  const { copy } = useResultsEnv();
  const atRest = UI_LIMITS.matchesAtRest;
  const remaining = total - shown;
  const expanded = shown > atRest && total > atRest;

  if (remaining <= 0 && !expanded) {
    return null;
  }

  return (
    <div className="fr-record__more" ref={containerRef}>
      {remaining > 0 && (
        <button
          type="button"
          className="fr-link"
          onClick={() => onShow(shown + UI_LIMITS.matchesPerExpand)}
        >
          {copy.showMore(Math.min(UI_LIMITS.matchesPerExpand, remaining))}
        </button>
      )}
      {expanded && (
        <button
          type="button"
          className="fr-link"
          onClick={() => onShow(atRest)}
        >
          {STRINGS.showFewer}
        </button>
      )}
    </div>
  );
}

type RecordRowProps = {
  record: RecordView;
  /** The selection strip and checkboxes are drawn (selection not hidden). */
  selecting: boolean;
  /** Drawn but locked while a run is going. */
  selectionDisabled: boolean;
  /** A run is going (running or stopping). */
  runActive: boolean;
};

/** One record: strip checkbox, a one-line head (title, model · count, status, ↗), reason, match lines. */
export const RecordRow = memo(function RecordRow({
  record,
  selecting,
  selectionDisabled,
  runActive,
}: RecordRowProps) {
  const { controller, copy } = useResultsEnv();
  const titleId = useId();
  const [shown, setShown] = useState<number>(UI_LIMITS.matchesAtRest);
  const moreRef = useRef<HTMLDivElement>(null);
  const focusMoreRef = useRef(false);

  const total = countMatches(record.fields);
  const visible = useMemo(
    () => visibleFields(record.fields, shown),
    [record.fields, shown],
  );
  const title = copy.recordTitle(record.title, record.recordId);
  const reason =
    copy.statusReason(record.status) ?? copy.publishReason(record.publish);
  // A record left as it was keeps ↗ visible, to go and handle it there.
  const attention =
    record.status.kind === 'failed' ||
    record.status.kind === 'skipped' ||
    reason !== null;
  const classes = [
    'fr-record',
    attention ? 'fr-record--attention' : null,
    hasMatchChecks(record, selecting) ? 'fr-record--match-checks' : null,
  ]
    .filter(Boolean)
    .join(' ');

  // "Show more" / "Show fewer" keep the focus in the same row of links.
  useEffect(() => {
    if (focusMoreRef.current) {
      focusMoreRef.current = false;
      moreRef.current?.querySelector('button')?.focus();
    }
  });

  const showMatches = (count: number) => {
    focusMoreRef.current = true;
    setShown(count);
  };

  return (
    <section className={classes} aria-labelledby={titleId} tabIndex={-1}>
      {selecting &&
        (record.selectable ? (
          <label className="fr-record__check">
            <TriCheckbox
              state={record.inclusion}
              label={copy.recordCheckbox(title)}
              disabled={selectionDisabled}
              onChange={(included) =>
                controller.setRecordIncluded(record.key, included)
              }
            />
          </label>
        ) : (
          <div className="fr-record__check fr-record__check--empty" />
        ))}
      <div className="fr-record__main">
        <div className="fr-record__head">
          <div className="fr-record__heading">
            <span className="fr-record__title" id={titleId}>
              {title}
            </span>
            <span className="fr-record__meta">
              {copy.recordMeta(record.modelName, record.matchCount)}
            </span>
          </div>
          <div className="fr-record__status">
            <RecordStatus status={record.status} publish={record.publish} />
          </div>
          <OpenRecord recordKey={record.key} runActive={runActive} />
        </div>
        {reason && <p className="fr-record__reason">{reason}</p>}
        <div className="fr-record__fields">
          {visible.map(({ field, matches }) => (
            <FieldGroup
              key={field.key}
              field={field}
              matches={matches}
              selecting={selecting}
              selectionDisabled={selectionDisabled}
            />
          ))}
        </div>
        <MoreLinks
          total={total}
          shown={shown}
          onShow={showMatches}
          containerRef={moreRef}
        />
      </div>
    </section>
  );
});
