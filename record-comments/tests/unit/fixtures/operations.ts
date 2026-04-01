import type { CommentType } from '@ctypes/comments';
import type { StoredCommentSegment } from '@ctypes/mentions';
import type {
  AddCommentOp,
  AddReplyOp,
  CommentOperation,
  DeleteCommentOp,
  EditCommentOp,
  UpvoteCommentOp,
} from '@ctypes/operations';
import { createBaseComment, createTextSegment } from './comments';

export function createAddCommentOp(comment: CommentType): AddCommentOp {
  return {
    type: 'ADD_COMMENT',
    comment,
  };
}

export function createDeleteCommentOp(
  id: string,
  parentCommentId?: string,
): DeleteCommentOp {
  return {
    type: 'DELETE_COMMENT',
    id,
    parentCommentId,
  };
}

export function createEditCommentOp(
  id: string,
  newContent: StoredCommentSegment[],
  parentCommentId?: string,
): EditCommentOp {
  return {
    type: 'EDIT_COMMENT',
    id,
    newContent,
    parentCommentId,
  };
}

export function createUpvoteCommentOp(
  id: string,
  action: 'add' | 'remove',
  userId: string,
  parentCommentId?: string,
): UpvoteCommentOp {
  return {
    type: 'UPVOTE_COMMENT',
    id,
    action,
    userId,
    parentCommentId,
  };
}

export function createAddReplyOp(
  parentCommentId: string,
  reply: CommentType,
): AddReplyOp {
  return {
    type: 'ADD_REPLY',
    parentCommentId,
    reply,
  };
}

// Pre-built operation fixtures for common scenarios
export const operationFixtures = {
  // Add comment operations
  addSimpleComment: createAddCommentOp(
    createBaseComment({
      id: 'new-comment-1',
      content: [createTextSegment('This is a new comment')],
    }),
  ),

  // Delete operations
  deleteTopLevel: createDeleteCommentOp('comment-to-delete'),

  deleteReply: createDeleteCommentOp('reply-to-delete', 'parent-comment-id'),

  // Edit operations
  editTopLevel: createEditCommentOp('comment-to-edit', [
    createTextSegment('Updated content'),
  ]),

  editReply: createEditCommentOp(
    'reply-to-edit',
    [createTextSegment('Updated reply content')],
    'parent-comment-id',
  ),

  // Upvote operations
  addUpvote: createUpvoteCommentOp('comment-to-upvote', 'add', 'user-voter-1'),

  removeUpvote: createUpvoteCommentOp(
    'comment-to-upvote',
    'remove',
    'user-voter-1',
  ),

  upvoteReply: createUpvoteCommentOp(
    'reply-to-upvote',
    'add',
    'user-voter-1',
    'parent-comment-id',
  ),

  // Add reply operations
  addReply: createAddReplyOp(
    'parent-comment-id',
    createBaseComment({
      id: 'new-reply-1',
      content: [createTextSegment('This is a reply')],
      parentCommentId: 'parent-comment-id',
    }),
  ),
};

// Helper to create a sequence of operations for testing
export function createOperationSequence(
  operations: CommentOperation[],
): CommentOperation[] {
  return operations;
}

// Common test scenario: add comment, upvote it, then edit it
export const addUpvoteEditSequence: CommentOperation[] = [
  operationFixtures.addSimpleComment,
  createUpvoteCommentOp('new-comment-1', 'add', 'user-upvoter-1'),
  createEditCommentOp('new-comment-1', [createTextSegment('Edited content')]),
];

// Common test scenario: add comment, add reply, delete parent
export const addReplyDeleteParentSequence: CommentOperation[] = [
  createAddCommentOp(
    createBaseComment({
      id: 'parent-for-delete-test',
      content: [createTextSegment('Parent comment')],
    }),
  ),
  createAddReplyOp(
    'parent-for-delete-test',
    createBaseComment({
      id: 'reply-for-delete-test',
      content: [createTextSegment('Reply to parent')],
      parentCommentId: 'parent-for-delete-test',
    }),
  ),
  createDeleteCommentOp('parent-for-delete-test'),
];
