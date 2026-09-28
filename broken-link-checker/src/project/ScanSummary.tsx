import {
  faCircleCheck,
  faCircleStop,
  faClock,
  type IconDefinition,
} from '@fortawesome/free-regular-svg-icons';
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import {
  countLabel,
  formatDateTime,
  inSentence,
  joinFacts,
} from '../report/format';
import { type ScanProgress, scanProgress } from '../report/view';
import type { ScanReport } from '../types';
import { Icon } from '../ui/Icon';
import { LinkButton } from '../ui/LinkButton';
import { DisabledReason } from '../ui/WithTooltip';
import type { SettledScan } from './useSettledScan';

export type ScanAgain = {
  disabledReason: string | null;
  onClick: () => void;
};

type ScanSummaryProps = {
  report: ScanReport;
  settled?: SettledScan;
  uiLocale: string;
  /** Passed only when the stale line carries the action (no coverage callout). */
  scanAgain?: ScanAgain;
};

type Phase = Exclude<ScanReport['state'], 'running'>;

const SETTLED: Record<
  Phase,
  { headline: string; icon: IconDefinition; tone: string }
> = {
  complete: { headline: 'Scan complete', icon: faCircleCheck, tone: 'success' },
  partial: {
    headline: 'Scan incomplete',
    icon: faTriangleExclamation,
    tone: 'warning',
  },
  cancelled: { headline: 'Scan canceled', icon: faCircleStop, tone: 'subtle' },
};

/** During a recheck the report reads as running, so the settled scan decides. */
function summaryPhase(report: ScanReport, settled?: SettledScan): Phase {
  const state = settled?.state ?? report.state;
  return state === 'running' ? 'complete' : state;
}

function recordsRead(progress: ScanProgress, uiLocale: string) {
  return countLabel(
    progress.records,
    '1 record read',
    '{n} records read',
    uiLocale,
  );
}

function settledMeta(
  scope: string,
  progress: ScanProgress,
  phase: Phase,
  uiLocale: string,
  finishedAt?: string,
) {
  const found =
    progress.found === 0
      ? 'No URLs found'
      : countLabel(progress.found, '1 URL found', '{n} URLs found', uiLocale);
  const attention =
    progress.attention > 0 &&
    countLabel(
      progress.attention,
      '1 needs attention',
      '{n} need attention',
      uiLocale,
    );
  // Blocked URLs aren't problems, but they aren't verified either: say how many.
  const blocked =
    progress.blocked > 0 &&
    countLabel(progress.blocked, '1 blocked', '{n} blocked', uiLocale);
  const time =
    finishedAt &&
    `${phase === 'cancelled' ? 'Stopped' : 'Finished'} ${inSentence(formatDateTime(finishedAt, uiLocale))}`;
  return joinFacts([
    scope,
    recordsRead(progress, uiLocale),
    found,
    attention,
    blocked,
    time,
  ]);
}

function ScanAgainLink({ disabledReason, onClick }: ScanAgain) {
  if (disabledReason === null)
    return <LinkButton onClick={onClick}>Scan again</LinkButton>;
  return (
    <DisabledReason reason={disabledReason}>
      <button
        type="button"
        className="dl-button dl-button--link"
        disabled
        style={{ pointerEvents: 'none' }}
      >
        Scan again
      </button>
    </DisabledReason>
  );
}

function SummaryMark({ phase }: { phase: Phase }) {
  const { icon, tone } = SETTLED[phase];
  return (
    <span className={`blc-mark blc-mark--${tone}`}>
      <Icon icon={icon} />
    </span>
  );
}

/**
 * A settled scan's state, shown once: headline, facts (starting with what the
 * scan covered) and the stale note. A running scan shows ScanProgressBlock instead.
 */
export function ScanSummary({
  report,
  settled,
  uiLocale,
  scanAgain,
}: ScanSummaryProps) {
  const phase = summaryPhase(report, settled);
  const meta = settledMeta(
    report.scope,
    scanProgress(report),
    phase,
    uiLocale,
    settled?.finishedAt ?? report.finishedAt,
  );

  return (
    <section aria-label="Scan summary">
      <h2 className="blc-summary__headline" aria-live="polite">
        <SummaryMark phase={phase} />
        {SETTLED[phase].headline}
      </h2>
      <p className="blc-summary__meta">{meta}</p>
      {report.stale && (
        <p className="blc-summary__stale">
          <span className="blc-mark blc-mark--subtle">
            <Icon icon={faClock} />
          </span>
          <span>
            Records changed after this scan, so some results may be out of date.
            {scanAgain && (
              <>
                {' '}
                <ScanAgainLink {...scanAgain} />
              </>
            )}
          </span>
        </p>
      )}
    </section>
  );
}
