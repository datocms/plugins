import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import RowList from 'datocms-react-ui/RowList';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useMemo, useState } from 'react';
import { ChevronRightIcon } from '../icons';
import { countLabel } from '../report/format';
import {
  countStatuses,
  hasFragment,
  pageSlice,
  resultExplanation,
  resultNeedsAttention,
  type Sort,
  type StatusCounts,
  shownStatus,
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

/**
 * The links with a problem. Those that weren't checked ("Not checked"), by a
 * canceled check or a refused one, count apart: they aren't known to have one.
 */
function problemCount(counts: StatusCounts): number {
  return counts.broken + counts.invalid + counts.unverified;
}

/** The dot of the headline: the worst result that needs attention. */
function summaryTone(counts: StatusCounts): StatusTone {
  if (counts.broken + counts.invalid > 0) return 'danger';
  if (counts.unverified > 0) return 'warning';
  if (counts.cancelled > 0) return 'neutral';
  return 'success';
}

/** "3 of 12 links need attention", or "12 links need attention" for all of them. */
function shareText(
  count: number,
  total: number,
  [one, other]: [string, string],
  uiLocale: string,
) {
  if (count === total)
    return countLabel(count, `1 link ${one}`, `{n} links ${other}`, uiLocale);
  // Fewer than all of them: the total is at least 2.
  const of = countLabel(total, '1 link', '{n} links', uiLocale);
  return countLabel(
    count,
    `1 of ${of} ${one}`,
    `{n} of ${of} ${other}`,
    uiLocale,
  );
}

const NEEDS_ATTENTION: [string, string] = ['needs attention', 'need attention'];
const NOT_CHECKED: [string, string] = ["wasn't checked", "weren't checked"];

type SummaryProps = {
  report: ScanReport;
  uiLocale: string;
};

/**
 * What the panel says without links: none in the record, or a check canceled
 * before it found any. Null when content couldn't be read: the callout
 * explains the gap instead.
 */
function emptyText({ report }: SummaryProps) {
  if (report.state === 'complete') return 'No links in this record';
  if (report.state === 'cancelled' && report.warnings.length === 0)
    return 'Check canceled';
  return null;
}

/**
 * The headline and the fact under it: the links with a problem, then those
 * that weren't checked; else those that weren't checked, then nothing; else
 * how many were found.
 */
function summaryLines(report: ScanReport, uiLocale: string) {
  const total = report.groups.length;
  const counts = countStatuses(report.groups);
  const problems = problemCount(counts);
  const notChecked = counts.cancelled;
  if (problems > 0)
    return {
      counts,
      headline: shareText(problems, total, NEEDS_ATTENTION, uiLocale),
      meta:
        notChecked > 0
          ? countLabel(notChecked, '1 not checked', '{n} not checked', uiLocale)
          : undefined,
    };
  if (notChecked > 0)
    return {
      counts,
      headline: shareText(notChecked, total, NOT_CHECKED, uiLocale),
    };
  return {
    counts,
    headline: 'Nothing needs attention',
    meta: countLabel(total, '1 link found', '{n} links found', uiLocale),
  };
}

/** The settled headline as plain text, for the panel's live region. */
export function panelSummaryText(props: SummaryProps): string {
  const { report, uiLocale } = props;
  if (report.groups.length === 0) return emptyText(props) ?? '';
  const { headline, meta } = summaryLines(report, uiLocale);
  return meta ? `${headline}. ${meta}` : headline;
}

/** The settled headline. RecordPanel's live region announces it, so it isn't a status itself. */
export function PanelSummary(props: SummaryProps) {
  const { report, uiLocale } = props;
  if (report.groups.length === 0) {
    const empty = emptyText(props);
    return empty ? <SidebarPanel.Blank message={empty} /> : null;
  }
  const { counts, headline, meta } = summaryLines(report, uiLocale);
  return (
    <div>
      <p>
        <FeedbackDot tone={summaryTone(counts)} /> {headline}
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

/** Where a link is, with the times it's there. */
type Place = { occurrence: LinkOccurrence; count: number };

/**
 * The occurrences in the same field, locale and block as one place: their
 * rows would read the same and go to the same field.
 */
function placesOf(occurrences: readonly LinkOccurrence[]): Place[] {
  const places = new Map<string, Place>();
  for (const occurrence of occurrences) {
    // The path names the top-level field; the label, the field in its block.
    const key = [
      occurrence.recordId ?? '',
      occurrence.fieldPath,
      occurrence.locale ?? '',
      ...occurrence.blockPath,
      occurrence.fieldLabel,
    ].join('\n');
    const place = places.get(key);
    if (place) place.count += 1;
    else places.set(key, { occurrence, count: 1 });
  }
  return [...places.values()];
}

/**
 * One link: the address, its result, and the places that hold it. Each
 * place is a row that goes to its field. 5 places at first; above 200, the
 * rest go in pages of 50.
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
  const allOfThem = useMemo(() => placesOf(occurrences), [occurrences]);
  const large = allOfThem.length > LARGE_PLACE_COUNT;
  const paginated = allPlaces && large;
  const places = paginated
    ? pageSlice(allOfThem, placePage + 1, PLACES_PER_PAGE)
    : allPlaces
      ? allOfThem
      : allOfThem.slice(0, PLACES_SHOWN);
  const morePlaces = allOfThem.length - places.length;
  const explanation = resultExplanation(result);
  return (
    <li className={styles.result}>
      <div>
        <ExternalLink url={occurrences[0]?.url ?? group.prepared.url} />
      </div>
      <div>
        <LogStatus status={shownStatus(result)} />
      </div>
      {explanation && <div className={styles.note}>{explanation}</div>}
      {hasFragment(group) && (
        <div className={styles.note}>The #fragment is not checked</div>
      )}
      <div>
        <RowList density="compact">
          {places.map(({ occurrence, count }) => (
            <RowList.Item
              key={occurrence.id}
              onClick={() => onGoToField(occurrence)}
            >
              <PlaceLabel
                occurrence={occurrence}
                uiLocale={uiLocale}
                showLocale={showLocale}
                count={count}
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
            // Each link's pages are a landmark of their own: its address tells them apart.
            ariaLabel={`Places of ${group.prepared.url}`}
            compact
            currentPage={placePage}
            perPage={PLACES_PER_PAGE}
            totalEntries={allOfThem.length}
            onChange={setPlacePage}
          />
        </Toolbar>
      )}
      {!paginated && morePlaces > 0 && (
        <div className={styles.controls}>
          <SidebarPanel.Action
            label={
              large
                ? countLabel(
                    allOfThem.length,
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
 * The label of the toggle between the links that need attention and all of
 * them. The status above already counts the links, so the label doesn't.
 */
function toggleLabel(
  showAll: boolean,
  attention: number,
  total: number,
  someNotChecked: boolean,
): string {
  if (showAll)
    return attention > 0 ? 'Show only links that need attention' : 'Hide links';
  if (attention > 0 && !someNotChecked)
    return 'Also show links without problems';
  return total === 1 ? 'Show the link' : 'Show all links';
}

/**
 * Links by severity, then discovery order. Links with a problem stream in
 * while a check runs; the rest wait behind "Also show links without
 * problems", or "Show all links" when none has a problem or some weren't
 * checked.
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
    resultNeedsAttention(group.result),
  );
  const items = showAll ? sorted : attention;
  const hidden = items.length - limit;
  const canToggle =
    report.state !== 'running' && attention.length < sorted.length;
  // Links that weren't checked aren't known to be without problems.
  const someNotChecked = sorted.some(
    (group) => shownStatus(group.result) === 'cancelled',
  );
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
            <SidebarPanel.Action
              label={countLabel(
                Math.min(hidden, URLS_PER_STEP),
                'Show 1 more link',
                'Show {n} more links',
                uiLocale,
              )}
              onClick={() => setLimit((value) => value + URLS_PER_STEP)}
            />
          )}
          {canToggle && (
            <SidebarPanel.Action
              label={toggleLabel(
                showAll,
                attention.length,
                sorted.length,
                someNotChecked,
              )}
              onClick={toggle}
            />
          )}
        </div>
      )}
    </>
  );
}
