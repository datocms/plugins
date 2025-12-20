import type { CommentType, Upvoter } from '../CommentsBar';
import type {
  CommentOperation,
  AddCommentOp,
  DeleteCommentOp,
  EditCommentOp,
  UpvoteCommentOp,
  AddReplyOp,
} from '../types/operations';

/**
 * Apply an operation to a comments array.
 * These are pure functions that take server state and return new state.
 */
export function applyOperation(
  comments: CommentType[],
  op: CommentOperation
): CommentType[] {
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
 * Idempotent: if comment with same dateISO exists, skip.
 */
function applyAddComment(comments: CommentType[], op: AddCommentOp): CommentType[] {
  // Check for duplicate (idempotency)
  if (comments.some((c) => c.dateISO === op.comment.dateISO)) {
    return comments;
  }
  return [op.comment, ...comments];
}

/**
 * Delete a comment (top-level or reply).
 * Idempotent: if comment doesn't exist, no-op.
 */
function applyDeleteComment(comments: CommentType[], op: DeleteCommentOp): CommentType[] {
  if (op.parentCommentISO) {
    // Delete a reply
    return comments.map((c) =>
      c.dateISO === op.parentCommentISO
        ? { ...c, replies: c.replies?.filter((r) => r.dateISO !== op.dateISO) }
        : c
    );
  }
  // Delete a top-level comment
  return comments.filter((c) => c.dateISO !== op.dateISO);
}

/**
 * Edit a comment's content (top-level or reply).
 * Idempotent: if comment doesn't exist, no-op.
 */
function applyEditComment(comments: CommentType[], op: EditCommentOp): CommentType[] {
  if (op.parentCommentISO) {
    // Edit a reply
    return comments.map((c) =>
      c.dateISO === op.parentCommentISO
        ? {
            ...c,
            replies: c.replies?.map((r) =>
              r.dateISO === op.dateISO ? { ...r, content: op.newContent } : r
            ),
          }
        : c
    );
  }
  // Edit a top-level comment
  return comments.map((c) =>
    c.dateISO === op.dateISO ? { ...c, content: op.newContent } : c
  );
}

/**
 * Add or remove an upvote from a comment.
 * Idempotent: uses explicit 'add' or 'remove' action instead of toggle.
 */
function applyUpvoteComment(comments: CommentType[], op: UpvoteCommentOp): CommentType[] {
  const modifyUpvotes = (voters: Upvoter[]): Upvoter[] => {
    const hasUpvoted = voters.some((v) => v.email === op.user.email);

    if (op.action === 'add') {
      // Only add if not already upvoted
      if (hasUpvoted) return voters;
      return [...voters, op.user];
    } else {
      // Remove the upvote
      return voters.filter((v) => v.email !== op.user.email);
    }
  };

  if (op.parentCommentISO) {
    // Upvote a reply
    return comments.map((c) =>
      c.dateISO === op.parentCommentISO
        ? {
            ...c,
            replies: c.replies?.map((r) =>
              r.dateISO === op.dateISO
                ? { ...r, usersWhoUpvoted: modifyUpvotes(r.usersWhoUpvoted) }
                : r
            ),
          }
        : c
    );
  }
  // Upvote a top-level comment
  return comments.map((c) =>
    c.dateISO === op.dateISO
      ? { ...c, usersWhoUpvoted: modifyUpvotes(c.usersWhoUpvoted) }
      : c
  );
}

/**
 * Add a reply to a parent comment.
 * Idempotent: if reply with same dateISO exists, skip.
 */
function applyAddReply(comments: CommentType[], op: AddReplyOp): CommentType[] {
  return comments.map((c) => {
    if (c.dateISO !== op.parentCommentISO) return c;

    // Check for duplicate reply (idempotency)
    if (c.replies?.some((r) => r.dateISO === op.reply.dateISO)) {
      return c;
    }

    return {
      ...c,
      replies: [op.reply, ...(c.replies ?? [])],
    };
  });
}




