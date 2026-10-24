import Button from 'datocms-react-ui/Button';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import RowList from 'datocms-react-ui/RowList';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useState } from 'react';
import { ChevronRightIcon } from '../icons';
import { countLabel, FACT_SEPARATOR, joinFacts } from '../report/format';
import {
  ATTENTION,
  countStatuses,
  hasFragment,
  pageSlice,
  resultExplanation,
  type Sort,
  type StatusCounts,
  sortGroups,
} from '../report/view';
import type { LinkGroup, LinkOccurrence, ScanReport } from '../types';
import { ExternalLink } from '../ui/ExternalLink';
import { LogStatus, type StatusTone } from '../ui/LogStatus';
import { PlaceLabel } from '../ui/PlaceLabel';
import styles from './Panel.module.css';

const URLS_PER_STEP = 10;
const PLACES_SHOWN = 5;
const LARGE_PLACE_COUNT = 200;
const PLACES_PER_PAGE = 50;
const BY_SEVERITY: Sort = { key: 'status', direction: 'asc' };

function attentionCount(counts: StatusCounts): number {
  return counts.broken + counts.invalid + counts.unverified + counts.cancelled;
}

/** The dot of the headline: the worst result that needs attention. */
function summaryTone(counts: StatusCounts): StatusTone {
  if (attentionCount(counts) === 0) return 'success';
  if (counts.broken + counts.invalid > 0) return 'danger';
  if (counts.unverified > 0) return 'warning';
  return 'neutral';
}

function attentionText(attention: number, total: number, uiLocale: string) {
  if (attention === total)
    return countLabel(
      attention,
      '1 URL needs attention',
      '{n} URLs need attention',
      uiLocale,
    );
  // Fewer than all of them: the total is at least 2.
  const of = countLabel(total, '1 URL', '{n} URLs', uiLocale);
  return countLabel(
    attention,
    `1 of ${of} needs attention`,
    `{n} of ${of} need attention`,
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
    return empty ? <SidebarPanel.Blank message={empty} /> : null;
  }
  const counts = countStatuses(report.groups);
  const attention = attentionCount(counts);
  const blocked = blockedText(counts.blocked, uiLocale);
  const meta =
    attention === 0
      ? joinFacts([foundText(total, uiLocale), blocked])
      : blocked;
  return (
    <div>
      <p>
        <FeedbackDot tone={summaryTone(counts)} />{' '}
        {attention === 0
          ? 'Nothing needs attention'
          : attentionText(attention, total, uiLocale)}
      </p>
      {meta && <p className={styles.meta}>{meta}</p>}
    </div>
  );
}

type PanelResultProps = {
  group: LinkGroup;
  showLocale: boolean;
  uiLocale: string;
  onGoToField: (occurrence: LinkOccurrence) => void;
};

/**
 * One URL: the link, its result, and the places that hold it. Each place is
 * a row that goes to its field. 5 places at first; above 200, the rest go
 * in pages of 50.
 */
function PanelResult({
  group,
  showLocale,
  uiLocale,
  onGoToField,
}: PanelResultProps) {
  const [allPlaces, setAllPlaces] = useState(false);
  const [placePage, setPlacePage] = useState(0);
  const { result, occurrences } = group;
  const large = occurrences.length > LARGE_PLACE_COUNT;
  const paginated = allPlaces && large;
  const places = paginated
    ? pageSlice(occurrences, placePage + 1, PLACES_PER_PAGE)
    : allPlaces
      ? occurrences
      : occurrences.slice(0, PLACES_SHOWN);
  const morePlaces = occurrences.length - places.length;
  const explanation = resultExplanation(result);
  return (
    <li className={styles.result}>
      <div>
        <ExternalLink url={occurrences[0]?.url ?? group.prepared.url} />
      </div>
      <div>
        <LogStatus status={result.status} />
        {result.httpStatus !== undefined && (
          <span className={styles.subtle}>
            {`${FACT_SEPARATOR}HTTP ${result.httpStatus}`}
          </span>
        )}
      </div>
      {explanation && <div className={styles.note}>{explanation}</div>}
      {hasFragment(group) && (
        <div className={styles.note}>The #fragment is not checked</div>
      )}
      <div className={styles.places}>
        <RowList>
          {places.map((occurrence) => (
            <RowList.Item
              key={occurrence.id}
              onClick={() => onGoToField(occurrence)}
            >
              <PlaceLabel
                occurrence={occurrence}
                uiLocale={uiLocale}
                showLocale={showLocale}
                trailing={<ChevronRightIcon className={styles.chevron} />}
              />
              {/* The row takes its name from its content, which comes first: then where it goes. */}
              <span className="visually-hidden">, go to field</span>
            </RowList.Item>
          ))}
        </RowList>
      </div>
      {paginated && (
        <Toolbar>
          <Toolbar.Pagination
            // Each URL's pages are a landmark of their own: its URL tells them apart.
            ariaLabel={`Places of ${group.prepared.url}`}
            compact
            currentPage={placePage}
            perPage={PLACES_PER_PAGE}
            totalEntries={occurrences.length}
            onChange={setPlacePage}
          />
        </Toolbar>
      )}
      {!paginated && morePlaces > 0 && (
        <div className={styles.controls}>
          <Button
            tone="ghost"
            label={
              large
                ? countLabel(
                    occurrences.length,
                    'Browse 1 place',
                    'Browse {n} places',
                    uiLocale,
                  )
                : countLabel(
                    morePlaces,
                    'Show 1 more place',
                    'Show {n} more places',
                    uiLocale,
                  )
            }
            onClick={() => setAllPlaces(true)}
          />
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
        <ul className={styles.results}>
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
      {(hidden > 0 || canToggle) && (
        <div className={styles.controls}>
          {hidden > 0 && (
            <Button
              tone="ghost"
              label={countLabel(
                Math.min(hidden, URLS_PER_STEP),
                'Show 1 more URL',
                'Show {n} more URLs',
                uiLocale,
              )}
              onClick={() => setLimit((value) => value + URLS_PER_STEP)}
            />
          )}
          {canToggle && (
            <Button
              tone="ghost"
              label={
                showAll
                  ? 'Show only URLs that need attention'
                  : countLabel(
                      sorted.length,
                      'Show 1 URL',
                      'Show all {n} URLs',
                      uiLocale,
                    )
              }
              onClick={toggle}
            />
          )}
        </div>
      )}
    </>
  );
}
