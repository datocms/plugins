import Callout from 'datocms-react-ui/Callout';
import {
  type DateSettings,
  useDateSettings,
} from 'datocms-react-ui/DateSettings';
import { formatDateTime } from 'datocms-react-ui/utils/formatDate';
import type { Ref } from 'react';
import { countLabel, joinFacts } from '../report/format';
import { type ScanProgress, scanProgress } from '../report/view';
import type { ScanReport } from '../types';
import {
  CoverageCallout,
  coverageText,
  type IssueListState,
  type SettledPhase,
} from './CoverageCallout';
import styles from './Notices.module.css';
import type { SettledScan } from './useSettledScan';

const SETTLED: Record<
  SettledPhase,
  { title: string; tone: 'neutral' | 'warning' }
> = {
  complete: { title: 'Scan complete', tone: 'neutral' },
  partial: { title: 'Scan incomplete', tone: 'warning' },
  cancelled: { title: 'Scan canceled', tone: 'warning' },
};

/**
 * Two sentences, so the note has a title: the tag of the changed URLs in the
 * table. The next step is the title bar's "Scan links".
 */
const STALE_TITLE = 'Content changed';
const STALE_TEXT =
  'Records changed after this scan, so some results may be out of date. Scan again to refresh them.';

/** During a recheck the report reads as running, so the settled scan decides. */
function summaryPhase(report: ScanReport, settled?: SettledScan): SettledPhase {
  const state = settled?.state ?? report.state;
  return state === 'running' ? 'complete' : state;
}

/** The headline of a settled scan: "Scan complete". */
export function summaryHeadline(
  report: ScanReport,
  settled?: SettledScan,
): string {
  return SETTLED[summaryPhase(report, settled)].title;
}

function settledMeta(
  scope: string,
  progress: ScanProgress,
  phase: SettledPhase,
  uiLocale: string,
  dateSettings: DateSettings,
  finishedAt?: string,
) {
  const records = countLabel(
    progress.records,
    '1 record read',
    '{n} records read',
    uiLocale,
  );
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
  // "Finished today, 14:32", in the user's date settings.
  const time =
    finishedAt &&
    `${phase === 'cancelled' ? 'Stopped' : 'Finished'} ${formatDateTime(finishedAt, dateSettings, 'today')}`;
  return joinFacts([scope, records, found, attention, blocked, time]);
}

type ScanSummaryProps = {
  /** The report as the view reads it (a rechecked URL keeps its previous result). */
  report: ScanReport;
  settled?: SettledScan;
  /** URLs that ended as "Not checked". */
  notCheckedCount: number;
  /** The list pane is narrow: the pages of the content issues show fewer numbers. */
  compactPagination?: boolean;
  /** How the content issues show, kept by the report from the running scan on. */
  issueList?: IssueListState;
  uiLocale: string;
};

/**
 * The summary callout of a settled scan: how it ended (complete, incomplete
 * or canceled), what it leaves out and its facts (what it covered and when it
 * finished). When records changed after the scan, a note of its own follows
 * the summary and the controls of its list. The title bar's "Scan links"
 * scans again, so neither callout holds an action.
 */
export function ScanSummary({
  report,
  settled,
  notCheckedCount,
  compactPagination,
  issueList,
  uiLocale,
}: ScanSummaryProps) {
  const dateSettings = useDateSettings();
  const phase = summaryPhase(report, settled);
  const { title, tone } = SETTLED[phase];
  const { lead, listIntro } = coverageText(
    phase,
    report.warnings,
    notCheckedCount,
    uiLocale,
  );
  const meta = settledMeta(
    report.scope,
    scanProgress(report),
    phase,
    uiLocale,
    dateSettings,
    settled?.finishedAt ?? report.finishedAt,
  );

  return (
    <>
      <CoverageCallout
        tone={tone}
        title={title}
        lead={lead}
        listIntro={listIntro}
        warnings={report.warnings}
        compactPagination={compactPagination}
        issueList={issueList}
        uiLocale={uiLocale}
      >
        <p>{meta}</p>
      </CoverageCallout>
      {report.stale && (
        <Callout title={STALE_TITLE} className={styles.callout}>
          {STALE_TEXT}
        </Callout>
      )}
    </>
  );
}

/**
 * The settled headline for screen readers ("Scan complete", "Scan
 * incomplete", "Scan canceled"). Mount it with the report, before the scan
 * settles: a live region announces what changes in it, not what it holds
 * when it appears. It stays empty while a scan runs.
 */
export function ScanAnnouncement({
  report,
  settled,
  scanning,
  ref,
}: {
  report: ScanReport;
  settled?: SettledScan;
  scanning: boolean;
  /** Always mounted at the top of the list area, so the list can find its scroll box from it. */
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className="visually-hidden" role="status">
      {scanning ? '' : summaryHeadline(report, settled)}
    </div>
  );
}
