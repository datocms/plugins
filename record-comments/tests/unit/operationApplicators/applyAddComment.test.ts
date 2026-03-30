import { describe, it, expect, beforeEach } from 'vitest';
import { applyOperation } from '@utils/operationApplicators';
import {
  createBaseComment,
  createCommentList,
  resetIdCounter,
  createTextSegment,
} from '../fixtures/comments';
import { createAddCommentOp } from '../fixtures/operations';

describe('applyAddComment', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('when adding to empty comments array', () => {
    it('returns array with the new comment', () => {
      const newComment = createBaseComment({ id: 'new-1' });
      const op = createAddCommentOp(newComment);

      const result = applyOperation([], op);

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0]).toEqual(newComment);
    });

    it('returns status "applied"', () => {
      const newComment = createBaseComment({ id: 'new-1' });
      const op = createAddCommentOp(newComment);

      const result = applyOperation([], op);

      expect(result.status).toBe('applied');
    });
  });

  describe('when adding to existing comments', () => {
    it('prepends new comment to start of array', () => {
      const existingComments = createCommentList(3);
      const newComment = createBaseComment({
        id: 'new-first',
        content: [createTextSegment('I should be first')],
      });
      const op = createAddCommentOp(newComment);

      const result = applyOperation(existingComments, op);

      expect(result.comments).toHaveLength(4);
      expect(result.comments[0].id).toBe('new-first');
      expect(result.comments[0].content).toEqual([createTextSegment('I should be first')]);
    });

    it('preserves existing comments in their relative order', () => {
      const existingComments = createCommentList(3);
      const existingIds = existingComments.map((c) => c.id);
      const newComment = createBaseComment({ id: 'new-1' });
      const op = createAddCommentOp(newComment);

      const result = applyOperation(existingComments, op);

      const resultIds = result.comments.slice(1).map((c) => c.id);
      expect(resultIds).toEqual(existingIds);
    });

    it('returns status "applied"', () => {
      const existingComments = createCommentList(2);
      const newComment = createBaseComment({ id: 'new-1' });
      const op = createAddCommentOp(newComment);

      const result = applyOperation(existingComments, op);

      expect(result.status).toBe('applied');
    });
  });

  describe('idempotency (comment already exists)', () => {
    it('returns original comments unchanged when comment ID exists', () => {
      const existingComment = createBaseComment({ id: 'existing-1' });
      const duplicateComment = createBaseComment({
        id: 'existing-1',
        content: [createTextSegment('Different content')],
      });
      const op = createAddCommentOp(duplicateComment);

      const result = applyOperation([existingComment], op);

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0]).toEqual(existingComment);
    });

    it('returns status "no_op_idempotent" when comment already exists', () => {
      const existingComment = createBaseComment({ id: 'existing-1' });
      const duplicateComment = createBaseComment({ id: 'existing-1' });
      const op = createAddCommentOp(duplicateComment);

      const result = applyOperation([existingComment], op);

      expect(result.status).toBe('no_op_idempotent');
    });

    it('does not modify existing comment content', () => {
      const originalContent = [createTextSegment('Original')];
      const existingComment = createBaseComment({
        id: 'existing-1',
        content: originalContent,
      });
      const duplicateComment = createBaseComment({
        id: 'existing-1',
        content: [createTextSegment('Modified')],
      });
      const op = createAddCommentOp(duplicateComment);

      const result = applyOperation([existingComment], op);

      expect(result.comments[0].content).toEqual(originalContent);
    });
  });

  describe('comment data integrity', () => {
    it('preserves all comment properties', () => {
      const newComment = createBaseComment({
        id: 'full-comment',
        dateISO: '2024-01-15T10:30:00.000Z',
        content: [createTextSegment('Full content')],
        author: { name: 'Author Name', email: 'author@test.com' },
        usersWhoUpvoted: [{ name: 'Voter', email: 'voter@test.com' }],
        replies: [],
      });
      const op = createAddCommentOp(newComment);

      const result = applyOperation([], op);

      expect(result.comments[0]).toEqual(newComment);
    });

    it('preserves nested replies in new comment', () => {
      const reply = createBaseComment({
        id: 'reply-1',
        parentCommentId: 'parent-1',
      });
      const newComment = createBaseComment({
        id: 'parent-1',
        replies: [reply],
      });
      const op = createAddCommentOp(newComment);

      const result = applyOperation([], op);

      expect(result.comments[0].replies).toHaveLength(1);
      expect(result.comments[0].replies?.[0].id).toBe('reply-1');
    });
  });
});
