import { useState } from 'react';
import { formatWarning } from '../report/format';
import { proxyRefused } from '../report/view';
import type { ScanReport } from '../types';
import { LinkButton } from '../ui/LinkButton';
import { ProxyRefusedCallout } from '../ui/ProxyRefusedCallout';

const WARNINGS_SHOWN = 3;
const LARGE_WARNING_COUNT = 200;
const WARNINGS_PER_PAGE = 50;

function PanelWarnings({
  warnings,
  uiLocale,
}: {
  warnings: readonly string[];
  uiLocale: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const paginated = expanded && warnings.length > LARGE_WARNING_COUNT;
  const pages = Math.ceil(warnings.length / WARNINGS_PER_PAGE);
  const current = Math.min(page, pages);
  const shown = paginated
    ? warnings.slice(
        (current - 1) * WARNINGS_PER_PAGE,
        current * WARNINGS_PER_PAGE,
      )
    : expanded
      ? warnings
      : warnings.slice(0, WARNINGS_SHOWN);
  return (
    <>
      <p>
        <strong>
          Some content couldn't be read, so its links weren't checked:
        </strong>
      </p>
      <ul className="blc-callout__list">
        {shown.map((warning) => (
          <li key={warning}>{formatWarning(warning, uiLocale)}</li>
        ))}
      </ul>
      {paginated && (
        <nav className="dl-pagination" aria-label="Content issues">
          <button
            type="button"
            className="dl-pagination__nav"
            disabled={current <= 1}
            onClick={() => setPage(current - 1)}
          >
            « Previous
          </button>
          <span>
            {current.toLocaleString(uiLocale)} of{' '}
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
      )}
      {warnings.length > WARNINGS_SHOWN && (
        <div className="blc-callout__toggle">
          <LinkButton onClick={() => setExpanded((value) => !value)}>
            {expanded
              ? 'Show fewer issues'
              : `${warnings.length > LARGE_WARNING_COUNT ? 'Browse' : 'Show all'} ${warnings.length.toLocaleString(uiLocale)} issues`}
          </LinkButton>
        </div>
      )}
    </>
  );
}

/** The settled results may be out of date once the content changes. */
function StaleNote({ stale }: { stale: boolean }) {
  if (!stale) return null;
  return (
    <p className="blc-note">
      The record changed after this check. Check again to refresh the results.
    </p>
  );
}

/** Why a check read nothing at all: the reason alone, without the partial-read intro. */
function UnreadNote({
  warnings,
  uiLocale,
}: {
  warnings: readonly string[];
  uiLocale: string;
}) {
  if (warnings.length > LARGE_WARNING_COUNT)
    return <PanelWarnings warnings={warnings} uiLocale={uiLocale} />;
  return (
    <>
      {warnings.map((warning) => (
        <p key={warning}>{formatWarning(warning, uiLocale)}</p>
      ))}
    </>
  );
}

/** What limits the settled results: a stale form, a canceled check, content that couldn't be read. */
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
  const hasWarnings = report.warnings.length > 0;
  return (
    <>
      {proxyRefused(report.groups) && <ProxyRefusedCallout compact />}
      <StaleNote stale={report.stale === true} />
      {(cancelled || hasWarnings) && (
        <div className="dl-callout dl-callout--warning blc-callout--compact">
          {cancelled && (
            <p>
              Check canceled. URLs that weren't checked show as "Not checked".
            </p>
          )}
          {hasWarnings &&
            (report.recordsScanned === 0 ? (
              <UnreadNote warnings={report.warnings} uiLocale={uiLocale} />
            ) : (
              <PanelWarnings warnings={report.warnings} uiLocale={uiLocale} />
            ))}
        </div>
      )}
    </>
  );
}
