import type { CommentType } from '../CommentsBar';
import type { CommentSegment } from './mentions';

export type AddCommentOp = {
  type: 'ADD_COMMENT';
  comment: CommentType;
};

export type DeleteCommentOp = {
  type: 'DELETE_COMMENT';
  dateISO: string;
  parentCommentISO?: string;
};

export type EditCommentOp = {
  type: 'EDIT_COMMENT';
  dateISO: string;
  newContent: CommentSegment[];
  parentCommentISO?: string;
};

export type UpvoteCommentOp = {
  type: 'UPVOTE_COMMENT';
  dateISO: string;
  action: 'add' | 'remove'; // Explicit, not toggle - for idempotency
  user: { name: string; email: string };
  parentCommentISO?: string;
};

export type AddReplyOp = {
  type: 'ADD_REPLY';
  parentCommentISO: string;
  reply: CommentType;
};

export type CommentOperation =
  | AddCommentOp
  | DeleteCommentOp
  | EditCommentOp
  | UpvoteCommentOp
  | AddReplyOp;




