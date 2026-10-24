import type { SubscriptionStatus } from '@hooks/useCommentsSubscription';
import { formatNumber } from '@/utils/format';

/** What the data hooks tell about the load of the comments of the record */
export type CommentsLoadState = {
  /** Real-time updates through the CDA (else the CMA loads the comments) */
  realTimeEnabled: boolean;
  status: SubscriptionStatus;
  isLoading: boolean;
  hasError: boolean;
};

/**
 * True when a load of the comments ended with data (or with no comments).
 * Real time: the subscription is connected and its first data came. CMA:
 * the fetch ended. A load that ended with an error did not load anything.
 */
export function isLoadSettled({
  realTimeEnabled,
  status,
  isLoading,
  hasError,
}: CommentsLoadState): boolean {
  if (hasError) return false;
  if (realTimeEnabled) return status !== 'connecting' && !isLoading;
  return !isLoading;
}

export type SidebarViewInput = CommentsLoadState & {
  /** The comments of the current record loaded at least once */
  hasLoadedOnce: boolean;
  isAutoReconnecting: boolean;
  /** Changes that wait to be saved */
  pendingCount: number;
  isRetrying: boolean;
  retryCount: number;
  /** Why a save runs again (someone else saved first), while it retries */
  retryMessage?: string | null;
  locale?: string;
};

export type SidebarView = {
  /**
   * loading: nothing to show yet. failed: the first load failed. ready: the
   * comments show, and every later load keeps them on screen.
   */
  phase: 'loading' | 'failed' | 'ready';
  /**
   * The comments stopped updating: a load failed, or the real-time
   * connection closed and nothing reconnects it by itself
   */
  syncProblem: boolean;
  /** A load or a save runs in the background, after the first load */
  busy: boolean;
  /**
   * The short state of that background work, for the subtitle: the title
   * of a narrow sidebar keeps its room
   */
  activity: string | null;
  /** The same state for screen readers, with its reason when there is one */
  announcement: string | null;
};

function getRetryActivity(input: SidebarViewInput): string {
  if (input.retryCount <= 1) return 'Retrying…';
  return `Retrying, attempt ${formatNumber(input.retryCount, input.locale)}`;
}

function getAnnouncement(
  input: SidebarViewInput,
  activity: string | null,
): string | null {
  if (activity && input.isRetrying && input.retryMessage) {
    return `${input.retryMessage} ${activity}`;
  }
  return activity;
}

function getActivity(input: SidebarViewInput): string | null {
  if (input.isRetrying) return getRetryActivity(input);
  if (input.pendingCount > 0) return 'Saving…';
  if (input.isAutoReconnecting) return 'Reconnecting…';
  if (input.realTimeEnabled && input.status === 'connecting') {
    return 'Connecting…';
  }
  return null;
}

/**
 * What the sidebar shows. A spinner shows only before the first load: the
 * later loads (the refetch after a save, a reconnection) keep the comments
 * and the composer on screen, and only the header tells about them.
 */
export function getSidebarView(input: SidebarViewInput): SidebarView {
  if (!input.hasLoadedOnce) {
    return {
      phase: input.hasError ? 'failed' : 'loading',
      syncProblem: false,
      busy: false,
      activity: null,
      announcement: null,
    };
  }

  const isReloading = input.realTimeEnabled
    ? input.status === 'connecting'
    : input.isLoading;
  const activity = getActivity(input);

  return {
    phase: 'ready',
    // An error is a problem also while the connection retries by itself:
    // a token that is not valid any more never reconnects
    syncProblem:
      input.hasError ||
      (input.realTimeEnabled &&
        input.status === 'closed' &&
        !input.isAutoReconnecting),
    busy:
      input.pendingCount > 0 ||
      input.isRetrying ||
      input.isAutoReconnecting ||
      isReloading,
    activity,
    announcement: getAnnouncement(input, activity),
  };
}
