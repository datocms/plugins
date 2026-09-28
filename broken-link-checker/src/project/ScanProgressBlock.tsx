import { countLabel, joinFacts } from '../report/format';
import { type ScanProgress, settledUrls } from '../report/view';

type ScanProgressBlockProps = {
  /** "All models • All locales" */
  scope: string;
  progress: ScanProgress;
  /** 0 to 1, or null while the record count is unknown. */
  fraction: number | null;
  discovering: boolean;
  recordTotal?: number;
  /** Centered in the pane before any URL is found; above the results after. */
  centered: boolean;
  uiLocale: string;
};

function recordsFact(
  progress: ScanProgress,
  discovering: boolean,
  uiLocale: string,
  recordTotal?: number,
) {
  if (discovering && recordTotal !== undefined) {
    const read = progress.records.toLocaleString(uiLocale);
    return countLabel(
      recordTotal,
      `${read} of 1 record read`,
      `${read} of {n} records read`,
      uiLocale,
    );
  }
  return countLabel(
    progress.records,
    '1 record read',
    '{n} records read',
    uiLocale,
  );
}

function urlsFact(progress: ScanProgress, uiLocale: string) {
  if (progress.found === 0) return undefined;
  const done = settledUrls(progress).toLocaleString(uiLocale);
  return countLabel(
    progress.found,
    `${done} of 1 URL checked`,
    `${done} of {n} URLs checked`,
    uiLocale,
  );
}

/**
 * A running scan's one loading indicator: a title with the percentage, the
 * bar, and what has been read and checked so far. Without a record count the
 * bar sweeps until reading ends.
 */
export function ScanProgressBlock({
  scope,
  progress,
  fraction,
  discovering,
  recordTotal,
  centered,
  uiLocale,
}: ScanProgressBlockProps) {
  const percent = fraction === null ? null : Math.floor(fraction * 100);
  const facts = joinFacts([
    scope,
    recordsFact(progress, discovering, uiLocale, recordTotal),
    urlsFact(progress, uiLocale),
  ]);
  return (
    <section
      className={`blc-scan-progress${centered ? ' blc-scan-progress--centered' : ''}`}
      aria-label="Scan progress"
    >
      <h2 className="blc-scan-progress__title">
        {percent === null ? 'Scanning links…' : `Scanning links (${percent}%)…`}
      </h2>
      <div
        className="dl-progress"
        role="progressbar"
        aria-label="Scan progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div
          className={
            percent === null
              ? 'dl-progress__bar blc-scan-progress__sweep'
              : 'dl-progress__bar'
          }
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="blc-scan-progress__facts">{facts}</p>
    </section>
  );
}
