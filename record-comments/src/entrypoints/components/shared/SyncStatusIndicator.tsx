import { memo } from 'react';
import type { RetryState } from '@hooks/useOperationQueue';
import { SUBSCRIPTION_STATUS, type SubscriptionStatus } from '@hooks/useCommentsSubscription';
import styles from './SyncStatusIndicator.module.css';

type SyncStatusIndicatorProps = {
  subscriptionStatus: SubscriptionStatus;
  subscriptionError: string | null;
  retryState: RetryState;
  onRetry?: () => void;
};

function SyncStatusIndicatorComponent({
  subscriptionStatus,
  subscriptionError,
  retryState,
  onRetry,
}: SyncStatusIndicatorProps) {
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

  return null;
}

const SyncStatusIndicator = memo(SyncStatusIndicatorComponent);
export default SyncStatusIndicator;
