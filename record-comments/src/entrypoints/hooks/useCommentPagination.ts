import type { CommentType } from '@ctypes/comments';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { COMMENTS_PAGE_SIZE } from '@/constants';

/** Keep new comments visible while limiting the initial list for each record. */
export function useCommentPagination(
  comments: CommentType[],
  contextKey: string,
) {
  const [pagination, setPagination] = useState<{
    contextKey: string;
    hiddenCount: number | null;
  }>({ contextKey, hiddenCount: null });
  const maximumHiddenCount = Math.max(0, comments.length - COMMENTS_PAGE_SIZE);
  const hiddenCount = Math.min(
    maximumHiddenCount,
    pagination.contextKey === contextKey
      ? (pagination.hiddenCount ?? maximumHiddenCount)
      : maximumHiddenCount,
  );

  useEffect(() => {
    setPagination((previous) => {
      if (previous.contextKey !== contextKey) {
        return {
          contextKey,
          hiddenCount: comments.length > 0 ? maximumHiddenCount : null,
        };
      }
      if (previous.hiddenCount === null && comments.length > 0) {
        return { contextKey, hiddenCount: maximumHiddenCount };
      }
      return previous;
    });
  }, [comments.length, contextKey, maximumHiddenCount]);

  const visibleStoredComments = useMemo(
    () => comments.slice(0, comments.length - hiddenCount),
    [comments, hiddenCount],
  );
  const loadMore = useCallback(() => {
    setPagination({
      contextKey,
      hiddenCount: Math.max(0, hiddenCount - COMMENTS_PAGE_SIZE),
    });
  }, [contextKey, hiddenCount]);

  return { visibleStoredComments, hasMoreComments: hiddenCount > 0, loadMore };
}
