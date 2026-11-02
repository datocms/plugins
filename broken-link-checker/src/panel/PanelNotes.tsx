import Callout from 'datocms-react-ui/Callout';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useState } from 'react';
import { countLabel, formatWarning } from '../report/format';
import { pageSlice, proxyRefused } from '../report/view';
import type { ScanReport } from '../types';
import { ProxyRefusedCallout } from '../ui/ProxyRefusedCallout';
import styles from './Panel.module.css';

const WARNINGS_SHOWN = 3;
const LARGE_WARNING_COUNT = 200;
const WARNINGS_PER_PAGE = 50;

type CoverageCalloutProps = {
  cancelled: boolean;
  warnings: readonly string[];
  /** No content could be read at all. */
  readNothing: boolean;
  uiLocale: string;
};

/** The callout's problem in a few words; when nothing was read, the reason below it says why. */
function calloutTitle(cancelled: boolean, listed: boolean) {
  if (cancelled) return 'Check canceled';
  return listed ? "Some content couldn't be read" : "Couldn't read the record";
}

/** The first items show above it, so it names the rest. */
function issuesToggleLabel(count: number, expanded: boolean, uiLocale: string) {
  if (expanded) return 'Show fewer fields';
  return countLabel(
    count - WARNINGS_SHOWN,
    'Show 1 more field',
    count > LARGE_WARNING_COUNT
      ? 'Browse {n} more fields'
      : 'Show {n} more fields',
    uiLocale,
  );
}

/** The content that couldn't be read, as a list: 3 at first, then all, or pages of 50 above 200. */
function shownIssues(
  warnings: readonly string[],
  expanded: boolean,
  page: number,
): readonly string[] {
  if (!expanded) return warnings.slice(0, WARNINGS_SHOWN);
  if (warnings.length > LARGE_WARNING_COUNT)
    return pageSlice(warnings, page + 1, WARNINGS_PER_PAGE);
  return warnings;
}

/**
 * The content a check couldn't read. When nothing could be read, the reason
 * alone is the message. Otherwise it is a list; its action and its pages sit
 * right under the callout, since a callout holds no buttons.
 */
function CoverageCallout({
  cancelled,
  warnings,
  readNothing,
  uiLocale,
}: CoverageCalloutProps) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const reasonsOnly = readNothing && warnings.length <= LARGE_WARNING_COUNT;
  const listed = warnings.length > 0 && !reasonsOnly;
  const canToggle = listed && warnings.length > WARNINGS_SHOWN;
  return (
    <>
      <Callout
        tone="warning"
        title={calloutTitle(cancelled, listed)}
        className={canToggle ? styles.calloutAboveControls : undefined}
      >
        {reasonsOnly &&
          warnings.map((warning) => (
            <p key={warning}>{formatWarning(warning, uiLocale)}</p>
          ))}
        {listed && (
          <>
            <p>
              {cancelled
                ? "Some content couldn't be read, so its links weren't checked:"
                : "Its links weren't checked:"}
            </p>
            <ul>
              {shownIssues(warnings, expanded, page).map((warning) => (
                <li key={warning}>{formatWarning(warning, uiLocale)}</li>
              ))}
            </ul>
          </>
        )}
      </Callout>
      {canToggle && (
        <div className={styles.controls}>
          <SidebarPanel.Action
            label={issuesToggleLabel(warnings.length, expanded, uiLocale)}
            onClick={() => setExpanded((value) => !value)}
          />
        </div>
      )}
      {canToggle && expanded && warnings.length > LARGE_WARNING_COUNT && (
        <Toolbar className={styles.pages}>
          <Toolbar.Pagination
            ariaLabel="Content issues"
            compact
            currentPage={page}
            perPage={WARNINGS_PER_PAGE}
            totalEntries={warnings.length}
            onChange={setPage}
          />
        </Toolbar>
      )}
    </>
  );
}

/**
 * What limits the settled results: a refused check, a stale form, content
 * that couldn't be read. A cancel the user just made needs no callout: the
 * summary counts the links that weren't checked, or says "Check canceled"
 * when none were found.
 */
export function PanelNotes({
  report,
  running,
  uiLocale,
}: {
  report?: ScanReport;
  running: boolean;
  uiLocale: string;
}) {
  if (!report || running) return null;
  const cancelled = report.state === 'cancelled';
  return (
    <>
      {proxyRefused(report.groups) && <ProxyRefusedCallout />}
      {report.stale === true && (
        <Callout title="Results out of date">
          The record changed after this check. Check again to refresh the
          results.
        </Callout>
      )}
      {report.warnings.length > 0 && (
        <CoverageCallout
          cancelled={cancelled}
          warnings={report.warnings}
          readNothing={report.recordsScanned === 0}
          uiLocale={uiLocale}
        />
      )}
    </>
  );
}
