import type { CommentType, Upvoter } from '@ctypes/comments';
import type {
  CommentOperation,
  AddCommentOp,
  DeleteCommentOp,
  EditCommentOp,
  UpvoteCommentOp,
  AddReplyOp,
  OperationResult,
} from '@ctypes/operations';
import { logWarn } from '@/utils/errorLogger';

// ============================================================================
// OPERATION RESULT SYSTEM
// ============================================================================
//
// This file implements operation application with explicit result reporting.
// Each operation returns an OperationResult that indicates:
// - 'applied': The operation was successfully applied
// - 'no_op_idempotent': The operation was already applied (safe retry)
// - 'failed_parent_missing': Reply operation failed because parent was deleted
// - 'failed_target_missing': Target comment/reply doesn't exist
//
// The caller (useOperationQueue) uses this result to:
// - Show user alerts for failures that cause content loss (ADD_REPLY, EDIT on reply)
// - Distinguish between "already done" (fine) and "failed" (needs notification)
//
// This solves the previous "silent failure" problem where user content could
// be lost without any notification when parents were deleted by other users.
// ============================================================================

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find a comment by ID (top-level only).
 */
function findTopLevelComment(comments: CommentType[], id: string): CommentType | undefined {
  return comments.find((c) => c.id === id);
}

/**
 * Find a reply within a parent comment.
 */
function findReply(parent: CommentType, replyId: string): CommentType | undefined {
  return parent.replies?.find((r) => r.id === replyId);
}

// ============================================================================
// Comment Resolution Types and Helpers
// ============================================================================

/**
 * Result of resolving a comment target (either top-level or reply).
 * Used by operations that need to find and validate their target comment.
 */
type CommentResolutionSuccess = {
  success: true;
  isReply: boolean;
  parent?: CommentType;
  target: CommentType;
};

type CommentResolutionFailure = {
  success: false;
  result: OperationResult;
};

type CommentResolution = CommentResolutionSuccess | CommentResolutionFailure;

/**
 * Configuration for failure messages during comment resolution.
 */
type ResolutionFailureConfig = {
  operationName: string;
  parentMissingReason: string;
  targetMissingReason: string;
  /** If true, target not found returns no_op_idempotent instead of failed_target_missing */
  targetNotFoundIsIdempotent?: boolean;
};

/**
 * Resolve a comment target for operations that can target either top-level or reply comments.
 *
 * This centralizes the common pattern of:
 * 1. Checking if operation targets a reply (parentCommentId exists)
 * 2. Finding the parent comment
 * 3. Validating parent exists
 * 4. Finding the target reply
 * 5. Validating target exists
 *
 * Returns either:
 * - Success with the resolved target (and parent for replies)
 * - Failure with the appropriate OperationResult to return
 */
function resolveCommentTarget(
  comments: CommentType[],
  targetId: string,
  parentCommentId: string | undefined,
  config: ResolutionFailureConfig
): CommentResolution {
  if (parentCommentId) {
    // Target is a reply - validate parent exists
    const parent = findTopLevelComment(comments, parentCommentId);
    if (!parent) {
      logWarn(
        `${config.operationName}: parent ${parentCommentId} not found - parent may have been deleted by another user`
      );
      return {
        success: false,
        result: {
          comments,
          status: 'failed_parent_missing',
          failureReason: config.parentMissingReason,
        },
      };
    }

    // Validate reply exists
    const reply = findReply(parent, targetId);
    if (!reply) {
      if (config.targetNotFoundIsIdempotent) {
        return {
          success: false,
          result: { comments, status: 'no_op_idempotent' },
        };
      }
      logWarn(`${config.operationName}: reply ${targetId} not found in parent ${parentCommentId}`);
      return {
        success: false,
        result: {
          comments,
          status: 'failed_target_missing',
          failureReason: config.targetMissingReason,
        },
      };
    }

    return { success: true, isReply: true, parent, target: reply };
  }

  // Target is a top-level comment
  const comment = findTopLevelComment(comments, targetId);
  if (!comment) {
    if (config.targetNotFoundIsIdempotent) {
      return {
        success: false,
        result: { comments, status: 'no_op_idempotent' },
      };
    }
    logWarn(`${config.operationName}: comment ${targetId} not found`);
    return {
      success: false,
      result: {
        comments,
        status: 'failed_target_missing',
        failureReason: config.targetMissingReason,
      },
    };
  }

  return { success: true, isReply: false, target: comment };
}

/**
 * Apply an update to either a reply or top-level comment.
 * Handles the common map pattern for updating nested replies.
 */
function applyCommentUpdate(
  comments: CommentType[],
  targetId: string,
  parentCommentId: string | undefined,
  updateFn: (comment: CommentType) => CommentType
): CommentType[] {
  if (parentCommentId) {
    // Update a reply within its parent
    return comments.map((c) =>
      c.id === parentCommentId
        ? { ...c, replies: c.replies?.map((r) => (r.id === targetId ? updateFn(r) : r)) }
        : c
    );
  }
  // Update a top-level comment
  return comments.map((c) => (c.id === targetId ? updateFn(c) : c));
}

// ============================================================================
// Main Apply Function
// ============================================================================

/**
 * Apply an operation to a comments array.
 * These are pure functions that take server state and return new state.
 *
 * All operations are idempotent - applying the same operation twice
 * produces the same result. This is essential for retry logic.
 *
 * Returns an OperationResult with:
 * - comments: The resulting comments array
 * - status: The outcome ('applied', 'no_op_idempotent', 'failed_parent_missing', 'failed_target_missing')
 * - failureReason: Human-readable explanation for failures
 *
 * The caller (useOperationQueue) uses this to show appropriate user feedback
 * when operations fail due to concurrent modifications by other users.
 *
 * ## Comment Identification
 *
 * All operations identify comments using the `id` field, NOT `dateISO`.
 * This is critical for correctness:
 *
 * - `id` is the stable unique identifier (UUID for new comments)
 * - `dateISO` is purely for display and should never be used for lookups
 *
 * For reply operations, `parentCommentId` references the parent's `id` field.
 * The threading system assumes `id` values are immutable once assigned.
 *
 * ### Legacy Data Warning
 * Some older comments may have `id === dateISO` (timestamp-based IDs).
 * The operations still work correctly for these cases, but be aware:
 * - Timestamp-based IDs could theoretically collide (same millisecond)
 * - If legacy IDs are ever migrated to UUIDs, all `parentCommentId`
 *   references must be updated atomically or reply threading will break
 *
 * See `CommentType` in types/comments.ts for full technical debt documentation.
 */
export function applyOperation(
  comments: CommentType[],
  op: CommentOperation
): OperationResult {
  switch (op.type) {
    case 'ADD_COMMENT':
      return applyAddComment(comments, op);
    case 'DELETE_COMMENT':
      return applyDeleteComment(comments, op);
    case 'EDIT_COMMENT':
      return applyEditComment(comments, op);
    case 'UPVOTE_COMMENT':
      return applyUpvoteComment(comments, op);
    case 'ADD_REPLY':
      return applyAddReply(comments, op);
  }
}

/**
 * Add a new top-level comment.
 * Idempotent: if comment with same id exists, returns no_op_idempotent.
 */
function applyAddComment(comments: CommentType[], op: AddCommentOp): OperationResult {
  // Check for duplicate (idempotency)
  if (comments.some((c) => c.id === op.comment.id)) {
    return { comments, status: 'no_op_idempotent' };
  }
  return { comments: [op.comment, ...comments], status: 'applied' };
}

/**
 * Delete a comment (top-level or reply).
 * Idempotent: if comment doesn't exist, returns no_op_idempotent.
 *
 * Note: Delete operations on replies where parent is missing are benign
 * since the parent (and its replies) are gone anyway. We return
 * failed_parent_missing for consistency but this is low severity.
 */
function applyDeleteComment(comments: CommentType[], op: DeleteCommentOp): OperationResult {
  const resolution = resolveCommentTarget(comments, op.id, op.parentCommentId, {
    operationName: 'DELETE_COMMENT',
    parentMissingReason: 'The comment thread was deleted by another user.',
    targetMissingReason: 'The comment was deleted by another user.',
    targetNotFoundIsIdempotent: true,
  });

  if (!resolution.success) {
    return resolution.result;
  }

  if (resolution.isReply) {
    const newComments = comments.map((c) =>
      c.id === op.parentCommentId
        ? { ...c, replies: c.replies?.filter((r) => r.id !== op.id) }
        : c
    );
    return { comments: newComments, status: 'applied' };
  }

  return { comments: comments.filter((c) => c.id !== op.id), status: 'applied' };
}

/**
 * Edit a comment's content (top-level or reply).
 * Idempotent: if comment doesn't exist, returns appropriate failure status.
 *
 * HIGH SEVERITY for reply edits when parent is missing - user's edit content is lost.
 */
function applyEditComment(comments: CommentType[], op: EditCommentOp): OperationResult {
  const resolution = resolveCommentTarget(comments, op.id, op.parentCommentId, {
    operationName: 'EDIT_COMMENT',
    parentMissingReason:
      'Your edit could not be saved because the comment thread was deleted by another user.',
    targetMissingReason: op.parentCommentId
      ? 'The reply you were editing was deleted by another user.'
      : 'The comment you were editing was deleted by another user.',
  });

  if (!resolution.success) {
    return resolution.result;
  }

  const newComments = applyCommentUpdate(
    comments,
    op.id,
    op.parentCommentId,
    (comment) => ({ ...comment, content: op.newContent })
  );
  return { comments: newComments, status: 'applied' };
}

/**
 * Add or remove an upvote from a comment.
 * Idempotent: uses explicit 'add' or 'remove' action instead of toggle.
 *
 * Low severity for failures - no user content is lost, just an upvote click.
 */
function applyUpvoteComment(comments: CommentType[], op: UpvoteCommentOp): OperationResult {
  const resolution = resolveCommentTarget(comments, op.id, op.parentCommentId, {
    operationName: 'UPVOTE_COMMENT',
    parentMissingReason: 'The comment thread was deleted by another user.',
    targetMissingReason: op.parentCommentId
      ? 'The reply was deleted by another user.'
      : 'The comment was deleted by another user.',
  });

  if (!resolution.success) {
    return resolution.result;
  }

  const modifyUpvotes = (voters: Upvoter[]): Upvoter[] => {
    const hasUpvoted = voters.some((v) => v.email === op.user.email);

    if (op.action === 'add') {
      // Only add if not already upvoted
      if (hasUpvoted) return voters;
      return [...voters, op.user];
    }
    // Remove the upvote
    return voters.filter((v) => v.email !== op.user.email);
  };

  const newComments = applyCommentUpdate(
    comments,
    op.id,
    op.parentCommentId,
    (comment) => ({ ...comment, usersWhoUpvoted: modifyUpvotes(comment.usersWhoUpvoted) })
  );
  return { comments: newComments, status: 'applied' };
}

/**
 * Add a reply to a parent comment.
 * Idempotent: if reply with same id exists, returns no_op_idempotent.
 *
 * HIGH SEVERITY when parent is missing - user's composed reply content is lost.
 */
function applyAddReply(comments: CommentType[], op: AddReplyOp): OperationResult {
  // Check parent exists before attempting to add reply
  const parent = findTopLevelComment(comments, op.parentCommentId);
  if (!parent) {
    // HIGH SEVERITY: User's reply content is lost
    logWarn(`ADD_REPLY: parent ${op.parentCommentId} not found - parent may have been deleted by another user. User's reply content is lost.`);
    return {
      comments,
      status: 'failed_parent_missing',
      failureReason: 'Your reply could not be saved because the comment was deleted by another user.',
    };
  }

  // Check for duplicate reply (idempotency)
  if (parent.replies?.some((r) => r.id === op.reply.id)) {
    return { comments, status: 'no_op_idempotent' };
  }

  const newComments = comments.map((c) => {
    if (c.id !== op.parentCommentId) return c;

    return {
      ...c,
      replies: [op.reply, ...(c.replies ?? [])],
    };
  });

  return { comments: newComments, status: 'applied' };
}

