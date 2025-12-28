import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import { useQuerySubscription } from 'react-datocms';
import type { Client } from '@datocms/cma-client-browser';
import { COMMENTS_MODEL_API_KEY } from '@/constants';
import { findCommentsModel } from '@utils/itemTypeUtils';
import { type CommentType, type QueryResult, parseComments } from '@ctypes/comments';
import { logError } from '@/utils/errorLogger';
import {
  type SubscriptionErrorType,
  categorizeSubscriptionError,
  normalizeError,
} from '@utils/errorCategorization';

// Re-export the type for consumers of this hook
export type { SubscriptionErrorType };

/**
 * Extended error info with categorization for UI display.
 */
export type SubscriptionErrorInfo = {
  error: Error;
  type: SubscriptionErrorType;
  /** Number of consecutive errors */
  consecutiveCount: number;
  /** User-friendly message based on error type */
  message: string;
};

type SubscriptionContext = RenderItemFormSidebarCtx | RenderPageCtx;

type UseCommentsSubscriptionParams = {
  ctx: SubscriptionContext;
  realTimeEnabled: boolean;
  cdaToken: string | undefined;
  client: Client | null;
  isSyncAllowed: boolean;
  /** The GraphQL query string */
  query: string;
  /** Variables for the GraphQL query */
  variables: Record<string, string>;
  /** Filter parameters for CMA fallback fetch */
  filterParams: { modelId: string; recordId: string };
  /** Whether the subscription should be enabled (additional condition beyond token) */
  subscriptionEnabled: boolean;
  /** Optional callback when subscription discovers the comment record ID */
  onCommentRecordIdChange?: (id: string | null) => void;
};

/**
 * Connection status constants from the GraphQL subscription.
 * These match the status values from react-datocms useQuerySubscription.
 *
 * Exported as constants to prevent magic string usage throughout the codebase.
 * If react-datocms changes these values, we only need to update them here.
 */
export const SUBSCRIPTION_STATUS = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CLOSED: 'closed',
} as const;

/**
 * Connection status type from the GraphQL subscription.
 * Derived from SUBSCRIPTION_STATUS constants for type safety.
 */
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export type UseCommentsSubscriptionReturn = {
  comments: CommentType[];
  setComments: React.Dispatch<React.SetStateAction<CommentType[]>>;
  commentsModelId: string | null;
  commentRecordId: string | null;
  setCommentRecordId: (id: string | null) => void;
  isLoading: boolean;
  /** Raw error object if any */
  error: Error | null;
  /** Categorized error info with type and user-friendly message */
  errorInfo: SubscriptionErrorInfo | null;
  status: SubscriptionStatus;
  /** Manually retry the subscription connection */
  retry: () => void;
};

/**
 * Shared hook for managing comments data loading and subscriptions.
 * Used by both record-specific comments (sidebar) and global comments (dashboard).
 *
 * Handles both real-time (GraphQL subscription) and non-real-time (CMA) modes.
 */
export function useCommentsSubscription({
  ctx,
  realTimeEnabled,
  cdaToken,
  client,
  isSyncAllowed,
  query,
  variables,
  filterParams,
  subscriptionEnabled,
  onCommentRecordIdChange,
}: UseCommentsSubscriptionParams): UseCommentsSubscriptionReturn {
  const [comments, setComments] = useState<CommentType[]>([]);
  const [commentsModelId, setCommentsModelId] = useState<string | null>(null);
  // Internal state for commentRecordId - also notifies parent via callback
  const [commentRecordId, setCommentRecordIdInternal] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Wrapper to update internal state and notify parent
  const setCommentRecordId = useCallback((id: string | null) => {
    setCommentRecordIdInternal(id);
    onCommentRecordIdChange?.(id);
  }, [onCommentRecordIdChange]);

  // Retry mechanism: toggling this key restarts the subscription
  const [subscriptionKey, setSubscriptionKey] = useState(0);

  // Track consecutive errors for progressive feedback
  const consecutiveErrorCount = useRef(0);
  // Track previous error to avoid incrementing count for the same error across re-renders
  // Using `unknown` type since useQuerySubscription returns ChannelErrorData, not Error
  const previousErrorRef = useRef<unknown>(null);

  // Real-time subscription
  const { data, status, error } = useQuerySubscription<QueryResult>({
    query,
    variables,
    token: cdaToken ?? '',
    enabled: subscriptionEnabled && !!cdaToken && realTimeEnabled,
    includeDrafts: true,
    // Use key to force reconnection when retry is called
    reconnectionPeriod: subscriptionKey > 0 ? 100 : undefined,
  });

  // Track error count and reset on successful connection
  useEffect(() => {
    if (status === 'connected') {
      consecutiveErrorCount.current = 0;
    }
  }, [status]);

  // Increment error count only when a NEW error occurs
  // Compare by message content rather than object reference, since the subscription
  // hook may return a new error object even for the same underlying error.
  // This prevents spurious count increments when the error object is recreated.
  useEffect(() => {
    if (error) {
      const currentErrorMessage = error instanceof Error ? error.message : String(error);
      const previousError = previousErrorRef.current;
      const previousErrorMessage = previousError instanceof Error ? previousError.message : String(previousError ?? '');

      // Only increment count if this is a genuinely different error
      if (!previousError || currentErrorMessage !== previousErrorMessage) {
        consecutiveErrorCount.current += 1;
        previousErrorRef.current = error;
      }
    } else {
      previousErrorRef.current = null;
    }
  }, [error]);

  /**
   * Retry function - forces reconnection with exponential backoff.
   *
   * Works for both real-time (subscription) and non-real-time (CMA) modes:
   * - Real-time: Increments subscriptionKey to force subscription reconnection
   * - CMA: Increments cmaRetryKey to trigger a fresh fetch with reset retry count
   *
   * The delay prevents rapid reconnection attempts that could overwhelm the server.
   */
  const retry = useCallback(async () => {
    if (realTimeEnabled) {
      // Real-time mode: retry subscription
      const errorCount = consecutiveErrorCount.current;
      // Exponential backoff: 1s, 2s, 4s, 8s... capped at 30s
      const delayMs = Math.min(1000 * Math.pow(2, errorCount), 30000);

      // Only add delay if there have been errors (immediate retry on first attempt)
      if (errorCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      setSubscriptionKey((prev) => prev + 1);
    } else {
      // CMA mode: trigger a fresh fetch
      // Reset retry count so it gets a fresh set of automatic retries
      cmaRetryCountRef.current = 0;
      setCmaFetchError(null);
      setCmaRetryKey((prev) => prev + 1);
    }
  }, [realTimeEnabled]);

  // Initialize model ID from ctx.itemTypes (already available, no API call needed)
  useEffect(() => {
    const commentsModel = findCommentsModel(ctx.itemTypes);
    if (commentsModel) setCommentsModelId(commentsModel.id);
  }, [ctx.itemTypes]);

  // Sync subscription data to local state (real-time mode only)
  // Only sync when allowed (no pending ops AND cooldown period has passed)
  // This prevents stale subscription data from overwriting optimistic updates
  useEffect(() => {
    if (!realTimeEnabled) return;

    const record = data?.allProjectComments[0];

    // Mark loading complete when we have subscription data (even if empty)
    if (data) {
      setIsLoading(false);
    }

    if (!record) return;

    // Don't sync while operations are pending or during cooldown period
    // The real-time API can be 5-10 seconds delayed, so we wait before syncing
    if (!isSyncAllowed) return;

    setCommentRecordId(record.id);
    setComments(parseComments(record.content));
  }, [data, isSyncAllowed, realTimeEnabled, setCommentRecordId, setComments]);

  // Track CMA fetch error for non-real-time mode
  const [cmaFetchError, setCmaFetchError] = useState<Error | null>(null);

  // Track CMA retry state for user feedback and manual retry capability
  const [cmaRetryKey, setCmaRetryKey] = useState(0);
  const cmaRetryCountRef = useRef(0);

  // Initial fetch when real-time is disabled (uses CMA client)
  // Includes automatic retry with exponential backoff for transient failures
  useEffect(() => {
    if (realTimeEnabled) {
      // Real-time mode handles loading via subscription
      return;
    }

    if (!client || !commentsModelId || !filterParams.recordId) {
      setIsLoading(false);
      return;
    }

    // Track if component is mounted to prevent state updates after unmount
    let isMounted = true;
    // Store timeout ID for cleanup
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    // Store retry timeout for cleanup
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

    /**
     * MEMORY SAFETY ANALYSIS - Why this retry pattern is safe:
     * --------------------------------------------------------
     * Concern: Could pending retry timeouts cause memory leaks?
     *
     * Answer: No, for these reasons:
     *
     * 1. SEQUENTIAL TIMEOUTS: Only ONE timeout is ever pending at a time.
     *    When a timeout fires, it may schedule another, but the previous
     *    timeout has already completed. So `retryTimeoutId` always tracks
     *    the single pending timeout.
     *
     * 2. MOUNTED CHECK: When cleanup runs, `isMounted = false` is set
     *    synchronously BEFORE any async work can continue. The check at
     *    line ~253 (`if (!isMounted) return`) prevents any further work.
     *
     * 3. CLEANUP TIMING: JavaScript is single-threaded. If a timeout fires
     *    and calls fetchComments(), cleanup cannot interrupt mid-execution.
     *    Either:
     *    - Timeout hasn't fired yet → cleanup clears it
     *    - Timeout is executing → next await yields, mounted check catches it
     *
     * 4. PROMISE COMPLETION: If a promise chain is in-flight when unmount
     *    occurs, it will run to completion but all state updates are blocked
     *    by isMounted checks. The closure memory is released when the promise
     *    settles - this is normal async behavior, not a leak.
     *
     * DO NOT refactor to track multiple timeouts in an array - it adds
     * complexity without benefit since only one timeout is pending at a time.
     */

    const CMA_FETCH_TIMEOUT_MS = 30000;
    const MAX_CMA_RETRIES = 3;

    const fetchComments = async (attempt = 0): Promise<void> => {
      if (!isMounted) return;

      setIsLoading(true);
      if (attempt === 0) {
        setCmaFetchError(null);
      }

      // Create timeout promise for CMA fetch (30 seconds)
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          // Only reject if still mounted - prevents unhandled rejection after unmount
          if (isMounted) {
            reject(new Error(`CMA fetch timed out after ${CMA_FETCH_TIMEOUT_MS / 1000} seconds`));
          }
        }, CMA_FETCH_TIMEOUT_MS);
      });

      try {
        const fetchPromise = client.items.list({
          filter: {
            type: COMMENTS_MODEL_API_KEY,
            fields: {
              model_id: { eq: filterParams.modelId },
              record_id: { eq: filterParams.recordId },
            },
          },
        });

        // Race between the fetch and the timeout
        const records = await Promise.race([fetchPromise, timeoutPromise]);

        // Clear timeout since fetch completed successfully
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        // Don't update state if component unmounted during fetch
        if (!isMounted) return;

        // Reset retry count on success
        cmaRetryCountRef.current = 0;

        if (records.length > 0) {
          const firstRecord = records[0];
          // Validate record structure before using - guards against API changes
          if (typeof firstRecord.id === 'string') {
            setCommentRecordId(firstRecord.id);
          }
          // parseComments handles null/undefined/invalid content gracefully
          setComments(parseComments(firstRecord.content));
        }
        setIsLoading(false);
      } catch (error) {
        // Clear timeout on error too (may have already fired, but clear to be safe)
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        // Don't log or update state if component unmounted
        if (!isMounted) return;

        const normalizedErr = error instanceof Error ? error : new Error(String(error));

        // Check if we should retry
        if (attempt < MAX_CMA_RETRIES) {
          cmaRetryCountRef.current = attempt + 1;
          // Exponential backoff: 1s, 2s, 4s
          const delayMs = Math.min(1000 * Math.pow(2, attempt), 8000);

          logError(`CMA fetch failed (attempt ${attempt + 1}/${MAX_CMA_RETRIES + 1}), retrying in ${delayMs}ms`, normalizedErr, {
            modelId: filterParams.modelId,
            recordId: filterParams.recordId,
          });

          retryTimeoutId = setTimeout(() => {
            if (isMounted) {
              fetchComments(attempt + 1);
            }
          }, delayMs);
          return;
        }

        // Max retries reached - show error to user
        logError('Failed to fetch comments (CMA fallback) after max retries', normalizedErr, {
          modelId: filterParams.modelId,
          recordId: filterParams.recordId,
          attempts: attempt + 1,
        });

        // Expose error to UI so users know comments failed to load
        setCmaFetchError(normalizedErr);
        setIsLoading(false);
      }
    };

    fetchComments();

    // Cleanup function to prevent state updates after unmount and clear pending timeouts
    return () => {
      isMounted = false;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (retryTimeoutId !== null) {
        clearTimeout(retryTimeoutId);
        retryTimeoutId = null;
      }
    };
  }, [realTimeEnabled, client, filterParams.modelId, filterParams.recordId, commentsModelId, cmaRetryKey, setCommentRecordId, setComments]);

  // Build categorized error info
  // Merge subscription errors and CMA fetch errors into a single error state
  // Subscription errors take precedence since they indicate ongoing connection issues
  const normalizedError = error ? normalizeError(error) : cmaFetchError;
  const errorInfo: SubscriptionErrorInfo | null = normalizedError
    ? {
        error: normalizedError,
        ...categorizeSubscriptionError(normalizedError),
        consecutiveCount: consecutiveErrorCount.current,
      }
    : null;

  return {
    comments,
    setComments,
    commentsModelId,
    commentRecordId,
    setCommentRecordId,
    isLoading,
    error: normalizedError,
    errorInfo,
    // The status from react-datocms is typed as string but actually returns these values
    status: status as SubscriptionStatus,
    retry,
  };
}
