import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import { useQuerySubscription } from 'react-datocms';
import type { Client } from '@datocms/cma-client-browser';
import { COMMENTS_MODEL_API_KEY } from '@/constants';
import { findCommentsModel } from '@utils/itemTypeUtils';
import { type CommentType, type QueryResult, parseComments, isContentEmpty } from '@ctypes/comments';
import { logError } from '@/utils/errorLogger';
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
function extractDrafts(comments: CommentType[], currentUserEmail: string): Draft[] {
  const drafts: Draft[] = [];

  for (const comment of comments) {
    // Check if this is a top-level draft
    if (isContentEmpty(comment.content) && comment.author.email === currentUserEmail) {
      drafts.push({ comment });
    }

    // Check replies for drafts
    if (comment.replies) {
      for (const reply of comment.replies) {
        if (isContentEmpty(reply.content) && reply.author.email === currentUserEmail) {
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

export type { SubscriptionErrorType };

export type SubscriptionErrorInfo = {
  error: Error;
  type: SubscriptionErrorType;
  consecutiveCount: number;
  message: string;
};

type SubscriptionContext = RenderItemFormSidebarCtx | RenderPageCtx;

type UseCommentsSubscriptionParams = {
  ctx: SubscriptionContext;
  realTimeEnabled: boolean;
  cdaToken: string | undefined;
  client: Client | null;
  isSyncAllowed: boolean;
  query: string;
  variables: Record<string, string>;
  filterParams: { modelId: string; recordId: string };
  subscriptionEnabled: boolean;
  onCommentRecordIdChange?: (id: string | null) => void;
  /** Current user's email for identifying their drafts */
  currentUserEmail: string;
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
};

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
  currentUserEmail,
  onOrphanedDraft,
  onBeforeSync,
  onAfterSync,
}: UseCommentsSubscriptionParams): UseCommentsSubscriptionReturn {
  const [comments, setComments] = useState<CommentType[]>([]);
  const [commentsModelId, setCommentsModelId] = useState<string | null>(null);
  const [commentRecordId, setCommentRecordIdInternal] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const setCommentRecordId = useCallback((id: string | null) => {
    setCommentRecordIdInternal(id);
    onCommentRecordIdChange?.(id);
  }, [onCommentRecordIdChange]);

  const [subscriptionKey, setSubscriptionKey] = useState(0);
  const consecutiveErrorCount = useRef(0);
  const previousErrorRef = useRef<unknown>(null);

  const { data, status, error } = useQuerySubscription<QueryResult>({
    query,
    variables,
    token: cdaToken ?? '',
    enabled: subscriptionEnabled && !!cdaToken && realTimeEnabled,
    includeDrafts: true,
    reconnectionPeriod: subscriptionKey > 0 ? 100 : undefined,
  });

  useEffect(() => {
    if (status === 'connected') {
      consecutiveErrorCount.current = 0;
    }
  }, [status]);

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
    if (realTimeEnabled) {
      const errorCount = consecutiveErrorCount.current;
      const delayMs = Math.min(1000 * Math.pow(2, errorCount), 30000); // 1s, 2s, 4s... max 30s

      if (errorCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      setSubscriptionKey((prev) => prev + 1);
    } else {
      cmaRetryCountRef.current = 0;
      setCmaFetchError(null);
      setCmaRetryKey((prev) => prev + 1);
    }
  }, [realTimeEnabled]);

  useEffect(() => {
    const commentsModel = findCommentsModel(ctx.itemTypes);
    if (commentsModel) setCommentsModelId(commentsModel.id);
  }, [ctx.itemTypes]);

  // WARNING: Real-time API can be 5-10s delayed - don't overwrite optimistic updates
  useEffect(() => {
    if (!realTimeEnabled) return;

    const record = data?.allProjectComments[0];
    if (data) setIsLoading(false);
    if (!record || !isSyncAllowed) return;

    setCommentRecordId(record.id);

    // Notify before sync so component can save scroll position
    onBeforeSync?.();

    // Preserve drafts during sync
    setComments((prevComments) => {
      const drafts = extractDrafts(prevComments, currentUserEmail);
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
  }, [data, isSyncAllowed, realTimeEnabled, setCommentRecordId, currentUserEmail, onOrphanedDraft, onBeforeSync, onAfterSync]);

  const [cmaFetchError, setCmaFetchError] = useState<Error | null>(null);
  const [cmaRetryKey, setCmaRetryKey] = useState(0);
  const cmaRetryCountRef = useRef(0);

  useEffect(() => {
    if (realTimeEnabled) return;
    if (!client || !commentsModelId || !filterParams.recordId) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const CMA_FETCH_TIMEOUT_MS = 30000;
    const MAX_CMA_RETRIES = 3;

    const fetchComments = async (attempt = 0): Promise<void> => {
      if (!isMounted) return;

      setIsLoading(true);
      if (attempt === 0) setCmaFetchError(null);

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
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

        const records = await Promise.race([fetchPromise, timeoutPromise]);

        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (!isMounted) return;

        cmaRetryCountRef.current = 0;
        if (records.length > 0) {
          const firstRecord = records[0];
          if (typeof firstRecord.id === 'string') {
            setCommentRecordId(firstRecord.id);
          }

          // Notify before sync so component can save scroll position
          onBeforeSync?.();

          // Preserve drafts during sync
          setComments((prevComments) => {
            const drafts = extractDrafts(prevComments, currentUserEmail);
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
        }
        setIsLoading(false);
      } catch (error) {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (!isMounted) return;

        const normalizedErr = error instanceof Error ? error : new Error(String(error));

        if (attempt < MAX_CMA_RETRIES) {
          cmaRetryCountRef.current = attempt + 1;
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

        logError('Failed to fetch comments (CMA fallback) after max retries', normalizedErr, {
          modelId: filterParams.modelId,
          recordId: filterParams.recordId,
          attempts: attempt + 1,
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
  }, [realTimeEnabled, client, filterParams.modelId, filterParams.recordId, commentsModelId, cmaRetryKey, setCommentRecordId, setComments]);

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
    status: status as SubscriptionStatus,
    retry,
  };
}
