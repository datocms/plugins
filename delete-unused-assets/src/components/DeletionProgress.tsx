import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import InfoList from 'datocms-react-ui/InfoList';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import Spinner from 'datocms-react-ui/Spinner';
import s from '../entrypoints/styles.module.css';
import { formatBytes, useFormatters } from '../utils/format';
import {
  DELETE_BATCH_SIZE,
  type DeletionProgress as Progress,
} from '../utils/unusedAssets';

type Props = {
  progress: Progress;
  stopRequested: boolean;
  /**
   * Stops after the current batch. The promise ends with the run, so the
   * button stays busy (and can't be clicked again) until then.
   */
  onStop: () => Promise<void>;
};

export default function DeletionProgress({
  progress,
  stopRequested,
  onStop,
}: Props) {
  const format = useFormatters();
  const share = progress.total > 0 ? progress.processed / progress.total : 0;
  const title = stopRequested
    ? 'Stopping after the current batch finishes…'
    : `Deleting ${format.assets(progress.total)}…`;

  return (
    <div className={s.stack}>
      <div className={s.readout}>
        <div className={s.statusLine} role="status" aria-live="polite">
          <Spinner inline label={false} />
          <span>{title}</span>
          <span className={s.percent}>{format.percent(share * 100)}</span>
        </div>
        <ProgressBar value={share} ariaLabel={title} />
        <p className={s.meta}>
          {format.count(progress.processed)} of {format.assets(progress.total)}{' '}
          processed · {formatBytes(progress.freedBytes)} freed so far
        </p>
      </div>
      <InfoList>
        <InfoList.Row title="Deleted">
          {format.count(progress.deleted)}
        </InfoList.Row>
        <InfoList.Row title="Skipped (in use or already removed)">
          {format.count(progress.skipped)}
        </InfoList.Row>
        <InfoList.Row title="Failed">
          {format.count(progress.failed)}
        </InfoList.Row>
      </InfoList>
      <Callout title="Stay on this page">
        Leaving it stops the deletion after the current batch.
      </Callout>
      {progress.total > DELETE_BATCH_SIZE && (
        <div>
          <Button label="Stop" onClick={onStop} />
        </div>
      )}
    </div>
  );
}
