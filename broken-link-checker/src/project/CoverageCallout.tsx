import { useState } from 'react';
import { countLabel, formatWarning } from '../report/format';
import type { ScanReport } from '../types';
import { Button } from '../ui/Button';
import { LinkButton } from '../ui/LinkButton';
import { DisabledReason } from '../ui/WithTooltip';
import type { ScanAgain } from './ScanSummary';

const COLLAPSED_WARNINGS = 5;
const WARNINGS_PER_PAGE = 50;
const PAGINATE_WARNINGS_ABOVE = 100;

type CoverageInput = {
  state: ScanReport['state'];
  scanning: boolean;
  warnings: readonly string[];
  notCheckedCount: number;
  uiLocale: string;
};

type CoverageCalloutProps = CoverageInput & { scanAgain: ScanAgain };

/** Whether the callout renders; the summary's stale line carries "Scan again" otherwise. */
export function hasCoverageCallout({
  state,
  scanning,
  warnings,
  notCheckedCount,
}: CoverageInput): boolean {
  if (scanning) return warnings.length > 0;
  if (state === 'cancelled') return true;
  return state === 'partial' && (warnings.length > 0 || notCheckedCount > 0);
}

function WarningList({
  intro,
  warnings,
  uiLocale,
}: {
  intro: string;
  warnings: readonly string[];
  uiLocale: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const paginated = warnings.length > PAGINATE_WARNINGS_ABOVE;
  const pages = Math.ceil(warnings.length / WARNINGS_PER_PAGE);
  const current = Math.min(page, pages);
  const shown = !expanded
    ? warnings.slice(0, COLLAPSED_WARNINGS)
    : paginated
      ? warnings.slice(
          (current - 1) * WARNINGS_PER_PAGE,
          current * WARNINGS_PER_PAGE,
        )
      : warnings;
  return (
    <>
      <p>{intro}</p>
      <ul className="blc-callout__list">
        {shown.map((warning) => (
          <li key={warning}>{formatWarning(warning, uiLocale)}</li>
        ))}
      </ul>
      {expanded && paginated && (
        <nav className="dl-pagination" aria-label="Content reading issues">
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
      )}
      {warnings.length > COLLAPSED_WARNINGS && (
        <LinkButton
          className="blc-callout__toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? 'Show fewer issues'
            : `Show ${paginated ? '' : 'all '}${warnings.length.toLocaleString(uiLocale)} issues`}
        </LinkButton>
      )}
    </>
  );
}

function CalloutText({
  state,
  scanning,
  warnings,
  notCheckedCount,
  uiLocale,
}: CoverageInput) {
  if (!scanning && state === 'cancelled')
    return (
      <>
        <p>
          You canceled this scan, so it covers only the records read and the
          URLs processed until then. URLs that weren't checked show as "Not
          checked".
        </p>
        {warnings.length > 0 && (
          <WarningList
            intro="Some content couldn't be read:"
            warnings={warnings}
            uiLocale={uiLocale}
          />
        )}
      </>
    );
  if (warnings.length > 0)
    return (
      <WarningList
        intro="Some content couldn't be read, so the links in it aren't in this report:"
        warnings={warnings}
        uiLocale={uiLocale}
      />
    );
  return (
    <p>
      {countLabel(
        notCheckedCount,
        "1 URL wasn't checked. Recheck it, or scan again.",
        "{n} URLs weren't checked. Recheck them one by one, or scan again.",
        uiLocale,
      )}
    </p>
  );
}

/** What the report doesn't cover. The summary headline carries the state word. */
export function CoverageCallout({ scanAgain, ...input }: CoverageCalloutProps) {
  if (!hasCoverageCallout(input)) return null;
  const { scanning } = input;
  const { disabledReason } = scanAgain;
  return (
    <div
      className={`dl-callout dl-callout--warning blc-callout${scanning ? '' : ' dl-callout--with-action'}`}
    >
      <div className="blc-callout__body">
        <CalloutText {...input} />
      </div>
      {!scanning && (
        <DisabledReason reason={disabledReason}>
          <Button
            buttonSize="s"
            disabled={disabledReason !== null}
            style={
              disabledReason === null ? undefined : { pointerEvents: 'none' }
            }
            onClick={scanAgain.onClick}
          >
            Scan again
          </Button>
        </DisabledReason>
      )}
    </div>
  );
}
