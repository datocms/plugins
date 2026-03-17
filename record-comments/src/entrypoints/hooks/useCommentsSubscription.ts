import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useQuerySubscription } from 'react-datocms/use-query-subscription';
import type { Client } from '@datocms/cma-client-browser';
import { COMMENTS_MODEL_API_KEY, CMA_FETCH, TIMING } from '@/constants';
import { findCommentsModel } from '@utils/itemTypeUtils';
import { type CommentType, type QueryResult, parseComments, isContentEmpty } from '@ctypes/comments';
import { logDebug, logError } from '@/utils/errorLogger';
import {
  type SubscriptionErrorType,
  categorizeSubscriptionError,
  normalizeError,
} from '@utils/errorCategorization';

type Draft = {
  comment: CommentType;
  parentId?: string; // undefined for top-level drafts
};

/**
 * Extracts draft comments (empty content by current user) from comments list.
 * Returns both top-level drafts and reply drafts with their parent IDs.
 */
function extractDrafts(comments: CommentType[], currentUserId: string): Draft[] {
  const drafts: Draft[] = [];

  for (const comment of comments) {
    // Check if this is a top-level draft
    if (isContentEmpty(comment.content) && comment.authorId === currentUserId) {
      drafts.push({ comment });
    }

    // Check replies for drafts
    if (comment.replies) {
      for (const reply of comment.replies) {
        if (isContentEmpty(reply.content) && reply.authorId === currentUserId) {
          drafts.push({ comment: reply, parentId: comment.id });
        }
      }
    }
  }

  return drafts;
}

type MergeResult = {
  comments: CommentType[];
  orphanedDrafts: Draft[];
};

/**
 * Merges server comments with preserved drafts.
 * Returns the merged comments and any orphaned drafts (replies whose parent was deleted).
 */
function mergeWithDrafts(serverComments: CommentType[], drafts: Draft[]): MergeResult {
  const orphanedDrafts: Draft[] = [];
  const mergedComments = [...serverComments];

  for (const draft of drafts) {
    if (!draft.parentId) {
      // Top-level draft - add to end if not already present
      const exists = mergedComments.some((c) => c.id === draft.comment.id);
      if (!exists) {
        mergedComments.push(draft.comment);
      }
    } else {
      // Reply draft - find parent and add reply
      const parentIndex = mergedComments.findIndex((c) => c.id === draft.parentId);
      if (parentIndex === -1) {
        // Parent was deleted - this is an orphaned draft
        orphanedDrafts.push(draft);
      } else {
        // Add reply to parent if not already present
        const parent = mergedComments[parentIndex];
        const replies = parent.replies ?? [];
        const replyExists = replies.some((r) => r.id === draft.comment.id);
        if (!replyExists) {
          mergedComments[parentIndex] = {
            ...parent,
            replies: [...replies, draft.comment],
          };
        }
      }
    }
  }

  return { comments: mergedComments, orphanedDrafts };
}

export type SubscriptionErrorInfo = {
  error: Error;
  type: SubscriptionErrorType;
  consecutiveCount: number;
  message: string;
};

type UseCommentsSubscriptionParams = {
  ctx: RenderItemFormSidebarCtx;
  realTimeEnabled: boolean;
  cdaToken: string | undefined;
  client: Client | null;
  commentsModelId: string | null;
  isSyncAllowed: boolean;
  query: string;
  variables: Record<string, string>;
  filterParams: { modelId: string; recordId: string };
  subscriptionEnabled: boolean;
  onCommentRecordIdChange?: (id: string | null) => void;
  /** Current user's ID for identifying their drafts */
  currentUserId: string;
  /** Callback when a draft reply's parent comment was deleted */
  onOrphanedDraft?: () => void;
  /** Called before sync updates are applied - use to save scroll position */
  onBeforeSync?: () => void;
  /** Called after sync updates are applied - use to restore scroll position */
  onAfterSync?: () => void;
};

export const SUBSCRIPTION_STATUS = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CLOSED: 'closed',
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export type UseCommentsSubscriptionReturn = {
  comments: CommentType[];
  setComments: React.Dispatch<React.SetStateAction<CommentType[]>>;
  commentsModelId: string | null;
  commentRecordId: string | null;
  setCommentRecordId: (id: string | null) => void;
  isLoading: boolean;
  error: Error | null;
  errorInfo: SubscriptionErrorInfo | null;
  status: SubscriptionStatus;
  retry: () => void;
  isAutoReconnecting: boolean;
};

export function useCommentsSubscription({
  ctx,
  realTimeEnabled,
  cdaToken,
  client,
  commentsModelId,
  isSyncAllowed,
  query,
  variables,
  filterParams,
  subscriptionEnabled,
  onCommentRecordIdChange,
  currentUserId,
  onOrphanedDraft,
  onBeforeSync,
  onAfterSync,
}: UseCommentsSubscriptionParams): UseCommentsSubscriptionReturn {
  const [comments, setComments] = useState<CommentType[]>([]);
  const [commentRecordId, setCommentRecordIdInternal] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const setCommentRecordId = useCallback((id: string | null) => {
    setCommentRecordIdInternal(id);
    onCommentRecordIdChange?.(id);
  }, [onCommentRecordIdChange]);

  const [subscriptionKey, setSubscriptionKey] = useState(0);
  const consecutiveErrorCount = useRef(0);
  const previousErrorRef = useRef<unknown>(null);
  const [isAutoReconnecting, setIsAutoReconnecting] = useState(false);
  const autoReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRealtimeSubscriptionEnabled = subscriptionEnabled && !!cdaToken && realTimeEnabled;
  const requestContext = {
    modelId: filterParams.modelId,
    recordId: filterParams.recordId,
  };
  const effectiveCommentsModelId =
    commentsModelId ?? findCommentsModel(ctx.itemTypes)?.id ?? null;

  // Track when subscription data was received to detect stale data
  const dataReceivedAtRef = useRef<number>(0);
  // Track when isSyncAllowed last became false (operation started)
  const syncBlockedAtRef = useRef<number>(0);
  // Track previous isSyncAllowed value to detect transitions
  const prevIsSyncAllowedRef = useRef(isSyncAllowed);

  const { data, status, error } = useQuerySubscription<QueryResult>({
    query,
    variables,
    token: cdaToken ?? '',
    enabled: isRealtimeSubscriptionEnabled,
    includeDrafts: true,
    reconnectionPeriod: subscriptionKey > 0 ? 100 : undefined,
  });

  useEffect(() => {
    if (!isRealtimeSubscriptionEnabled) return;

    logDebug('Comments subscription status changed', {
      modelId: requestContext.modelId,
      recordId: requestContext.recordId,
      status,
      subscriptionKey,
    });
  }, [
    isRealtimeSubscriptionEnabled,
    requestContext.modelId,
    requestContext.recordId,
    status,
    subscriptionKey,
  ]);

  useEffect(() => {
    if (!isRealtimeSubscriptionEnabled) return;
    if (status === 'connected') {
      consecutiveErrorCount.current = 0;
      setIsAutoReconnecting(false);
      logDebug('Comments subscription connected', {
        modelId: requestContext.modelId,
        recordId: requestContext.recordId,
        subscriptionKey,
      });
      // Clear any pending auto-reconnect timeout
      if (autoReconnectTimeoutRef.current) {
        clearTimeout(autoReconnectTimeoutRef.current);
        autoReconnectTimeoutRef.current = null;
      }
    }
  }, [
    isRealtimeSubscriptionEnabled,
    requestContext.modelId,
    requestContext.recordId,
    status,
    subscriptionKey,
  ]);

  // Auto-reconnect when connection is closed
  useEffect(() => {
    if (!isRealtimeSubscriptionEnabled) {
      setIsAutoReconnecting(false);
      if (autoReconnectTimeoutRef.current) {
        clearTimeout(autoReconnectTimeoutRef.current);
        autoReconnectTimeoutRef.current = null;
      }
      return;
    }

    // Only auto-reconnect when status is 'closed' (connection lost)
    if (status === 'closed') {
      const errorCount = consecutiveErrorCount.current;
      // Exponential backoff: 1s, 2s, 4s, 8s... max 30s
      const delayMs = Math.min(1000 * Math.pow(2, errorCount), 30000);

      setIsAutoReconnecting(true);
      logDebug('Comments subscription auto-reconnect scheduled', {
        consecutiveErrorCount: errorCount,
        delayMs,
        modelId: requestContext.modelId,
        recordId: requestContext.recordId,
      });

      autoReconnectTimeoutRef.current = setTimeout(() => {
        autoReconnectTimeoutRef.current = null;
        logDebug('Comments subscription auto-reconnect triggered', {
          modelId: requestContext.modelId,
          recordId: requestContext.recordId,
        });
        setSubscriptionKey((prev) => prev + 1);
      }, delayMs);
    }

    return () => {
      if (autoReconnectTimeoutRef.current) {
        clearTimeout(autoReconnectTimeoutRef.current);
        autoReconnectTimeoutRef.current = null;
      }
    };
  }, [
    isRealtimeSubscriptionEnabled,
    requestContext.modelId,
    requestContext.recordId,
    status,
  ]);

  // Track when isSyncAllowed transitions to false (operation started)
  useEffect(() => {
    if (!isSyncAllowed && prevIsSyncAllowedRef.current) {
      // Sync just became blocked - record when this happened
      syncBlockedAtRef.current = Date.now();
    }
    prevIsSyncAllowedRef.current = isSyncAllowed;
  }, [isSyncAllowed]);

  // Track when new subscription data arrives
  const prevDataRef = useRef(data);
  useEffect(() => {
    if (data && data !== prevDataRef.current) {
      dataReceivedAtRef.current = Date.now();
      prevDataRef.current = data;
    }
  }, [data]);

  useEffect(() => {
    if (error) {
      const currentErrorMessage = error instanceof Error ? error.message : String(error);
      const previousError = previousErrorRef.current;
      const previousErrorMessage = previousError instanceof Error ? previousError.message : String(previousError ?? '');

      if (!previousError || currentErrorMessage !== previousErrorMessage) {
        consecutiveErrorCount.current += 1;
        previousErrorRef.current = error;
      }
    } else {
      previousErrorRef.current = null;
    }
  }, [error]);

  const retry = useCallback(async () => {
    if (isRealtimeSubscriptionEnabled) {
      if (autoReconnectTimeoutRef.current) {
        clearTimeout(autoReconnectTimeoutRef.current);
        autoReconnectTimeoutRef.current = null;
      }
      setIsAutoReconnecting(false);

      const errorCount = consecutiveErrorCount.current;
      const delayMs = Math.min(1000 * Math.pow(2, errorCount), 30000); // 1s, 2s, 4s... max 30s
      logDebug('Manual comments retry requested', {
        delayMs,
        errorCount,
        mode: 'realtime',
        modelId: requestContext.modelId,
        recordId: requestContext.recordId,
      });

      if (errorCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      setSubscriptionKey((prev) => prev + 1);
    } else {
      logDebug('Manual comments retry requested', {
        mode: 'cma-fallback',
        modelId: requestContext.modelId,
        recordId: requestContext.recordId,
      });
      cmaRetryCountRef.current = 0;
      setCmaFetchError(null);
      setCmaRetryKey((prev) => prev + 1);
    }
  }, [
    isRealtimeSubscriptionEnabled,
    requestContext.modelId,
    requestContext.recordId,
  ]);

  // Track when tab was hidden and refresh subscription when tab becomes visible after long inactivity
  // This handles stale WebSocket connections in long-running tabs
  const hiddenAtRef = useRef<number>(0);
  useEffect(() => {
    if (!isRealtimeSubscriptionEnabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is being hidden - record the time
        hiddenAtRef.current = Date.now();
      } else {
        // Tab is becoming visible
        const hiddenAt = hiddenAtRef.current;
        if (hiddenAt > 0) {
          const hiddenDuration = Date.now() - hiddenAt;
          hiddenAtRef.current = 0;

          // If tab was hidden for longer than threshold, force subscription refresh
          // This ensures we get fresh data after long periods of inactivity
          if (hiddenDuration > TIMING.VISIBILITY_REFRESH_THRESHOLD_MS) {
            logDebug('Refreshing comments subscription after tab visibility change', {
              hiddenDurationMs: hiddenDuration,
              modelId: requestContext.modelId,
              recordId: requestContext.recordId,
            });
            setSubscriptionKey((prev) => prev + 1);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    isRealtimeSubscriptionEnabled,
    requestContext.modelId,
    requestContext.recordId,
  ]);

  // WARNING: Real-time API can be 5-10s delayed - don't overwrite optimistic updates
  // Critical: We must check if subscription data was received AFTER our last operation started
  // to prevent stale data from overwriting fresh local state (the "disappearing comment" bug)
  useEffect(() => {
    if (!isRealtimeSubscriptionEnabled) return;

    const record = data?.allProjectComments[0];
    if (data) setIsLoading(false);
    if (!isSyncAllowed) return;

    if (!record) {
      setCommentRecordId(null);
      onBeforeSync?.();
      setComments((prevComments) => (prevComments.length === 0 ? prevComments : []));
      if (onAfterSync) {
        requestAnimationFrame(onAfterSync);
      }
      return;
    }

    // CRITICAL FIX: Check if subscription data is fresh enough
    // If we had an operation (syncBlockedAtRef > 0) and the data was received BEFORE
    // that operation started, the data is stale and could overwrite our local changes.
    // This prevents the "disappearing comment" bug where stale subscription data
    // overwrites optimistic updates after cooldown expires.
    const dataReceivedAt = dataReceivedAtRef.current;
    const syncBlockedAt = syncBlockedAtRef.current;

    if (syncBlockedAt > 0 && dataReceivedAt > 0 && dataReceivedAt < syncBlockedAt) {
      // Data is stale - it was received before our operation started.
      // Skip this sync and wait for fresh subscription data.
      // The subscription should eventually deliver updated data.
      logDebug('Skipped stale realtime sync update', {
        commentRecordId: record.id,
        dataReceivedAt,
        modelId: requestContext.modelId,
        recordId: requestContext.recordId,
        syncBlockedAt,
      });
      return;
    }

    // Reset the sync blocked timestamp now that we're applying fresh data
    syncBlockedAtRef.current = 0;

    setCommentRecordId(record.id);

    // Notify before sync so component can save scroll position
    onBeforeSync?.();

    // Preserve drafts during sync
    setComments((prevComments) => {
      const drafts = extractDrafts(prevComments, currentUserId);
      const serverComments = parseComments(record.content);
      const { comments: mergedComments, orphanedDrafts } = mergeWithDrafts(serverComments, drafts);

      // Notify about orphaned drafts (parent comment was deleted)
      if (orphanedDrafts.length > 0 && onOrphanedDraft) {
        onOrphanedDraft();
      }

      return mergedComments;
    });

    // Schedule after-sync callback for next frame (after React re-render)
    if (onAfterSync) {
      requestAnimationFrame(onAfterSync);
    }
  }, [data, isSyncAllowed, isRealtimeSubscriptionEnabled, setCommentRecordId, currentUserId, onOrphanedDraft, onBeforeSync, onAfterSync]);

  const [cmaFetchError, setCmaFetchError] = useState<Error | null>(null);
  const [cmaRetryKey, setCmaRetryKey] = useState(0);
  const cmaRetryCountRef = useRef(0);

  useEffect(() => {
    if (isRealtimeSubscriptionEnabled) return;
    if (!client || !effectiveCommentsModelId || !filterParams.recordId) {
      setCommentRecordId(null);
      setComments((prevComments) => (prevComments.length === 0 ? prevComments : []));
      setCmaFetchError(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const fetchComments = async (attempt = 0): Promise<void> => {
      if (!isMounted) return;

      setIsLoading(true);
      if (attempt === 0) setCmaFetchError(null);
      logDebug('Fetching comments via CMA fallback', {
        attempt: attempt + 1,
        modelId: requestContext.modelId,
        recordId: requestContext.recordId,
      });

      // Note: DatoCMS client doesn't support AbortController, so we rely on
      // isMounted checks to discard stale responses after timeout/unmount
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (isMounted) {
            reject(new Error(`CMA fetch timed out after ${CMA_FETCH.TIMEOUT_MS / 1000} seconds`));
          }
        }, CMA_FETCH.TIMEOUT_MS);
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

        const records = await Promise.race([fetchPromise, timeoutPromise]);

        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (!isMounted) return;

        cmaRetryCountRef.current = 0;
        logDebug('Comments fetched via CMA fallback', {
          attempt: attempt + 1,
          commentRecordId: records[0]?.id ?? null,
          modelId: requestContext.modelId,
          recordId: requestContext.recordId,
          recordsFound: records.length,
        });
        if (records.length > 0) {
          const firstRecord = records[0];
          if (typeof firstRecord.id === 'string') {
            setCommentRecordId(firstRecord.id);
          }

          // Notify before sync so component can save scroll position
          onBeforeSync?.();

          // Preserve drafts during sync
          setComments((prevComments) => {
            const drafts = extractDrafts(prevComments, currentUserId);
            const serverComments = parseComments(firstRecord.content);
            const { comments: mergedComments, orphanedDrafts } = mergeWithDrafts(serverComments, drafts);

            // Notify about orphaned drafts (parent comment was deleted)
            if (orphanedDrafts.length > 0 && onOrphanedDraft) {
              onOrphanedDraft();
            }

            return mergedComments;
          });

          // Schedule after-sync callback for next frame (after React re-render)
          if (onAfterSync) {
            requestAnimationFrame(onAfterSync);
          }
        } else {
          setCommentRecordId(null);
          onBeforeSync?.();
          setComments((prevComments) => (prevComments.length === 0 ? prevComments : []));
          if (onAfterSync) {
            requestAnimationFrame(onAfterSync);
          }
        }
        setIsLoading(false);
      } catch (error) {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (!isMounted) return;

        const normalizedErr = error instanceof Error ? error : new Error(String(error));

        if (attempt < CMA_FETCH.MAX_RETRIES) {
          cmaRetryCountRef.current = attempt + 1;
          const delayMs = Math.min(1000 * Math.pow(2, attempt), 8000);

          logError(`CMA fetch failed (attempt ${attempt + 1}/${CMA_FETCH.MAX_RETRIES + 1}), retrying in ${delayMs}ms`, normalizedErr, {
            modelId: filterParams.modelId,
            recordId: filterParams.recordId,
          });
          logDebug('CMA fallback retry scheduled', {
            attempt: attempt + 1,
            delayMs,
            errorMessage: normalizedErr.message,
            modelId: requestContext.modelId,
            recordId: requestContext.recordId,
          });

          retryTimeoutId = setTimeout(() => {
            if (isMounted) {
              fetchComments(attempt + 1);
            }
          }, delayMs);
          return;
        }

        logError('Failed to fetch comments (CMA fallback) after max retries', normalizedErr, {
          modelId: filterParams.modelId,
          recordId: filterParams.recordId,
          attempts: attempt + 1,
        });
        logDebug('CMA fallback retries exhausted', {
          attempts: attempt + 1,
          errorMessage: normalizedErr.message,
          modelId: requestContext.modelId,
          recordId: requestContext.recordId,
        });
        setCmaFetchError(normalizedErr);
        setIsLoading(false);
      }
    };

    fetchComments();

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
  }, [isRealtimeSubscriptionEnabled, client, filterParams.modelId, filterParams.recordId, effectiveCommentsModelId, cmaRetryKey, setCommentRecordId, setComments, currentUserId, onOrphanedDraft, onBeforeSync, onAfterSync]);

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
    commentsModelId: effectiveCommentsModelId,
    commentRecordId,
    setCommentRecordId,
    isLoading,
    error: normalizedError,
    errorInfo,
    status: status as SubscriptionStatus,
    retry,
    isAutoReconnecting,
  };
}
