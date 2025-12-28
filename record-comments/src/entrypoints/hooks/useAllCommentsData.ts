import { useCallback, useEffect, useRef, useState } from 'react';
import type { Client } from '@datocms/cma-client-browser';
import { COMMENTS_MODEL_API_KEY, GLOBAL_MODEL_ID, TIMING } from '@/constants';
import { type CommentType, parseComments } from '@ctypes/comments';
import type { CommentSegment } from '@ctypes/mentions';
import { getRecordTitles } from '@utils/recordTitleUtils';

/**
 * Helper to delay execution for exponential backoff.
 *
 * NOTE: This delay utility is intentionally duplicated from useOperationQueue.ts.
 * While both files implement delay/backoff logic, they serve different purposes:
 *
 * - useAllCommentsData: Generic fetch retry for read-only data loading (My Mentions, Recent Comments)
 * - useOperationQueue: Specialized retry for write operations with optimistic locking
 *
 * Extracting to a shared utility was considered and rejected because:
 * 1. The implementations are trivial (1 line each)
 * 2. The retry strategies differ (fixed backoff vs. dynamic based on operation type)
 * 3. useOperationQueue has additional concerns (retry limits, stale version handling)
 * 4. Coupling these unrelated modules via shared utilities adds maintenance burden
 *
 * DO NOT extract these to a shared file without a compelling reason.
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch with exponential backoff retry for read-only operations.
 * Used for loading comments data for the dashboard sidebars.
 */
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = TIMING.MAX_NETWORK_RETRIES,
  baseDelay = TIMING.NETWORK_ERROR_BACKOFF_BASE
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));

      // Don't retry on final attempt
      if (attempt === maxRetries) break;

      // Exponential backoff with jitter
      const backoffDelay = Math.min(
        baseDelay * Math.pow(2, attempt) + Math.random() * 100,
        TIMING.NETWORK_ERROR_BACKOFF_MAX
      );
      await delay(backoffDelay);
    }
  }

  throw lastError ?? new Error('Fetch failed');
}

/**
 * Comment with its context (which record it belongs to)
 */
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

/**
 * Check if a comment segment mentions a specific user by email
 */
function segmentMentionsUser(segment: CommentSegment, userEmail: string): boolean {
  if (segment.type !== 'mention') return false;
  if (segment.mention.type !== 'user') return false;
  return segment.mention.email === userEmail;
}

/**
 * Check if a comment's content mentions a specific user
 */
function commentMentionsUser(content: CommentSegment[], userEmail: string): boolean {
  return content.some((segment) => segmentMentionsUser(segment, userEmail));
}

/**
 * Extract comments where the specified user is mentioned
 */
export function extractUserMentions(
  comments: CommentWithContext[],
  userEmail: string
): CommentWithContext[] {
  return comments
    .filter((item) => commentMentionsUser(item.comment.content, userEmail))
    .sort((a, b) =>
      new Date(b.comment.dateISO).getTime() - new Date(a.comment.dateISO).getTime()
    );
}

/**
 * Extract the N most recent comments across all records.
 * Excludes global comments since they have their own channel.
 */
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

/**
 * Hook to fetch all project_comment records for My Mentions and Recent Comments.
 * Uses periodic polling (every 30 seconds) instead of real-time subscription.
 *
 * PERFORMANCE CONSIDERATIONS:
 * ---------------------------
 * This hook fetches up to 100 comment records every 30 seconds, which involves:
 * - Network request to fetch all records
 * - JSON parsing and array flattening for all comments + replies
 * - Additional API calls to fetch record titles via getRecordTitles()
 *
 * ARCHITECTURAL LIMITATION - WHY POLLING INSTEAD OF SUBSCRIPTIONS:
 * ----------------------------------------------------------------
 * The DatoCMS GraphQL subscription API is designed for watching specific records,
 * not for efficiently querying "all comments mentioning user X" or "most recent N comments".
 * To use subscriptions here would require:
 *
 * 1. Subscribing to ALL project_comment records (impractical for large projects)
 * 2. Or maintaining a separate index/cache system server-side
 *
 * The polling approach is a pragmatic tradeoff:
 * - PROS: Simple implementation, works with existing DatoCMS APIs, no extra infrastructure
 * - CONS: 30-second latency for updates, network/CPU overhead every poll cycle
 *
 * POTENTIAL FUTURE IMPROVEMENTS:
 * ------------------------------
 * 1. Server-side filtering: If DatoCMS adds support for querying by JSON field content,
 *    we could filter mentions server-side instead of fetching all records.
 *
 * 2. Incremental updates: Track last fetch timestamp and only fetch records modified
 *    since then (requires DatoCMS filter by meta.updated_at).
 *
 * 3. Dedicated mentions index: Build a separate data structure tracking mentions,
 *    updated via webhooks when comments change.
 *
 * 4. Reduce poll frequency: Increase interval for less active projects, or make it configurable.
 *
 * For now, the 30-second polling with 100-record limit provides reasonable UX for most projects.
 * Projects with very high comment volumes may experience some latency in the dashboard sidebars.
 */
export function useAllCommentsData({
  client,
  mainLocale = 'en',
}: UseAllCommentsDataParams): UseAllCommentsDataReturn {
  const [allComments, setAllComments] = useState<CommentWithContext[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Store mainLocale in a ref to avoid recreating fetchAllComments when locale changes.
  // This prevents the polling interval from resetting on locale changes.
  //
  // REF PATTERN FOR STABLE CALLBACKS:
  // ---------------------------------
  // This pattern solves the "stale closure" problem with intervals:
  //
  // Problem: If we included `mainLocale` in fetchAllComments' dependency array,
  // changing the locale would recreate the callback, which would reset the interval,
  // causing unnecessary refetches and potential timing issues.
  //
  // Solution: Store the locale in a ref that's updated on every render. The callback
  // reads `mainLocaleRef.current` at execution time (not at callback creation time),
  // so it always gets the latest value.
  //
  // Why this is NOT a race condition:
  // - The ref is updated synchronously during render, before any effects run
  // - When the interval fires, it reads the current ref value at that moment
  // - Even if locale changes mid-fetch, we use the latest value (desirable behavior)
  // - The eslint-disable below is intentional - we access mainLocale via the ref
  //
  // This is a standard React pattern documented in the React Beta docs.
  const mainLocaleRef = useRef(mainLocale);
  mainLocaleRef.current = mainLocale;

  const fetchAllComments = useCallback(async () => {
    if (!client) {
      setIsLoading(false);
      return;
    }

    try {
      // Fetch all project_comment records with retry logic (limit to 100 for performance)
      const records = await fetchWithRetry(() =>
        client.items.list({
          filter: { type: COMMENTS_MODEL_API_KEY },
          page: { limit: 100 },
        })
      );

      const commentsWithContext: CommentWithContext[] = [];

      // Collect unique record IDs for non-global comments to fetch titles
      const recordsToFetch: Array<{ recordId: string; modelId: string }> = [];

      for (const record of records) {
        // Validate required properties exist and are strings before using them.
        // The CMA API returns these as part of the record, but we validate to guard
        // against API changes or unexpected data structures.
        const rawModelId = record.model_id;
        const rawRecordId = record.record_id;

        if (typeof rawModelId !== 'string' || typeof rawRecordId !== 'string') {
          // Skip malformed records - they lack required comment context identifiers
          continue;
        }

        const modelId = rawModelId;
        const recordId = rawRecordId;
        const content = parseComments(record.content);
        const isGlobal = modelId === GLOBAL_MODEL_ID;

        // Track non-global records for title fetching
        if (!isGlobal) {
          recordsToFetch.push({ recordId, modelId });
        }

        // Flatten all comments and replies
        for (const comment of content) {
          commentsWithContext.push({
            comment,
            modelId,
            recordId,
            commentRecordId: record.id,
            isGlobal,
            isReply: false,
          });

          // Include replies
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

      // Fetch record titles for non-global comments.
      //
      // PERFORMANCE NOTE: This is NOT an N+1 problem despite appearances.
      // getRecordTitles() is specifically designed for batch efficiency:
      // - Groups records by modelId
      // - Uses LRU caching (150 entries) for item types and fields
      // - Batch fetches up to 100 records per API call
      // - Processes models in parallel via Promise.all()
      //
      // Even with 100 comment records across multiple models, this results in
      // only O(models) API calls for metadata + O(records/100) calls for data.
      // See recordTitleUtils.ts for the implementation details.
      if (recordsToFetch.length > 0) {
        const titleMap = await getRecordTitles(client, recordsToFetch, mainLocaleRef.current);

        // Enrich comments with record titles
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
      setIsLoading(false);
    }
    // NOTE: mainLocale is accessed via mainLocaleRef to avoid recreating this callback
    // when locale changes. This prevents the polling interval from resetting unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // Initial fetch
  useEffect(() => {
    fetchAllComments();
  }, [fetchAllComments]);

  // Periodic refresh - only set up interval if client is available
  // This prevents unnecessary interval execution when client is null
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
