import type { RefObject } from 'react';
import type { CommentSegment } from '@ctypes/mentions';
import type { CommentType, Upvoter } from '@ctypes/comments';
import type { CommentOperation } from '@ctypes/operations';

// ============================================================================
// ARCHITECTURE NOTE: Why These Functions Exist Separately from operationApplicators.ts
// ============================================================================
//
// DO NOT CONSOLIDATE THIS CODE WITH operationApplicators.ts
// This has been analyzed and the duplication is intentional.
//
// This file contains functions for LOCAL/OPTIMISTIC state updates (immediate UI feedback).
// operationApplicators.ts contains functions for SERVER state operations (with status tracking).
//
// These are intentionally separate because:
//
// 1. DIFFERENT PURPOSES:
//    - Local state: Needs to be fast, assumes success, no validation overhead
//    - Server state: Needs status tracking, existence checks, logging for debugging
//
// 2. DIFFERENT RETURN TYPES:
//    - Local: Returns CommentType[] directly (simple array)
//    - Server: Returns OperationResult with status, failureReason, etc.
//
// 3. DIFFERENT CONSUMERS:
//    - Local: Called by useCommentActions for immediate UI updates
//    - Server: Called by useOperationQueue for persistent operations
//
// WHY NOT ABSTRACT THE SHARED LOGIC?
// ----------------------------------
// The core mutation logic (filter/map operations) IS similar, but abstraction
// would introduce more problems than it solves:
//
// - Would add coupling between UI and persistence layers
// - Would require intermediate types/abstractions for simple one-liner operations
// - The actual mutation logic is trivial: filter() for delete, map() for edit/upvote
// - A shared "updateCommentInTree()" function would need complex generics to handle
//   both the simple local updates and the status-tracking server updates
// - Type safety would be harder to maintain with generic tree-walking utilities
// - Testing and debugging would be more complex with shared abstractions
//
// The "duplication" is 3-4 one-line filter/map operations that are:
// - Easy to understand in isolation
// - Easy to modify without affecting the other layer
// - Type-safe within their specific context
//
// This is a case where DRY (Don't Repeat Yourself) would reduce code quality.
// See: "The Wrong Abstraction" by Sandi Metz.
//
// MAINTENANCE: If you modify comment structure, update BOTH files.
// ============================================================================

/**
 * Check if segments are empty (no content or only whitespace text)
 */
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

/**
 * Check if author information is valid (name and email are non-empty)
 */
export function isAuthorValid(userName: string, userEmail: string): boolean {
  return userName.trim().length > 0 && userEmail.trim().length > 0;
}

/**
 * Toggle upvote for a user on a list of upvoters
 */
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

/**
 * Apply delete to comment state
 */
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
 * Apply edit to comment state
 */
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

/**
 * Apply upvote to comment state
 */
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
 * Create a new comment object.
 *
 * ## ID Generation Strategy
 *
 * This function generates two distinct identifiers:
 *
 * - `id`: A UUID via `crypto.randomUUID()` - used as the stable unique identifier
 *   for lookups, React keys, and `parentCommentId` references in replies.
 *
 * - `dateISO`: An ISO 8601 timestamp - used only for display purposes
 *   ("5 minutes ago") and chronological sorting.
 *
 * ### Historical Note
 * Earlier versions of this plugin set `id` to the same value as `dateISO`
 * (the ISO timestamp). This was problematic because:
 * 1. Timestamps are not guaranteed unique (millisecond collisions possible)
 * 2. Mixing identifiers with display values creates semantic confusion
 *
 * The current UUID-based approach resolves these issues for new comments,
 * but legacy data may still have `id === dateISO`. See the TECHNICAL DEBT
 * documentation in `CommentType` (types/comments.ts) for details.
 *
 * ### Reply Threading
 * When `parentCommentId` is provided, it references the parent comment's `id`
 * field. The threading system depends on `id` being stable - if a parent's
 * `id` were ever changed, all reply references would break.
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

  // Generate separate values for id (stable identifier) and dateISO (timestamp for display)
  // See CommentType documentation for why these must be distinct values
  const id = crypto.randomUUID();
  const dateISO = new Date().toISOString();

  // For replies, don't include the 'replies' property at all
  // This is important because Comment.tsx uses 'replies' in commentObject
  // to determine if it's a top-level comment
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

  // Top-level comments have an empty replies array
  return {
    id,
    dateISO,
    content,
    author: { name: userName, email: userEmail },
    usersWhoUpvoted: [],
    replies: [],
  };
}

/**
 * Create delete operation for pending replies tracking
 */
export function handlePendingReplyDelete(
  pendingNewReplies: RefObject<Set<string> | null>,
  id: string,
  parentCommentId: string | undefined,
  enqueue: (operation: CommentOperation) => void
): void {
  const isUnsavedNewReply = pendingNewReplies.current?.has(id) ?? false;

  if (isUnsavedNewReply) {
    // This was a new reply that was never saved - just clean up tracking
    pendingNewReplies.current?.delete(id);
  } else {
    // Queue operation for persistent delete with retry
    enqueue({
      type: 'DELETE_COMMENT',
      id,
      parentCommentId,
    });
  }
}

/**
 * Shared return type for comment action hooks
 */
export type CommentActionsReturn = {
  submitNewComment: () => void;
  deleteComment: (id: string, parentCommentId?: string) => void;
  editComment: (id: string, newContent: CommentSegment[], parentCommentId?: string) => void;
  upvoteComment: (id: string, userUpvoted: boolean, parentCommentId?: string) => void;
  replyComment: (parentCommentId: string) => void;
};
