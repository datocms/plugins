import type { RefObject } from 'react';
import type { CommentSegment } from '@ctypes/mentions';
import type { CommentType } from '@ctypes/comments';
import type { CommentOperation } from '@ctypes/operations';
import { segmentsToStoredSegments } from '@utils/tipTapSerializer';

// LOCAL/OPTIMISTIC state updates (fast, assumes success).
// Separate from operationApplicators.ts which handles SERVER state (with status tracking).
// Duplication is intentional - DRY would add coupling without benefit for trivial filter/map ops.

export function isSegmentsEmpty(segments: CommentSegment[]): boolean {
  if (segments.length === 0) return true;
  // Check if there's any non-whitespace text content
  return !segments.some((segment) => {
    if (segment.type === 'text') {
      return segment.content.trim().length > 0;
    }
    // Mentions count as content
    return segment.type === 'mention';
  });
}

export function isAuthorValid(userId: string): boolean {
  return userId.trim().length > 0;
}

function toggleUpvote(
  voterIds: string[],
  voterId: string,
  userUpvoted: boolean
): string[] {
  return userUpvoted
    ? voterIds.filter((id) => id !== voterId)
    : [...voterIds, voterId];
}

export function applyDeleteToState(
  comments: CommentType[],
  id: string,
  parentCommentId?: string
): CommentType[] {
  if (parentCommentId) {
    return comments.map((c) =>
      c.id === parentCommentId
        ? { ...c, replies: c.replies?.filter((r) => r.id !== id) }
        : c
    );
  }
  return comments.filter((c) => c.id !== id);
}

/**
 * Takes full CommentSegment[] and converts to StoredCommentSegment[] for state update.
 */
export function applyEditToState(
  comments: CommentType[],
  id: string,
  newContent: CommentSegment[],
  parentCommentId?: string
): CommentType[] {
  const storedContent = segmentsToStoredSegments(newContent);
  if (parentCommentId) {
    return comments.map((c) =>
      c.id === parentCommentId
        ? {
            ...c,
            replies: c.replies?.map((r) =>
              r.id === id ? { ...r, content: storedContent } : r
            ),
          }
        : c
    );
  }
  return comments.map((c) =>
    c.id === id ? { ...c, content: storedContent } : c
  );
}

export function applyUpvoteToState(
  comments: CommentType[],
  id: string,
  voterId: string,
  userUpvoted: boolean,
  parentCommentId?: string
): CommentType[] {
  if (parentCommentId) {
    return comments.map((c) =>
      c.id === parentCommentId
        ? {
            ...c,
            replies: c.replies?.map((r) =>
              r.id === id
                ? { ...r, upvoterIds: toggleUpvote(r.upvoterIds, voterId, userUpvoted) }
                : r
            ),
          }
        : c
    );
  }
  return comments.map((c) =>
    c.id === id
      ? { ...c, upvoterIds: toggleUpvote(c.upvoterIds, voterId, userUpvoted) }
      : c
  );
}

/**
 * id: UUID for stable lookups/React keys. dateISO: timestamp for display/sorting.
 * Takes full CommentSegment[] from editor and converts to StoredCommentSegment[] for storage.
 * Only stores user ID - display data resolved at render time.
 */
export function createComment(
  content: CommentSegment[],
  authorId: string,
  parentCommentId?: string
): CommentType {
  if (!isAuthorValid(authorId)) {
    throw new Error('Cannot create comment: author ID is required');
  }

  const id = crypto.randomUUID();
  const dateISO = new Date().toISOString();
  const storedContent = segmentsToStoredSegments(content);

  // Replies omit 'replies' property; Comment.tsx uses its presence to detect top-level
  if (parentCommentId) {
    return {
      id,
      dateISO,
      content: storedContent,
      authorId,
      upvoterIds: [],
      parentCommentId,
    };
  }

  return {
    id,
    dateISO,
    content: storedContent,
    authorId,
    upvoterIds: [],
    replies: [],
  };
}

export function handlePendingReplyDelete(
  pendingNewReplies: RefObject<Set<string> | null>,
  id: string,
  parentCommentId: string | undefined,
  enqueue: (operation: CommentOperation) => void
): void {
  const isUnsavedNewReply = pendingNewReplies.current?.has(id) ?? false;

  if (isUnsavedNewReply) {
    pendingNewReplies.current?.delete(id);
  } else {
    enqueue({
      type: 'DELETE_COMMENT',
      id,
      parentCommentId,
    });
  }
}

export type CommentActionsReturn = {
  submitNewComment: () => void;
  deleteComment: (id: string, parentCommentId?: string) => void;
  editComment: (id: string, newContent: CommentSegment[], parentCommentId?: string) => void;
  upvoteComment: (id: string, userUpvoted: boolean, parentCommentId?: string) => void;
  replyComment: (parentCommentId: string) => void;
};
