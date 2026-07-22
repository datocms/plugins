import { Button } from 'datocms-react-ui';
import { FaClockRotateLeft } from 'react-icons/fa6';
import type { RunResumeSummary } from '../../engine/report';
import s from './ResumeBanner.module.css';

type Props = {
  /** Per-model progress rollup of the interrupted run. */
  summary: RunResumeSummary;
  /** Resolves a model's api-key/name from its item_type id (defaults to the id). */
  resolveModelName?: (itemTypeId: string) => string;
  /** Resume the unfinished units. */
  onResume: () => void;
  /** Dismiss the banner (the run stays resumable until overwritten). */
  onDismiss: () => void;
};

/**
 * Inline "you have an unfinished run" card, shown at the top of the bulk screen
 * as soon as a resumable run is detected — so the offer to resume comes BEFORE
 * the user re-picks records and fields, not after. Shows where the run left off
 * (per-model translated/remaining) and a one-click Resume.
 */
export function ResumeBanner({
  summary,
  resolveModelName = (id) => id,
  onResume,
  onDismiss,
}: Props) {
  return (
    <div className={s.banner} role="status">
      <div className={s.icon} aria-hidden>
        <FaClockRotateLeft size={20} />
      </div>
      <div className={s.body}>
        <div className={s.title}>You have an unfinished bulk translation</div>
        <div className={s.summary}>
          {summary.writtenUnits} of {summary.totalUnits} translations done —{' '}
          <strong>{summary.remainingUnits} remaining</strong>. Resume where you
          left off.
        </div>
        <ul className={s.models}>
          {summary.models.map((model) => (
            <li key={model.itemTypeId} className={s.modelRow}>
              <span className={s.modelName}>
                {resolveModelName(model.itemTypeId)}
              </span>
              <span className={s.modelStat}>
                {model.writtenUnits}/{model.totalUnits} translated ·{' '}
                {model.completedRecords}/{model.totalRecords} records
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className={s.actions}>
        <Button
          type="button"
          buttonType="primary"
          buttonSize="s"
          onClick={onResume}
        >
          Resume
        </Button>
        <Button
          type="button"
          buttonType="muted"
          buttonSize="s"
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
