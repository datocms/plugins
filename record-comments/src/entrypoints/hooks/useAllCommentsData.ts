import { useCallback, useEffect, useRef, useState } from 'react';
import type { Client } from '@datocms/cma-client-browser';
import { COMMENTS_MODEL_API_KEY, GLOBAL_MODEL_ID, MENTION_STATE_MODEL_ID, TIMING } from '@/constants';
import { type CommentType, parseComments } from '@ctypes/comments';
import type { StoredCommentSegment } from '@ctypes/mentions';
import { getRecordTitles } from '@utils/recordTitleUtils';
import { delay, calculateBackoffDelay } from '@utils/backoff';

const MAX_FETCH_RETRIES = 3;
const FETCH_RETRY_BASE_DELAY = 500;
const FETCH_RETRY_MAX_DELAY = 8000;

async function fetchWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));

      if (attempt === MAX_FETCH_RETRIES) break;

      const backoffDelay = calculateBackoffDelay(
        attempt,
        FETCH_RETRY_BASE_DELAY,
        FETCH_RETRY_MAX_DELAY,
        true // jitter
      );
      await delay(backoffDelay);
    }
  }

  throw lastError ?? new Error('Fetch failed');
}

export type CommentWithContext = {
  comment: CommentType;
  modelId: string;
  recordId: string;
  commentRecordId: string;
  isGlobal: boolean;
  isReply: boolean;
  parentCommentId?: string;
  recordTitle?: string;
  modelName?: string;
  isSingleton?: boolean;
  mentionKey?: string;
};

type UseAllCommentsDataParams = {
  client: Client | null;
  mainLocale?: string;
};

type UseAllCommentsDataReturn = {
  allComments: CommentWithContext[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

/** Checks if a stored segment mentions a specific user by ID. */
function segmentMentionsUser(segment: StoredCommentSegment, userId: string): boolean {
  if (segment.type !== 'mention') return false;
  if (segment.mention.type !== 'user') return false;
  return segment.mention.id === userId;
}

/** Checks if comment content contains a mention of a specific user by ID. */
function commentMentionsUser(content: StoredCommentSegment[], userId: string): boolean {
  return content.some((segment) => segmentMentionsUser(segment, userId));
}

/**
 * Extracts comments that mention the specified user.
 * @param userId - The user ID to match (use projectUsers to find ID from email)
 */
export function extractUserMentions(
  comments: CommentWithContext[],
  userId: string
): CommentWithContext[] {
  return comments
    .filter((item) => commentMentionsUser(item.comment.content, userId))
    .sort((a, b) =>
      new Date(b.comment.dateISO).getTime() - new Date(a.comment.dateISO).getTime()
    );
}

/** Excludes global comments since they have their own channel. */
export function extractRecentComments(
  comments: CommentWithContext[],
  limit: number
): CommentWithContext[] {
  return comments
    .filter((item) => !item.isGlobal)
    .sort((a, b) =>
      new Date(b.comment.dateISO).getTime() - new Date(a.comment.dateISO).getTime()
    )
    .slice(0, limit);
}

/** Fetches all comments via 30s polling. Limited to 100 records. */
export function useAllCommentsData({
  client,
  mainLocale = 'en',
}: UseAllCommentsDataParams): UseAllCommentsDataReturn {
  const [allComments, setAllComments] = useState<CommentWithContext[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const hasFetchedOnce = useRef(false);

  const mainLocaleRef = useRef(mainLocale);
  mainLocaleRef.current = mainLocale;

  const fetchAllComments = useCallback(async () => {
    if (!client) {
      setIsLoading(false);
      return;
    }

    // Only show loading state on first fetch
    const isFirstFetch = !hasFetchedOnce.current;

    try {
      const records = await fetchWithRetry(() =>
        client.items.list({
          filter: { type: COMMENTS_MODEL_API_KEY },
          page: { limit: 100 },
        })
      );

      const commentsWithContext: CommentWithContext[] = [];
      const recordsToFetch: Array<{ recordId: string; modelId: string }> = [];

      for (const record of records) {
        const rawModelId = record.model_id;
        const rawRecordId = record.record_id;

        if (typeof rawModelId !== 'string' || typeof rawRecordId !== 'string') {
          continue;
        }
        if (rawModelId === MENTION_STATE_MODEL_ID) {
          continue;
        }

        const modelId = rawModelId;
        const recordId = rawRecordId;
        const content = parseComments(record.content);
        const isGlobal = modelId === GLOBAL_MODEL_ID;

        if (!isGlobal) {
          recordsToFetch.push({ recordId, modelId });
        }

        for (const comment of content) {
          commentsWithContext.push({
            comment,
            modelId,
            recordId,
            commentRecordId: record.id,
            isGlobal,
            isReply: false,
          });

          if (comment.replies) {
            for (const reply of comment.replies) {
              commentsWithContext.push({
                comment: reply,
                modelId,
                recordId,
                commentRecordId: record.id,
                isGlobal,
                isReply: true,
                parentCommentId: comment.id,
              });
            }
          }
        }
      }

      if (recordsToFetch.length > 0) {
        const titleMap = await getRecordTitles(client, recordsToFetch, mainLocaleRef.current);

        for (const commentWithContext of commentsWithContext) {
          if (!commentWithContext.isGlobal) {
            const titleInfo = titleMap.get(commentWithContext.recordId);
            if (titleInfo) {
              commentWithContext.recordTitle = titleInfo.title;
              commentWithContext.modelName = titleInfo.modelName;
              commentWithContext.isSingleton = titleInfo.isSingleton;
            }
          }
        }
      }

      setAllComments(commentsWithContext);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      hasFetchedOnce.current = true;
      if (isFirstFetch) {
        setIsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mainLocale accessed via ref
  }, [client]);

  useEffect(() => {
    fetchAllComments();
  }, [fetchAllComments]);

  useEffect(() => {
    if (!client) return;

    const interval = setInterval(fetchAllComments, TIMING.POLLING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [client, fetchAllComments]);

  return {
    allComments,
    isLoading,
    error,
    refetch: fetchAllComments,
  };
}
