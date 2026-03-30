import { describe, it, expect, beforeEach } from 'vitest';
import { applyOperation } from '@utils/operationApplicators';
import {
  createBaseComment,
  createCommentWithReplies,
  resetIdCounter,
} from '../fixtures/comments';
import { createDeleteCommentOp } from '../fixtures/operations';

describe('applyDeleteComment', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('deleting top-level comment', () => {
    it('removes comment from array', () => {
      const comment = createBaseComment({ id: 'to-delete' });
      const op = createDeleteCommentOp('to-delete');

      const result = applyOperation([comment], op);

      expect(result.comments).toHaveLength(0);
    });

    it('returns status "applied"', () => {
      const comment = createBaseComment({ id: 'to-delete' });
      const op = createDeleteCommentOp('to-delete');

      const result = applyOperation([comment], op);

      expect(result.status).toBe('applied');
    });

    it('preserves other comments', () => {
      const commentToDelete = createBaseComment({ id: 'to-delete' });
      const otherComment = createBaseComment({ id: 'other' });
      const op = createDeleteCommentOp('to-delete');

      const result = applyOperation([commentToDelete, otherComment], op);

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].id).toBe('other');
    });

    it('removes only the first matching comment when duplicates exist', () => {
      const comment1 = createBaseComment({ id: 'to-delete' });
      const comment2 = createBaseComment({ id: 'keep' });
      const op = createDeleteCommentOp('to-delete');

      const result = applyOperation([comment1, comment2], op);

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].id).toBe('keep');
    });
  });

  describe('deleting reply', () => {
    it('removes reply from parent replies array', () => {
      const parent = createCommentWithReplies(2, { id: 'parent' });
      const replyId = parent.replies![0].id;
      const op = createDeleteCommentOp(replyId, 'parent');

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies).toHaveLength(1);
      expect(result.comments[0].replies![0].id).not.toBe(replyId);
    });

    it('returns status "applied"', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const replyId = parent.replies![0].id;
      const op = createDeleteCommentOp(replyId, 'parent');

      const result = applyOperation([parent], op);

      expect(result.status).toBe('applied');
    });

    it('preserves parent comment', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const replyId = parent.replies![0].id;
      const op = createDeleteCommentOp(replyId, 'parent');

      const result = applyOperation([parent], op);

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].id).toBe('parent');
    });

    it('preserves other replies', () => {
      const parent = createCommentWithReplies(3, { id: 'parent' });
      const replyToDelete = parent.replies![1].id;
      const op = createDeleteCommentOp(replyToDelete, 'parent');

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies).toHaveLength(2);
    });
  });

  describe('idempotency (comment already deleted)', () => {
    it('returns original comments when top-level comment not found', () => {
      const existingComment = createBaseComment({ id: 'existing' });
      const op = createDeleteCommentOp('nonexistent');

      const result = applyOperation([existingComment], op);

      expect(result.comments).toEqual([existingComment]);
    });

    it('returns status "no_op_idempotent" when comment not found', () => {
      const existingComment = createBaseComment({ id: 'existing' });
      const op = createDeleteCommentOp('nonexistent');

      const result = applyOperation([existingComment], op);

      expect(result.status).toBe('no_op_idempotent');
    });

    it('returns original comments when reply not found', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const op = createDeleteCommentOp('nonexistent-reply', 'parent');

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies).toHaveLength(1);
      expect(result.status).toBe('no_op_idempotent');
    });
  });

  describe('parent missing', () => {
    it('returns status "failed_parent_missing" when parent not found', () => {
      const comment = createBaseComment({ id: 'some-comment' });
      const op = createDeleteCommentOp('some-reply', 'nonexistent-parent');

      const result = applyOperation([comment], op);

      expect(result.status).toBe('failed_parent_missing');
    });

    it('returns original comments unchanged', () => {
      const comment = createBaseComment({ id: 'some-comment' });
      const op = createDeleteCommentOp('some-reply', 'nonexistent-parent');

      const result = applyOperation([comment], op);

      expect(result.comments).toEqual([comment]);
    });

    it('includes failure reason', () => {
      const comment = createBaseComment({ id: 'some-comment' });
      const op = createDeleteCommentOp('some-reply', 'nonexistent-parent');

      const result = applyOperation([comment], op);

      expect(result.failureReason).toBeDefined();
      expect(result.failureReason).toContain('deleted');
    });
  });

  describe('empty comments array', () => {
    it('returns empty array', () => {
      const op = createDeleteCommentOp('any-id');

      const result = applyOperation([], op);

      expect(result.comments).toEqual([]);
    });

    it('returns status "no_op_idempotent"', () => {
      const op = createDeleteCommentOp('any-id');

      const result = applyOperation([], op);

      expect(result.status).toBe('no_op_idempotent');
    });
  });
});
