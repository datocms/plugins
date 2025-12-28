import type { CommentType } from './comments';
import type { CommentSegment } from './mentions';

/**
 * Operation Types for Comment Queue
 *
 * These operations are enqueued and processed sequentially to ensure
 * consistency when multiple operations occur rapidly. Each operation
 * is idempotent and can be safely retried on failure.
 */

/** Adds a new top-level comment. */
export type AddCommentOp = {
  type: 'ADD_COMMENT';
  comment: CommentType;
};

/** Deletes a comment (top-level or reply). */
export type DeleteCommentOp = {
  type: 'DELETE_COMMENT';
  /** The ID of the comment to delete. */
  id: string;
  /** If deleting a reply, the ID of the parent comment. */
  parentCommentId?: string;
};

/** Edits the content of an existing comment. */
export type EditCommentOp = {
  type: 'EDIT_COMMENT';
  /** The ID of the comment to edit. */
  id: string;
  /** The new content segments. */
  newContent: CommentSegment[];
  /** If editing a reply, the ID of the parent comment. */
  parentCommentId?: string;
};

/** Adds or removes an upvote from a comment. */
export type UpvoteCommentOp = {
  type: 'UPVOTE_COMMENT';
  /** The ID of the comment to upvote/un-upvote. */
  id: string;
  /** Explicit action for idempotency - not a toggle. */
  action: 'add' | 'remove';
  /** The user performing the upvote action. */
  user: { name: string; email: string };
  /** If upvoting a reply, the ID of the parent comment. */
  parentCommentId?: string;
};

/** Adds a reply to an existing comment. */
export type AddReplyOp = {
  type: 'ADD_REPLY';
  /** The ID of the parent comment to reply to. */
  parentCommentId: string;
  /** The reply comment to add. */
  reply: CommentType;
};

/** Union of all comment operation types. */
export type CommentOperation =
  | AddCommentOp
  | DeleteCommentOp
  | EditCommentOp
  | UpvoteCommentOp
  | AddReplyOp;

/**
 * Result status for operation application.
 *
 * Used to communicate whether an operation succeeded, was a no-op due to
 * idempotency (already applied), or failed due to missing targets.
 */
export type OperationResultStatus =
  | 'applied'
  | 'no_op_idempotent'
  | 'failed_parent_missing'
  | 'failed_target_missing';

/**
 * Result of applying an operation to a comments array.
 *
 * This result type enables callers to detect and respond to failures,
 * particularly for parent-child operations where the parent was deleted
 * by another user. Without this, such failures are silent and can cause
 * user content loss.
 *
 * @see operationApplicators.ts for detailed documentation on failure scenarios.
 */
export type OperationResult = {
  /** The resulting comments array after applying the operation. */
  comments: CommentType[];
  /** The outcome status of the operation. */
  status: OperationResultStatus;
  /** Human-readable explanation when status is a failure. */
  failureReason?: string;
};

