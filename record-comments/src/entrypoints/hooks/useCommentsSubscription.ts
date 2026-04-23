import {
  type CommentType,
  isContentEmpty,
  parseComments,
  type QueryResult,
} from '@ctypes/comments';
import type { Client } from '@datocms/cma-client-browser';
import {
  categorizeSubscriptionError,
  normalizeError,
  type SubscriptionErrorType,
} from '@utils/errorCategorization';
import { findCommentsModel } from '@utils/itemTypeUtils';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuerySubscription } from 'react-datocms/use-query-subscription';
import { CMA_FETCH, COMMENTS_MODEL_API_KEY, TIMING } from '@/constants';
import { logDebug, logError } from '@/utils/errorLogger';

type Draft = {
  comment: CommentType;
  parentId?: string;
};

function extractDrafts(
  comments: CommentType[],
  currentUserId: string,
): Draft[] {
  const drafts: Draft[] = [];

  for (const comment of comments) {
    if (isContentEmpty(comment.content) && comment.authorId === currentUserId) {
      drafts.push({ comment });
    }

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

function mergeReplyDraft(
  mergedComments: CommentType[],
  draft: Draft,
  orphanedDrafts: Draft[],
): void {
  const parentIndex = mergedComments.findIndex((c) => c.id === draft.parentId);
  if (parentIndex === -1) {
    orphanedDrafts.push(draft);
    return;
  }

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

function mergeWithDrafts(
  serverComments: CommentType[],
  drafts: Draft[],
): MergeResult {
  const orphanedDrafts: Draft[] = [];
  const mergedComments = [...serverComments];

  for (const draft of drafts) {
    if (!draft.parentId) {
      const exists = mergedComments.some((c) => c.id === draft.comment.id);
      if (!exists) {
        mergedComments.push(draft.comment);
      }
    } else {
      mergeReplyDraft(mergedComments, draft, orphanedDrafts);
    }
  }

  return { comments: mergedComments, orphanedDrafts };
}

function hasStoredCommentArrayValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (!trimmed || trimmed === '[]') return false;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return trimmed.length > 0;
  }
}

function hasNonEmptyAggregateValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== 'string') return value != null;

  const trimmed = value.trim();
  if (!trimmed || trimmed === '[]') return false;

  return true;
}

function getCommentLogValue(ctx: RenderItemFormSidebarCtx): unknown {
  const formValues = (ctx as { formValues?: Record<string, unknown> })
    .formValues;
  return formValues?.comment_log;
}

function parseAggregateComments(content: unknown): {
  comments: CommentType[];
  isMalformed: boolean;
} {
  const comments = parseComments(content);
  return {
    comments,
    isMalformed: comments.length === 0 && hasNonEmptyAggregateValue(content),
  };
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
  currentUserId: string;
  onOrphanedDraft?: () => void;
  onBeforeSync?: () => void;
  onAfterSync?: () => void;
};

export const SUBSCRIPTION_STATUS = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CLOSED: 'closed',
} as const;

export type SubscriptionStatus =
  (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export type CommentsStorageProblem = {
  type: 'migration_required' | 'malformed_aggregate';
  message: string;
};

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
  storageProblem: CommentsStorageProblem | null;
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
  const [commentRecordId, setCommentRecordIdInternal] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [storageProblem, setStorageProblem] =
    useState<CommentsStorageProblem | null>(null);

  const setCommentRecordId = useCallback(
    (id: string | null) => {
      setCommentRecordIdInternal(id);
      onCommentRecordIdChange?.(id);
    },
    [onCommentRecordIdChange],
  );

  const [subscriptionKey, setSubscriptionKey] = useState(0);
  const consecutiveErrorCount = useRef(0);
  const previousErrorRef = useRef<unknown>(null);
  const [isAutoReconnecting, setIsAutoReconnecting] = useState(false);
  const autoReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const isRealtimeSubscriptionEnabled =
    subscriptionEnabled && !!cdaToken && realTimeEnabled;
  const requestContext = {
    modelId: filterParams.modelId,
    recordId: filterParams.recordId,
  };
  const commentLogValue = getCommentLogValue(ctx);
  const effectiveCommentsModelId =
    commentsModelId ?? findCommentsModel(ctx.itemTypes)?.id ?? null;

  const dataReceivedAtRef = useRef<number>(0);
  const syncBlockedAtRef = useRef<number>(0);
  const prevIsSyncAllowedRef = useRef(isSyncAllowed);

  const { data, status, error } = useQuerySubscription<QueryResult>({
    query,
    variables,
    token: cdaToken ?? '',
    environment: ctx.environment,
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

  useEffect(() => {
    if (!isRealtimeSubscriptionEnabled) {
      setIsAutoReconnecting(false);
      if (autoReconnectTimeoutRef.current) {
        clearTimeout(autoReconnectTimeoutRef.current);
        autoReconnectTimeoutRef.current = null;
      }
      return;
    }

    if (status === 'closed') {
      const errorCount = consecutiveErrorCount.current;
      const delayMs = Math.min(1000 * 2 ** errorCount, 30000);

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

  useEffect(() => {
    if (!isSyncAllowed && prevIsSyncAllowedRef.current) {
      syncBlockedAtRef.current = Date.now();
    }
    prevIsSyncAllowedRef.current = isSyncAllowed;
  }, [isSyncAllowed]);

  const prevDataRef = useRef(data);
  useEffect(() => {
    if (data && data !== prevDataRef.current) {
      dataReceivedAtRef.current = Date.now();
      prevDataRef.current = data;
    }
  }, [data]);

  useEffect(() => {
    if (error) {
      const currentErrorMessage =
        error instanceof Error ? error.message : String(error);
      const previousError = previousErrorRef.current;
      const previousErrorMessage =
        previousError instanceof Error
          ? previousError.message
          : String(previousError ?? '');

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
      const delayMs = Math.min(1000 * 2 ** errorCount, 30000);
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

  const hiddenAtRef = useRef<number>(0);
  useEffect(() => {
    if (!isRealtimeSubscriptionEnabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
      } else {
        const hiddenAt = hiddenAtRef.current;
        if (hiddenAt > 0) {
          const hiddenDuration = Date.now() - hiddenAt;
          hiddenAtRef.current = 0;

          if (hiddenDuration > TIMING.VISIBILITY_REFRESH_THRESHOLD_MS) {
            logDebug(
              'Refreshing comments subscription after tab visibility change',
              {
                hiddenDurationMs: hiddenDuration,
                modelId: requestContext.modelId,
                recordId: requestContext.recordId,
              },
            );
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

  const isSubscriptionDataStale = useCallback(
    (dataReceivedAt: number, syncBlockedAt: number): boolean => {
      return (
        syncBlockedAt > 0 &&
        dataReceivedAt > 0 &&
        dataReceivedAt < syncBlockedAt
      );
    },
    [],
  );

  const applyAggregateSync = useCallback(
    (
      recordContent: unknown,
      userId: string,
      orphanedDraftCallback: (() => void) | undefined,
    ): boolean => {
      const parsed = parseAggregateComments(recordContent);

      if (parsed.isMalformed) {
        logError('Failed to parse aggregate comments', undefined, {
          modelId: requestContext.modelId,
          recordId: requestContext.recordId,
        });
        setComments([]);
        setStorageProblem({
          type: 'malformed_aggregate',
          message: 'Comments storage could not be read.',
        });
        return false;
      }

      setStorageProblem(null);
      setComments((prevComments) => {
        const drafts = extractDrafts(prevComments, userId);
        const { comments: mergedComments, orphanedDrafts } = mergeWithDrafts(
          parsed.comments,
          drafts,
        );
        if (orphanedDrafts.length > 0 && orphanedDraftCallback) {
          orphanedDraftCallback();
        }
        return mergedComments;
      });
      return true;
    },
    [requestContext.modelId, requestContext.recordId],
  );

  const applyNoAggregateFound = useCallback(() => {
    setCommentRecordId(null);
    onBeforeSync?.();

    if (hasStoredCommentArrayValue(commentLogValue)) {
      setComments([]);
      setStorageProblem({
        type: 'migration_required',
        message: 'Comments are stored in an older format.',
      });
    } else {
      setStorageProblem(null);
      setComments((prevComments) =>
        prevComments.length === 0 ? prevComments : [],
      );
    }

    if (onAfterSync) {
      requestAnimationFrame(onAfterSync);
    }
  }, [commentLogValue, onAfterSync, onBeforeSync, setCommentRecordId]);

  useEffect(() => {
    if (!isRealtimeSubscriptionEnabled) return;

    const record = data?.allProjectComments[0];
    if (data) setIsLoading(false);
    if (!isSyncAllowed) return;

    if (!record) {
      applyNoAggregateFound();
      return;
    }

    const dataReceivedAt = dataReceivedAtRef.current;
    const syncBlockedAt = syncBlockedAtRef.current;

    if (isSubscriptionDataStale(dataReceivedAt, syncBlockedAt)) {
      logDebug('Skipped stale realtime sync update', {
        commentRecordId: record.id,
        dataReceivedAt,
        modelId: requestContext.modelId,
        recordId: requestContext.recordId,
        syncBlockedAt,
      });
      return;
    }

    syncBlockedAtRef.current = 0;

    setCommentRecordId(record.id);
    onBeforeSync?.();
    applyAggregateSync(record.content, currentUserId, onOrphanedDraft);

    if (onAfterSync) {
      requestAnimationFrame(onAfterSync);
    }
  }, [
    data,
    isSyncAllowed,
    isRealtimeSubscriptionEnabled,
    setCommentRecordId,
    currentUserId,
    onOrphanedDraft,
    onBeforeSync,
    onAfterSync,
    requestContext.modelId,
    requestContext.recordId,
    applyAggregateSync,
    applyNoAggregateFound,
    isSubscriptionDataStale,
  ]);

  const [cmaFetchError, setCmaFetchError] = useState<Error | null>(null);
  const [cmaRetryKey, setCmaRetryKey] = useState(0);
  const cmaRetryCountRef = useRef(0);

  useEffect(() => {
    if (isRealtimeSubscriptionEnabled) return;
    if (!client || !effectiveCommentsModelId || !filterParams.recordId) {
      setCommentRecordId(null);
      setComments((prevComments) =>
        prevComments.length === 0 ? prevComments : [],
      );
      setStorageProblem(null);
      setCmaFetchError(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const syncAfterFetch = () => {
      if (onAfterSync) {
        requestAnimationFrame(onAfterSync);
      }
    };

    const applyRecordFound = (
      firstRecord: Awaited<ReturnType<typeof client.items.list>>[number],
    ) => {
      if (typeof firstRecord.id === 'string') {
        setCommentRecordId(firstRecord.id);
      }
      onBeforeSync?.();
      applyAggregateSync(firstRecord.content, currentUserId, onOrphanedDraft);
      syncAfterFetch();
    };

    const applyFetchedRecords = (
      records: Awaited<ReturnType<typeof client.items.list>>,
      attempt: number,
    ) => {
      cmaRetryCountRef.current = 0;
      logDebug('Comments fetched via CMA fallback', {
        attempt: attempt + 1,
        commentRecordId: records[0]?.id ?? null,
        modelId: requestContext.modelId,
        recordId: requestContext.recordId,
        recordsFound: records.length,
      });

      if (records.length > 0) {
        applyRecordFound(records[0]);
      } else {
        applyNoAggregateFound();
      }

      setIsLoading(false);
    };

    const scheduleRetry = (
      attempt: number,
      normalizedErr: Error,
      retryFn: (next: number) => void,
    ) => {
      cmaRetryCountRef.current = attempt + 1;
      const delayMs = Math.min(1000 * 2 ** attempt, 8000);

      logError(
        `CMA fetch failed (attempt ${attempt + 1}/${CMA_FETCH.MAX_RETRIES + 1}), retrying in ${delayMs}ms`,
        normalizedErr,
        { modelId: filterParams.modelId, recordId: filterParams.recordId },
      );
      logDebug('CMA fallback retry scheduled', {
        attempt: attempt + 1,
        delayMs,
        errorMessage: normalizedErr.message,
        modelId: requestContext.modelId,
        recordId: requestContext.recordId,
      });

      retryTimeoutId = setTimeout(() => {
        if (isMounted) {
          retryFn(attempt + 1);
        }
      }, delayMs);
    };

    const handleFetchError = (
      error: unknown,
      attempt: number,
      retryFn: (next: number) => void,
    ) => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (!isMounted) return;

      const normalizedErr =
        error instanceof Error ? error : new Error(String(error));

      if (attempt < CMA_FETCH.MAX_RETRIES) {
        scheduleRetry(attempt, normalizedErr, retryFn);
        return;
      }

      logError(
        'Failed to fetch comments (CMA fallback) after max retries',
        normalizedErr,
        {
          modelId: filterParams.modelId,
          recordId: filterParams.recordId,
          attempts: attempt + 1,
        },
      );
      logDebug('CMA fallback retries exhausted', {
        attempts: attempt + 1,
        errorMessage: normalizedErr.message,
        modelId: requestContext.modelId,
        recordId: requestContext.recordId,
      });
      setCmaFetchError(normalizedErr);
      setIsLoading(false);
    };

    const fetchComments = async (attempt = 0): Promise<void> => {
      if (!isMounted) return;

      setIsLoading(true);
      if (attempt === 0) setCmaFetchError(null);
      logDebug('Fetching comments via CMA fallback', {
        attempt: attempt + 1,
        modelId: requestContext.modelId,
        recordId: requestContext.recordId,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (isMounted) {
            reject(
              new Error(
                `CMA fetch timed out after ${CMA_FETCH.TIMEOUT_MS / 1000} seconds`,
              ),
            );
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
          page: { limit: 1 },
        });

        const records = await Promise.race([fetchPromise, timeoutPromise]);

        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (!isMounted) return;

        applyFetchedRecords(records, attempt);
      } catch (error) {
        handleFetchError(error, attempt, fetchComments);
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
  }, [
    isRealtimeSubscriptionEnabled,
    client,
    filterParams.modelId,
    filterParams.recordId,
    effectiveCommentsModelId,
    setCommentRecordId,
    currentUserId,
    onOrphanedDraft,
    onBeforeSync,
    onAfterSync,
    requestContext.modelId,
    requestContext.recordId,
    applyAggregateSync,
    applyNoAggregateFound,
    cmaRetryKey,
  ]);

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
    storageProblem,
  };
}
