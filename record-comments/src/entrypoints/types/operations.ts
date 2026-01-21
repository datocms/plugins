import type { CommentType } from './comments';
import type { StoredCommentSegment } from './mentions';

// Operations are enqueued and processed sequentially. Each is idempotent.

export type AddCommentOp = {
  type: 'ADD_COMMENT';
  comment: CommentType;
};

export type DeleteCommentOp = {
  type: 'DELETE_COMMENT';
  id: string;
  parentCommentId?: string;
};

export type EditCommentOp = {
  type: 'EDIT_COMMENT';
  id: string;
  newContent: StoredCommentSegment[];
  parentCommentId?: string;
};

export type UpvoteCommentOp = {
  type: 'UPVOTE_COMMENT';
  id: string;
  action: 'add' | 'remove'; // Explicit for idempotency
  userId: string;
  parentCommentId?: string;
};

export type AddReplyOp = {
  type: 'ADD_REPLY';
  parentCommentId: string;
  reply: CommentType;
};

export type CommentOperation =
  | AddCommentOp
  | DeleteCommentOp
  | EditCommentOp
  | UpvoteCommentOp
  | AddReplyOp;

export type OperationResultStatus =
  | 'applied'
  | 'no_op_idempotent'
  | 'failed_parent_missing'
  | 'failed_target_missing';

export type OperationResult = {
  comments: CommentType[];
  status: OperationResultStatus;
  failureReason?: string;
};
