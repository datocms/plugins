import { Button } from 'datocms-react-ui';
import { useEffect, useState } from 'react';
import type { RunStatus } from './pauseController';

type PausedStatus = Extract<RunStatus, { kind: 'paused' }>;

/**
 * Cancel copy, verbatim from the spec's Global Constraints. Rendered inline
 * rather than via `ctx.openConfirm`: a nested modal opened from inside a
 * `renderModal` renders behind the host and hangs.
 */
const CANCEL_WARNING =
  'Stopping does not undo the records already translated; they will be re-translated on the next bulk run.';

type PausePanelProps = {
  /** The current paused status, carrying the reason and any auto-retry deadline. */
  status: PausedStatus;
  /** Releases the pause and continues the run. */
  onResume: () => void;
  /** Stops the run entirely. */
  onCancel: () => void;
};

/** Whole seconds remaining until `resumeAt`, clamped at zero. */
const remainingSeconds = (resumeAt: number): number =>
  Math.max(0, Math.ceil((resumeAt - Date.now()) / 1000));

/**
 * The mid-run pause screen. On a rate limit with a live `resumeAt` it shows a
 * per-second countdown and a disabled Resume (the run auto-retries); on every
 * other systemic error Resume is enabled immediately and there is no countdown.
 * Cancel is always available, with its consequence spelled out inline.
 */
export function PausePanel({ status, onResume, onCancel }: PausePanelProps) {
  const { reason, resumeAt } = status;

  const [secondsLeft, setSecondsLeft] = useState(() =>
    typeof resumeAt === 'number' ? remainingSeconds(resumeAt) : 0,
  );

  useEffect(() => {
    if (typeof resumeAt !== 'number') return;
    setSecondsLeft(remainingSeconds(resumeAt));
    const id = setInterval(() => {
      setSecondsLeft(remainingSeconds(resumeAt));
    }, 1000);
    return () => clearInterval(id);
  }, [resumeAt]);

  const isCountingDown = typeof resumeAt === 'number' && secondsLeft > 0;

  return (
    <div className="TranslationProgressModal__pause" role="alert">
      <p className="TranslationProgressModal__pause-title">
        Translation paused
      </p>
      <p className="TranslationProgressModal__pause-message">{reason.message}</p>
      {reason.hint && (
        <p className="TranslationProgressModal__pause-hint">{reason.hint}</p>
      )}
      {isCountingDown && (
        <p className="TranslationProgressModal__pause-countdown">
          Retrying automatically in {secondsLeft}s…
        </p>
      )}
      <p className="TranslationProgressModal__pause-warning">{CANCEL_WARNING}</p>
      <div className="TranslationProgressModal__pause-actions">
        <Button
          type="button"
          buttonType="primary"
          buttonSize="s"
          onClick={onResume}
          disabled={isCountingDown}
        >
          Resume
        </Button>
        <Button
          type="button"
          buttonType="negative"
          buttonSize="s"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
