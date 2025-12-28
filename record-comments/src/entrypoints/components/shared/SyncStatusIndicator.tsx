import { memo } from 'react';
import type { RetryState } from '@hooks/useOperationQueue';
import { SUBSCRIPTION_STATUS, type SubscriptionStatus } from '@hooks/useCommentsSubscription';
import styles from './SyncStatusIndicator.module.css';

type SyncStatusIndicatorProps = {
  /** Connection status from the subscription */
  subscriptionStatus: SubscriptionStatus;
  /** Error message from subscription, if any */
  subscriptionError: string | null;
  /** Number of pending operations in the queue */
  pendingCount: number;
  /** Retry state from the operation queue */
  retryState: RetryState;
  /** Optional callback to retry subscription */
  onRetry?: () => void;
};

/**
 * Displays sync status indicators for comments.
 * Shows connection state, pending operations, and retry status.
 */
function SyncStatusIndicatorComponent({
  subscriptionStatus,
  subscriptionError,
  pendingCount,
  retryState,
  onRetry,
}: SyncStatusIndicatorProps) {
  // Priority 1: Show retry state (active retrying)
  if (retryState.isRetrying) {
    return (
      <div
        className={styles.indicator}
        data-status="retrying"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className={styles.spinner} aria-hidden="true" />
        <span className={styles.text}>
          {retryState.message}
          {retryState.retryCount > 1 && (
            <span className={styles.count}> (attempt {retryState.retryCount})</span>
          )}
        </span>
      </div>
    );
  }

  // Priority 2: Show pending operations
  if (pendingCount > 0) {
    return (
      <div
        className={styles.indicator}
        data-status="saving"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className={styles.spinner} aria-hidden="true" />
        <span className={styles.text}>
          Saving{pendingCount > 1 ? ` (${pendingCount})` : '...'}
        </span>
      </div>
    );
  }

  // Priority 3: Show subscription error
  if (subscriptionError) {
    return (
      <div
        className={styles.indicator}
        data-status="error"
        role="alert"
        aria-live="assertive"
      >
        <span className={styles.icon} aria-hidden="true">!</span>
        <span className={styles.text}>Sync error</span>
        {onRetry && (
          <button type="button" className={styles.retryButton} onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  // Priority 4: Show connecting state
  if (subscriptionStatus === SUBSCRIPTION_STATUS.CONNECTING) {
    return (
      <div
        className={styles.indicator}
        data-status="connecting"
        role="status"
        aria-live="polite"
      >
        <span className={styles.spinner} aria-hidden="true" />
        <span className={styles.text}>Connecting...</span>
      </div>
    );
  }

  // Priority 5: Show disconnected state (closed)
  if (subscriptionStatus === SUBSCRIPTION_STATUS.CLOSED) {
    return (
      <div
        className={styles.indicator}
        data-status="disconnected"
        role="status"
        aria-live="polite"
      >
        <span className={styles.icon} aria-hidden="true">&#x25CF;</span>
        <span className={styles.text}>Offline</span>
      </div>
    );
  }

  // Connected and no pending - don't show anything
  // The aria-live regions on the indicator divs above will announce when status changes,
  // so screen readers will be notified when transitioning from "Saving..." to silence
  return null;
}

const SyncStatusIndicator = memo(SyncStatusIndicatorComponent);
export default SyncStatusIndicator;
