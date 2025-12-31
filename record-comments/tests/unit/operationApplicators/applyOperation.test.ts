import { describe, it, expect, beforeEach } from 'vitest';
import { applyOperation } from '@utils/operationApplicators';
import {
  createBaseComment,
  createCommentWithReplies,
  createTextSegment,
  resetIdCounter,
} from '../fixtures/comments';
import {
  createAddCommentOp,
  createDeleteCommentOp,
  createEditCommentOp,
  createUpvoteCommentOp,
  createAddReplyOp,
} from '../fixtures/operations';

describe('applyOperation (dispatcher)', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('dispatches to correct handler based on operation type', () => {
    it('handles ADD_COMMENT operations', () => {
      const newComment = createBaseComment({ id: 'new' });
      const op = createAddCommentOp(newComment);

      const result = applyOperation([], op);

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].id).toBe('new');
    });

    it('handles DELETE_COMMENT operations', () => {
      const comment = createBaseComment({ id: 'to-delete' });
      const op = createDeleteCommentOp('to-delete');

      const result = applyOperation([comment], op);

      expect(result.comments).toHaveLength(0);
    });

    it('handles EDIT_COMMENT operations', () => {
      const comment = createBaseComment({
        id: 'to-edit',
        content: [createTextSegment('Original')],
      });
      const op = createEditCommentOp('to-edit', [createTextSegment('Updated')]);

      const result = applyOperation([comment], op);

      expect(result.comments[0].content).toEqual([createTextSegment('Updated')]);
    });

    it('handles UPVOTE_COMMENT operations', () => {
      const comment = createBaseComment({ id: 'to-upvote' });
      const op = createUpvoteCommentOp('to-upvote', 'add', {
        name: 'Voter',
        email: 'voter@test.com',
      });

      const result = applyOperation([comment], op);

      expect(result.comments[0].usersWhoUpvoted).toHaveLength(1);
    });

    it('handles ADD_REPLY operations', () => {
      const parent = createBaseComment({ id: 'parent' });
      const reply = createBaseComment({
        id: 'reply',
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', reply);

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies).toHaveLength(1);
    });
  });

  describe('operation chaining', () => {
    it('supports sequential operations', () => {
      // Start with empty
      let comments: typeof result.comments = [];

      // Add a comment
      const addOp = createAddCommentOp(createBaseComment({ id: 'comment-1' }));
      let result = applyOperation(comments, addOp);
      comments = result.comments;
      expect(comments).toHaveLength(1);

      // Add upvote
      const upvoteOp = createUpvoteCommentOp('comment-1', 'add', {
        name: 'Voter',
        email: 'voter@test.com',
      });
      result = applyOperation(comments, upvoteOp);
      comments = result.comments;
      expect(comments[0].usersWhoUpvoted).toHaveLength(1);

      // Edit content
      const editOp = createEditCommentOp('comment-1', [createTextSegment('Edited')]);
      result = applyOperation(comments, editOp);
      comments = result.comments;
      expect(comments[0].content).toEqual([createTextSegment('Edited')]);

      // Add reply
      const reply = createBaseComment({
        id: 'reply-1',
        parentCommentId: 'comment-1',
      });
      const replyOp = createAddReplyOp('comment-1', reply);
      result = applyOperation(comments, replyOp);
      comments = result.comments;
      expect(comments[0].replies).toHaveLength(1);

      // Delete reply
      const deleteReplyOp = createDeleteCommentOp('reply-1', 'comment-1');
      result = applyOperation(comments, deleteReplyOp);
      comments = result.comments;
      expect(comments[0].replies).toHaveLength(0);

      // Delete comment
      const deleteOp = createDeleteCommentOp('comment-1');
      result = applyOperation(comments, deleteOp);
      expect(result.comments).toHaveLength(0);
    });
  });

  describe('immutability', () => {
    it('does not mutate original comments array', () => {
      const original = createBaseComment({ id: 'original' });
      const originalComments = [original];
      const op = createAddCommentOp(createBaseComment({ id: 'new' }));

      applyOperation(originalComments, op);

      expect(originalComments).toHaveLength(1);
      expect(originalComments[0].id).toBe('original');
    });

    it('does not mutate original comment objects', () => {
      const original = createBaseComment({
        id: 'to-edit',
        content: [createTextSegment('Original')],
      });
      const originalContent = original.content;
      const op = createEditCommentOp('to-edit', [createTextSegment('New')]);

      const result = applyOperation([original], op);

      expect(original.content).toEqual(originalContent);
      expect(result.comments[0].content).toEqual([createTextSegment('New')]);
    });

    it('does not mutate original replies array', () => {
      const parent = createCommentWithReplies(2, { id: 'parent' });
      const originalRepliesLength = parent.replies!.length;
      const newReply = createBaseComment({
        id: 'new-reply',
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', newReply);

      const result = applyOperation([parent], op);

      expect(parent.replies).toHaveLength(originalRepliesLength);
      expect(result.comments[0].replies).toHaveLength(originalRepliesLength + 1);
    });
  });

  describe('result status types', () => {
    it('returns "applied" for successful operations', () => {
      const comment = createBaseComment({ id: 'test' });
      const op = createAddCommentOp(comment);

      const result = applyOperation([], op);

      expect(result.status).toBe('applied');
    });

    it('returns "no_op_idempotent" for idempotent no-ops', () => {
      const comment = createBaseComment({ id: 'existing' });
      const op = createAddCommentOp(comment);

      const result = applyOperation([comment], op);

      expect(result.status).toBe('no_op_idempotent');
    });

    it('returns "failed_parent_missing" when parent not found', () => {
      const reply = createBaseComment({
        id: 'orphan',
        parentCommentId: 'nonexistent',
      });
      const op = createAddReplyOp('nonexistent', reply);

      const result = applyOperation([], op);

      expect(result.status).toBe('failed_parent_missing');
    });

    it('returns "failed_target_missing" when target not found', () => {
      const op = createEditCommentOp('nonexistent', [createTextSegment('New')]);

      const result = applyOperation([], op);

      expect(result.status).toBe('failed_target_missing');
    });
  });

  describe('failure reasons', () => {
    it('includes failureReason for failed_parent_missing', () => {
      const reply = createBaseComment({
        id: 'orphan',
        parentCommentId: 'nonexistent',
      });
      const op = createAddReplyOp('nonexistent', reply);

      const result = applyOperation([], op);

      expect(result.failureReason).toBeDefined();
      expect(typeof result.failureReason).toBe('string');
    });

    it('includes failureReason for failed_target_missing', () => {
      const op = createEditCommentOp('nonexistent', [createTextSegment('New')]);

      const result = applyOperation([], op);

      expect(result.failureReason).toBeDefined();
      expect(typeof result.failureReason).toBe('string');
    });

    it('does not include failureReason for applied operations', () => {
      const comment = createBaseComment({ id: 'test' });
      const op = createAddCommentOp(comment);

      const result = applyOperation([], op);

      expect(result.failureReason).toBeUndefined();
    });

    it('does not include failureReason for no_op_idempotent', () => {
      const comment = createBaseComment({ id: 'existing' });
      const op = createDeleteCommentOp('nonexistent');

      const result = applyOperation([comment], op);

      expect(result.failureReason).toBeUndefined();
    });
  });
});
