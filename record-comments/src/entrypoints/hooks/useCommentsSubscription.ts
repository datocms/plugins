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
    setComments(parseComments(record.content));
  }, [data, isSyncAllowed, realTimeEnabled, setCommentRecordId, setComments]);

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
          setComments(parseComments(firstRecord.content));
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
