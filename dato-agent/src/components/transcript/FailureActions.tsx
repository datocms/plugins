import Button from 'datocms-react-ui/Button';
import { useEffect, useRef, useState } from 'react';
import { CopyIcon, RetryIcon } from '../../icons';
import type { AgentMessageEntry, AgentSurfaceProps } from '../AgentSurface';
import styles from './Transcript.module.css';

/** How long "Copied" stays in the button */
const COPY_FEEDBACK_MS = 2_000;

const COPY_LABELS = {
  idle: 'Copy error details',
  copied: 'Copied',
  error: 'Couldn’t copy error details',
} as const;

type CopyState = 'idle' | 'copied' | 'error';

type Props = {
  failure: NonNullable<AgentMessageEntry['failure']>;
  onRetry?: AgentSurfaceProps['onRetryFailedTurn'];
  onCopyDiagnostics?: AgentSurfaceProps['onCopyFailureDiagnostics'];
};

/**
 * The actions under a failed response: try the turn again (only when the
 * failure allows it) and copy the error details. Both buttons are busy while
 * their promise runs, and nothing else starts while a retry starts. The copy
 * feedback stays in the button: "Copied" for a moment (announced), and a
 * failure until the next attempt (announced as an alert).
 */
export function FailureActions({ failure, onRetry, onCopyDiagnostics }: Props) {
  const [retryPending, setRetryPending] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const clearFeedbackTimer = () => {
    if (feedbackTimerRef.current !== undefined) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = undefined;
    }
  };

  useEffect(
    () => () => {
      if (feedbackTimerRef.current !== undefined) {
        clearTimeout(feedbackTimerRef.current);
      }
    },
    [],
  );

  // "Copied" is the label of the button for a moment; a failure stays
  const showCopyResult = (result: 'copied' | 'error') => {
    setCopyState(result);
    if (result === 'error') return;
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = undefined;
      setCopyState('idle');
    }, COPY_FEEDBACK_MS);
  };

  const retry = async () => {
    if (retryPending || !onRetry) {
      return;
    }

    setRetryPending(true);

    try {
      await onRetry(failure.id);
    } catch {
      // The new attempt reports its own failure in the transcript
    } finally {
      setRetryPending(false);
    }
  };

  const copyDiagnostics = async () => {
    if (retryPending || !onCopyDiagnostics) {
      return;
    }

    clearFeedbackTimer();
    setCopyState('idle');

    try {
      await onCopyDiagnostics(failure.id);
      showCopyResult('copied');
    } catch {
      showCopyResult('error');
    }
  };

  return (
    <div className={styles.failureActions}>
      <div className={styles.actionRow}>
        {failure.retryable && onRetry && (
          <Button
            icon={RetryIcon}
            label="Try again"
            onClick={retry}
            tone="soft"
          />
        )}
        {onCopyDiagnostics && (
          <Button
            disabled={
              retryPending
                ? { reason: 'Wait for the new attempt to start.' }
                : undefined
            }
            icon={CopyIcon}
            label={COPY_LABELS[copyState]}
            onClick={copyDiagnostics}
            tone="ghost"
          />
        )}
      </div>
      <span aria-live="polite" className="visually-hidden" role="status">
        {copyState === 'copied' ? 'Error details copied' : ''}
      </span>
      <span className="visually-hidden" role="alert">
        {copyState === 'error' ? COPY_LABELS.error : ''}
      </span>
    </div>
  );
}
