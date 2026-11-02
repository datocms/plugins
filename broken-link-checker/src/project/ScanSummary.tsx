import BlankSlate from 'datocms-react-ui/BlankSlate';
import {
  type DateSettings,
  useDateSettings,
} from 'datocms-react-ui/DateSettings';
import { formatDateTime } from 'datocms-react-ui/utils/formatDate';
import type { Ref } from 'react';
import { CircleExclamationIcon } from '../icons';
import { countLabel, joinFacts } from '../report/format';
import { proxyRefused, type ScanProgress, scanProgress } from '../report/view';
import type { ScanReport } from '../types';
import { REFUSED_TEXT, REFUSED_TITLE } from '../ui/ProxyRefusedCallout';
import {
  CoverageCallout,
  coverageText,
  type IssueListState,
  type SettledPhase,
} from './CoverageCallout';
import type { SettledScan } from './useSettledScan';

/**
 * A complete scan's callout has no title: the report under it says how it
 * went. The headline is only for screen readers.
 */
const SETTLED: Record<
  SettledPhase,
  { headline: string; title?: string; tone: 'neutral' | 'warning' }
> = {
  complete: { headline: 'Scan complete', tone: 'neutral' },
  partial: {
    headline: 'Scan incomplete',
    title: 'Scan incomplete',
    tone: 'warning',
  },
  cancelled: {
    headline: 'Scan canceled',
    title: 'Scan canceled',
    tone: 'warning',
  },
};

const FAILED_TITLE = "Couldn't read your records";

/** The pill "Content changed" marks the changed records and links. */
const STALE_TEXT =
  'Some records changed after this scan: scan again to refresh the report.';

/**
 * The title and tone of the summary callout. A canceled scan that read all
 * its content only reports the user's own stop: one sentence, then the facts.
 */
function calloutLook(
  phase: SettledPhase,
  refused: boolean,
  unread: boolean,
): { title?: string; tone: 'neutral' | 'warning' } {
  if (refused) return { title: REFUSED_TITLE, tone: 'warning' };
  if (phase === 'cancelled' && !unread) return { tone: 'neutral' };
  return SETTLED[phase];
}

/** During a recheck the report reads as running, so the settled scan decides. */
function summaryPhase(report: ScanReport, settled?: SettledScan): SettledPhase {
  const state = settled?.state ?? report.state;
  return state === 'running' ? 'complete' : state;
}

/**
 * A scan that ended without reading anything: every model it tried failed,
 * so it's a failure, not a report. When the count found no records, nothing
 * failed to read: the summary lists what the scan left out.
 */
export function readNothing(
  report: ScanReport,
  settled?: SettledScan,
  recordTotal?: number,
) {
  return (
    recordTotal !== 0 &&
    summaryPhase(report, settled) !== 'cancelled' &&
    report.recordsScanned === 0 &&
    report.groups.length === 0 &&
    report.warnings.length > 0
  );
}

/** The headline of a settled scan: "Scan complete". */
export function summaryHeadline(
  report: ScanReport,
  settled?: SettledScan,
  recordTotal?: number,
): string {
  if (readNothing(report, settled, recordTotal)) return FAILED_TITLE;
  if (proxyRefused(report.groups)) return REFUSED_TITLE;
  return SETTLED[summaryPhase(report, settled)].headline;
}

/**
 * The facts of a settled scan: what it covered, when the user narrowed it,
 * what it read and found, and when it ended. The title bar counts the links
 * of the view.
 */
function settledMeta(
  scope: string,
  progress: ScanProgress,
  phase: SettledPhase,
  notCheckedCount: number,
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
    progress.found > 0 &&
    countLabel(progress.found, '1 link found', '{n} links found', uiLocale);
  const notChecked =
    phase === 'cancelled' &&
    notCheckedCount > 0 &&
    countLabel(notCheckedCount, '1 not checked', '{n} not checked', uiLocale);
  // "Finished today, 14:32", in the user's date settings.
  const time =
    finishedAt &&
    `${phase === 'cancelled' ? 'Stopped' : 'Finished'} ${formatDateTime(finishedAt, dateSettings, 'today')}`;
  return joinFacts([scope, records, found, notChecked, time]);
}

/**
 * "Article: Access was refused." gives "Access was refused.": each reason
 * once, whichever models gave it.
 */
function failureReasons(warnings: readonly string[]): string {
  const reasons = new Set<string>();
  for (const warning of warnings) {
    const at = warning.indexOf(': ');
    reasons.add(at < 0 ? warning : warning.slice(at + 2));
  }
  return [...reasons].join(' ');
}

/** A scan that read nothing: the reason, once, in place of the report. */
export function ScanFailed({ report }: { report: ScanReport }) {
  return (
    <BlankSlate
      placement="area"
      error
      icon={<CircleExclamationIcon />}
      title={FAILED_TITLE}
      description={failureReasons(report.warnings)}
    />
  );
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
 * The summary callout of a settled scan: what it leaves out, when it is
 * incomplete or canceled, and its facts (what it covered and when it
 * finished). A refused check and records changed after the scan are said
 * here too, so callouts never stack. The title bar's "Scan links" scans
 * again, so the callout holds no action.
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
  const refused = proxyRefused(report.groups);
  const { lead, listIntro } = coverageText(
    phase,
    report.warnings,
    notCheckedCount,
    uiLocale,
  );
  const { title, tone } = calloutLook(phase, refused, listIntro !== undefined);
  const meta = settledMeta(
    report.scope,
    scanProgress(report),
    phase,
    notCheckedCount,
    uiLocale,
    dateSettings,
    settled?.finishedAt ?? report.finishedAt,
  );

  return (
    <CoverageCallout
      tone={tone}
      title={title}
      lead={refused ? REFUSED_TEXT : lead}
      listIntro={listIntro}
      warnings={report.warnings}
      compactPagination={compactPagination}
      issueList={issueList}
      uiLocale={uiLocale}
    >
      {report.stale && <p>{STALE_TEXT}</p>}
      <p>{meta}</p>
    </CoverageCallout>
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
  recordTotal,
  scanning,
  ref,
}: {
  report: ScanReport;
  settled?: SettledScan;
  /** The scan's record count, once known. */
  recordTotal?: number;
  scanning: boolean;
  /** Always mounted at the top of the list area, so the list can find its scroll box from it. */
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className="visually-hidden" role="status">
      {scanning ? '' : summaryHeadline(report, settled, recordTotal)}
    </div>
  );
}
