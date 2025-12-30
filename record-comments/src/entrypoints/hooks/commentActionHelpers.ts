import type { RefObject } from 'react';
import type { CommentSegment } from '@ctypes/mentions';
import type { CommentType, Upvoter } from '@ctypes/comments';
import type { CommentOperation } from '@ctypes/operations';

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

export function isAuthorValid(userName: string, userEmail: string): boolean {
  return userName.trim().length > 0 && userEmail.trim().length > 0;
}

export function toggleUpvote(
  voters: Upvoter[],
  user: Upvoter,
  userUpvoted: boolean
): Upvoter[] {
  if (userUpvoted) {
    // Remove current user's upvote
    return voters.filter((voter) => voter.email !== user.email);
  }
  // Add current user's upvote
  return [...voters, user];
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

export function applyEditToState(
  comments: CommentType[],
  id: string,
  newContent: CommentSegment[],
  parentCommentId?: string
): CommentType[] {
  if (parentCommentId) {
    return comments.map((c) =>
      c.id === parentCommentId
        ? {
            ...c,
            replies: c.replies?.map((r) =>
              r.id === id ? { ...r, content: newContent } : r
            ),
          }
        : c
    );
  }
  return comments.map((c) =>
    c.id === id ? { ...c, content: newContent } : c
  );
}

export function applyUpvoteToState(
  comments: CommentType[],
  id: string,
  user: Upvoter,
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
                ? { ...r, usersWhoUpvoted: toggleUpvote(r.usersWhoUpvoted, user, userUpvoted) }
                : r
            ),
          }
        : c
    );
  }
  return comments.map((c) =>
    c.id === id
      ? { ...c, usersWhoUpvoted: toggleUpvote(c.usersWhoUpvoted, user, userUpvoted) }
      : c
  );
}

/**
 * id: UUID for stable lookups/React keys. dateISO: timestamp for display/sorting.
 * Legacy data may have id === dateISO (see CommentType docs).
 */
export function createComment(
  content: CommentSegment[],
  userName: string,
  userEmail: string,
  parentCommentId?: string
): CommentType {
  if (!isAuthorValid(userName, userEmail)) {
    throw new Error('Cannot create comment: author name and email are required');
  }

  const id = crypto.randomUUID();
  const dateISO = new Date().toISOString();

  // Replies omit 'replies' property; Comment.tsx uses its presence to detect top-level
  if (parentCommentId) {
    return {
      id,
      dateISO,
      content,
      author: { name: userName, email: userEmail },
      usersWhoUpvoted: [],
      parentCommentId,
    };
  }

  return {
    id,
    dateISO,
    content,
    author: { name: userName, email: userEmail },
    usersWhoUpvoted: [],
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
