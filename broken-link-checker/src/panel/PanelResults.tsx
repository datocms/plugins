import {
  faCircleCheck,
  faCircleQuestion,
  faCircleStop,
  type IconDefinition,
} from '@fortawesome/free-regular-svg-icons';
import {
  faChevronRight,
  faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';
import {
  countLabel,
  FACT_SEPARATOR,
  joinFacts,
  placeName,
} from '../report/format';
import {
  ATTENTION,
  countStatuses,
  hasFragment,
  resultExplanation,
  type Sort,
  type StatusCounts,
  sortGroups,
} from '../report/view';
import type { LinkGroup, LinkOccurrence, ScanReport } from '../types';
import { ExternalLink } from '../ui/ExternalLink';
import { Icon } from '../ui/Icon';
import { LinkButton } from '../ui/LinkButton';
import { LogStatus } from '../ui/LogStatus';
import { PlaceLabel } from '../ui/PlaceLabel';

const URLS_PER_STEP = 10;
const PLACES_SHOWN = 5;
const BY_SEVERITY: Sort = { key: 'status', direction: 'asc' };

type Tone = 'success' | 'danger' | 'warning' | 'subtle';

function Mark({ tone, icon }: { tone: Tone; icon: IconDefinition }) {
  return (
    <span className={`blc-mark blc-mark--${tone}`}>
      <Icon icon={icon} />
    </span>
  );
}

function attentionCount(counts: StatusCounts): number {
  return counts.broken + counts.invalid + counts.unverified + counts.cancelled;
}

function attentionMark(counts: StatusCounts) {
  if (counts.broken + counts.invalid > 0)
    return <Mark tone="danger" icon={faCircleExclamation} />;
  if (counts.unverified > 0)
    return <Mark tone="warning" icon={faCircleQuestion} />;
  return <Mark tone="subtle" icon={faCircleStop} />;
}

function attentionText(attention: number, total: number, uiLocale: string) {
  if (attention === total)
    return countLabel(
      attention,
      '1 URL needs attention',
      '{n} URLs need attention',
      uiLocale,
    );
  const of = total.toLocaleString(uiLocale);
  return countLabel(
    attention,
    `1 of ${of} URLs needs attention`,
    `{n} of ${of} URLs need attention`,
    uiLocale,
  );
}

type SummaryProps = {
  report: ScanReport;
  uiLocale: string;
};

/** Null after a partial or canceled read with no URLs: the callout explains the gap instead. */
function emptyText({ report }: SummaryProps) {
  return report.state === 'complete' ? 'No links in this record' : null;
}

/** Blocked URLs aren't problems, but they aren't verified either. */
function blockedText(blocked: number, uiLocale: string) {
  if (blocked === 0) return undefined;
  return countLabel(blocked, '1 blocked', '{n} blocked', uiLocale);
}

function foundText(total: number, uiLocale: string) {
  return countLabel(total, '1 URL found', '{n} URLs found', uiLocale);
}

/** The settled headline as plain text, for the panel's live region. */
export function panelSummaryText(props: SummaryProps): string {
  const { report, uiLocale } = props;
  const total = report.groups.length;
  if (total === 0) return emptyText(props) ?? '';
  const counts = countStatuses(report.groups);
  const attention = attentionCount(counts);
  const blocked = blockedText(counts.blocked, uiLocale);
  if (attention === 0)
    return `Nothing needs attention. ${joinFacts([foundText(total, uiLocale), blocked])}`;
  return joinFacts([attentionText(attention, total, uiLocale), blocked]);
}

/** The settled headline. RecordPanel's live region announces it, so it isn't a status itself. */
export function PanelSummary(props: SummaryProps) {
  const { report, uiLocale } = props;
  const total = report.groups.length;
  if (total === 0) {
    const empty = emptyText(props);
    return empty ? <p className="dl-panel-empty">{empty}</p> : null;
  }
  const counts = countStatuses(report.groups);
  const attention = attentionCount(counts);
  const blocked = blockedText(counts.blocked, uiLocale);
  if (attention === 0)
    return (
      <p className="blc-panel-summary">
        <Mark tone="success" icon={faCircleCheck} />
        <span>
          Nothing needs attention
          <span className="blc-panel-summary__meta">
            {joinFacts([foundText(total, uiLocale), blocked])}
          </span>
        </span>
      </p>
    );
  return (
    <p className="blc-panel-summary">
      {attentionMark(counts)}
      <span>
        {attentionText(attention, total, uiLocale)}
        {blocked && <span className="blc-panel-summary__meta">{blocked}</span>}
      </span>
    </p>
  );
}

type PanelResultProps = {
  group: LinkGroup;
  showLocale: boolean;
  uiLocale: string;
  onGoToField: (occurrence: LinkOccurrence) => void;
};

/** The whole row goes to the field; its name reads the location in the order it's shown. */
function PanelPlace({
  occurrence,
  showLocale,
  uiLocale,
  onGoToField,
}: Omit<PanelResultProps, 'group'> & { occurrence: LinkOccurrence }) {
  return (
    <li>
      <button
        type="button"
        className="blc-place"
        aria-label={`Go to field: ${placeName(occurrence, uiLocale, showLocale)}`}
        onClick={() => onGoToField(occurrence)}
      >
        <PlaceLabel
          occurrence={occurrence}
          uiLocale={uiLocale}
          showLocale={showLocale}
        />
        <Icon icon={faChevronRight} className="blc-place__icon" />
      </button>
    </li>
  );
}

function PanelResult({
  group,
  showLocale,
  uiLocale,
  onGoToField,
}: PanelResultProps) {
  const [allPlaces, setAllPlaces] = useState(false);
  const { result, occurrences } = group;
  const places = allPlaces ? occurrences : occurrences.slice(0, PLACES_SHOWN);
  const morePlaces = occurrences.length - places.length;
  return (
    <li className="blc-panel-result">
      <div className="blc-panel-result__url">
        <ExternalLink url={occurrences[0]?.url ?? group.prepared.url} />
      </div>
      <div className="blc-panel-result__status">
        <LogStatus status={result.status} />
        {result.httpStatus !== undefined && (
          <span className="blc-panel-result__http">
            {`${FACT_SEPARATOR}HTTP ${result.httpStatus}`}
          </span>
        )}
      </div>
      {resultExplanation(result) && (
        <div className="blc-note blc-panel-result__reason">
          {resultExplanation(result)}
        </div>
      )}
      {hasFragment(group) && (
        <div className="blc-note blc-panel-result__note">
          The #fragment is not checked
        </div>
      )}
      <ul className="blc-panel-where">
        {places.map((occurrence) => (
          <PanelPlace
            key={occurrence.id}
            occurrence={occurrence}
            showLocale={showLocale}
            uiLocale={uiLocale}
            onGoToField={onGoToField}
          />
        ))}
      </ul>
      {morePlaces > 0 && (
        <div className="blc-panel-where__more">
          <LinkButton onClick={() => setAllPlaces(true)}>
            {countLabel(
              morePlaces,
              'Show 1 more place',
              'Show {n} more places',
              uiLocale,
            )}
          </LinkButton>
        </div>
      )}
    </li>
  );
}

/**
 * URLs by severity, then discovery order. Attention items stream in while a
 * check runs; the rest wait behind "Show all".
 */
export function PanelResults({
  report,
  showLocale,
  uiLocale,
  onGoToField,
}: {
  report?: ScanReport;
  /** On a multi-locale site each place names its locale. */
  showLocale: boolean;
  uiLocale: string;
  onGoToField: (occurrence: LinkOccurrence) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [limit, setLimit] = useState(URLS_PER_STEP);
  if (!report) return null;
  const sorted = sortGroups(report.groups, BY_SEVERITY);
  const attention = sorted.filter((group) =>
    ATTENTION.has(group.result.status),
  );
  const items = showAll ? sorted : attention;
  const hidden = items.length - limit;
  const canToggle =
    report.state !== 'running' && attention.length < sorted.length;
  const toggle = () => {
    setShowAll((value) => !value);
    setLimit(URLS_PER_STEP);
  };
  return (
    <>
      {items.length > 0 && (
        <ul className="blc-panel-results">
          {items.slice(0, limit).map((group) => (
            <PanelResult
              key={group.key}
              group={group}
              showLocale={showLocale}
              uiLocale={uiLocale}
              onGoToField={onGoToField}
            />
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <div>
          <LinkButton
            onClick={() => setLimit((value) => value + URLS_PER_STEP)}
          >
            {countLabel(
              Math.min(hidden, URLS_PER_STEP),
              'Show 1 more URL',
              'Show {n} more URLs',
              uiLocale,
            )}
          </LinkButton>
        </div>
      )}
      {canToggle && (
        <div>
          <LinkButton onClick={toggle}>
            {showAll
              ? 'Show only URLs that need attention'
              : countLabel(
                  sorted.length,
                  'Show 1 URL',
                  'Show all {n} URLs',
                  uiLocale,
                )}
          </LinkButton>
        </div>
      )}
    </>
  );
}
