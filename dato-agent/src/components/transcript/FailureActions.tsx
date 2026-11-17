import Button from 'datocms-react-ui/Button';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import SwitchList from 'datocms-react-ui/SwitchList';
import { useEffect, useRef, useState } from 'react';
import { CopyIcon, RetryIcon } from '../../icons';
import type { SecretCandidate } from '../../lib/secretCandidates';
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
 * The values of the error details that look like secrets, before the copy:
 * the user picks the ones to redact, all of them at first. Only the last 4
 * characters and the length of a value show, never the value.
 */
function SecretReview({
  candidates,
  onCancel,
  onCopy,
}: {
  candidates: readonly SecretCandidate[];
  onCancel: () => void;
  onCopy: (redact: readonly string[]) => void;
}) {
  const [redacted, setRedacted] = useState<ReadonlySet<string>>(
    () => new Set(candidates.map((candidate) => candidate.value)),
  );

  const toggle = (value: string, on: boolean | null) => {
    const next = new Set(redacted);
    if (on) next.add(value);
    else next.delete(value);
    setRedacted(next);
  };

  return (
    <div className={styles.secretReview}>
      <p className={styles.secretReviewText}>
        {candidates.length === 1
          ? 'This value in the error details looks like a secret.'
          : `${candidates.length} values in the error details look like secrets.`}{' '}
        The values you redact are replaced with [redacted] in the copy.
      </p>
      <SwitchList>
        {candidates.map((candidate) => (
          <FieldWrapper
            hint={`In ${candidate.path || 'the error details'}${
              candidate.occurrences > 1 ? ` (${candidate.occurrences}×)` : ''
            }`}
            key={candidate.value}
          >
            <SwitchInput
              label={`Redact ${candidate.preview}`}
              onChange={(on) => toggle(candidate.value, on)}
              value={redacted.has(candidate.value)}
            />
          </FieldWrapper>
        ))}
      </SwitchList>
      <div className={styles.actionRow}>
        <Button
          icon={CopyIcon}
          label={
            redacted.size > 0
              ? `Copy with ${redacted.size} redacted`
              : 'Copy without redacting'
          }
          onClick={() => onCopy([...redacted])}
          tone="soft"
        />
        <Button label="Cancel" onClick={onCancel} tone="ghost" />
      </div>
    </div>
  );
}

/**
 * The actions under a failed response: try the turn again (only when the
 * failure allows it) and copy the error details. Both buttons are busy while
 * their promise runs, and nothing else starts while a retry starts. The copy
 * feedback stays in the button: "Copied" for a moment (announced), and a
 * failure until the next attempt (announced as an alert). When the details
 * hold values that look like secrets, the user first picks the ones to
 * redact.
 */
export function FailureActions({ failure, onRetry, onCopyDiagnostics }: Props) {
  const [retryPending, setRetryPending] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [review, setReview] = useState<readonly SecretCandidate[]>();
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

  const copyDiagnostics = async (redact?: readonly string[]) => {
    if (retryPending || !onCopyDiagnostics) {
      return;
    }

    clearFeedbackTimer();
    setCopyState('idle');

    try {
      const result = await onCopyDiagnostics(failure.id, redact);
      if (result?.status === 'review') {
        setReview(result.candidates);
        return;
      }
      setReview(undefined);
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
            onClick={() => copyDiagnostics()}
            tone="ghost"
          />
        )}
      </div>
      {review && (
        <SecretReview
          candidates={review}
          onCancel={() => setReview(undefined)}
          onCopy={(redact) => void copyDiagnostics(redact)}
        />
      )}
      <span aria-live="polite" className="visually-hidden" role="status">
        {copyState === 'copied' ? 'Error details copied' : ''}
      </span>
      <span className="visually-hidden" role="alert">
        {copyState === 'error' ? COPY_LABELS.error : ''}
      </span>
    </div>
  );
}
