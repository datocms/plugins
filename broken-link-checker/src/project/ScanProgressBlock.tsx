import BlankSlate from 'datocms-react-ui/BlankSlate';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import Spinner from 'datocms-react-ui/Spinner';
import { countLabel, joinFacts } from '../report/format';
import { type ScanProgress, settledUrls } from '../report/view';
import styles from './Notices.module.css';

type ScanProgressProps = {
  /** "Article • English", when the user narrowed the scan; empty for the whole project. */
  scope: string;
  progress: ScanProgress;
  /** 0 to 1, never moving backwards; null while the record count is unknown. */
  fraction: number | null;
  discovering: boolean;
  recordTotal?: number;
  uiLocale: string;
};

function recordsFact(
  progress: ScanProgress,
  discovering: boolean,
  uiLocale: string,
  recordTotal?: number,
) {
  // "0 records read" tells nothing yet.
  if (progress.records === 0) return undefined;
  if (discovering && recordTotal !== undefined) {
    const read = progress.records.toLocaleString(uiLocale);
    // Concurrent additions can outgrow the earlier count without ending discovery.
    const total = Math.max(recordTotal, progress.records);
    return countLabel(
      total,
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
    `${done} of 1 link checked`,
    `${done} of {n} links checked`,
    uiLocale,
  );
}

/**
 * The bar shows the share, once it is known, in whole percents rounded down:
 * it stays short of the end until the scan really ends.
 */
function progressText({
  progress,
  fraction,
  discovering,
  recordTotal,
  uiLocale,
}: ScanProgressProps) {
  return {
    value: fraction === null ? undefined : Math.floor(fraction * 100) / 100,
    title: 'Scanning links…',
    facts: joinFacts([
      recordsFact(progress, discovering, uiLocale, recordTotal),
      urlsFact(progress, uiLocale),
    ]),
  };
}

/**
 * A running scan before any URL needs attention: the progress is all the
 * list area has to show. `placement` is "area" alone, "section" under a
 * notice. The bar shows only once the share is known.
 */
export function ScanProgressSlate({
  placement,
  ...props
}: ScanProgressProps & { placement: 'area' | 'section' }) {
  const { value, title, facts } = progressText(props);
  return (
    <BlankSlate
      placement={placement}
      loading
      title={title}
      description={props.scope || undefined}
      caption={facts || undefined}
    >
      {value !== undefined && (
        <ProgressBar value={value} ariaLabel="Scanning links" />
      )}
    </BlankSlate>
  );
}

/**
 * A running scan above its results: the bar, then one line with the title,
 * the scope and the facts. While the share is unknown a spinner stands in for
 * the bar.
 */
export function ScanProgressBlock(props: ScanProgressProps) {
  const { value, title, facts } = progressText(props);
  return (
    <div className={styles.progress}>
      {value !== undefined && (
        <ProgressBar value={value} ariaLabel="Scanning links" />
      )}
      <div className={styles.progressLine}>
        {value === undefined && <Spinner inline label={false} />}
        <span>{joinFacts([title, props.scope, facts])}</span>
      </div>
    </div>
  );
}
