import { describe, it, expect, beforeEach } from 'vitest';
import { applyOperation } from '@utils/operationApplicators';
import {
  createBaseComment,
  createCommentWithReplies,
  createTextSegment,
  resetIdCounter,
} from '../fixtures/comments';
import { createAddReplyOp } from '../fixtures/operations';

describe('applyAddReply', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('adding reply to comment without existing replies', () => {
    it('creates replies array with new reply', () => {
      const parent = createBaseComment({ id: 'parent' });
      const reply = createBaseComment({
        id: 'new-reply',
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', reply);

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies).toHaveLength(1);
      expect(result.comments[0].replies![0]).toEqual(reply);
    });

    it('returns status "applied"', () => {
      const parent = createBaseComment({ id: 'parent' });
      const reply = createBaseComment({
        id: 'new-reply',
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', reply);

      const result = applyOperation([parent], op);

      expect(result.status).toBe('applied');
    });
  });

  describe('adding reply to comment with existing replies', () => {
    it('prepends new reply to start of replies array', () => {
      const parent = createCommentWithReplies(2, { id: 'parent' });
      const existingReplyIds = parent.replies!.map((r) => r.id);
      const newReply = createBaseComment({
        id: 'newest-reply',
        content: [createTextSegment('I should be first')],
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', newReply);

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies).toHaveLength(3);
      expect(result.comments[0].replies![0].id).toBe('newest-reply');
      // Existing replies should follow
      expect(result.comments[0].replies![1].id).toBe(existingReplyIds[0]);
      expect(result.comments[0].replies![2].id).toBe(existingReplyIds[1]);
    });

    it('preserves existing replies', () => {
      const parent = createCommentWithReplies(2, { id: 'parent' });
      const existingReplies = [...parent.replies!];
      const newReply = createBaseComment({
        id: 'new-reply',
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', newReply);

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies!.slice(1)).toEqual(existingReplies);
    });
  });

  describe('idempotency (reply already exists)', () => {
    it('returns original comments when reply ID exists in parent', () => {
      const existingReply = createBaseComment({
        id: 'existing-reply',
        parentCommentId: 'parent',
      });
      const parent = createBaseComment({
        id: 'parent',
        replies: [existingReply],
      });
      const duplicateReply = createBaseComment({
        id: 'existing-reply',
        content: [createTextSegment('Different content')],
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', duplicateReply);

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies).toHaveLength(1);
      expect(result.comments[0].replies![0]).toEqual(existingReply);
    });

    it('returns status "no_op_idempotent" when reply already exists', () => {
      const existingReply = createBaseComment({
        id: 'existing-reply',
        parentCommentId: 'parent',
      });
      const parent = createBaseComment({
        id: 'parent',
        replies: [existingReply],
      });
      const op = createAddReplyOp('parent', existingReply);

      const result = applyOperation([parent], op);

      expect(result.status).toBe('no_op_idempotent');
    });
  });

  describe('parent missing', () => {
    it('returns status "failed_parent_missing" when parent not found', () => {
      const comment = createBaseComment({ id: 'some-comment' });
      const reply = createBaseComment({
        id: 'orphan-reply',
        parentCommentId: 'nonexistent-parent',
      });
      const op = createAddReplyOp('nonexistent-parent', reply);

      const result = applyOperation([comment], op);

      expect(result.status).toBe('failed_parent_missing');
    });

    it('returns original comments unchanged', () => {
      const comment = createBaseComment({ id: 'some-comment' });
      const reply = createBaseComment({
        id: 'orphan-reply',
        parentCommentId: 'nonexistent-parent',
      });
      const op = createAddReplyOp('nonexistent-parent', reply);

      const result = applyOperation([comment], op);

      expect(result.comments).toEqual([comment]);
    });

    it('includes failure reason about deleted comment', () => {
      const comment = createBaseComment({ id: 'some-comment' });
      const reply = createBaseComment({
        id: 'orphan-reply',
        parentCommentId: 'nonexistent-parent',
      });
      const op = createAddReplyOp('nonexistent-parent', reply);

      const result = applyOperation([comment], op);

      expect(result.failureReason).toBeDefined();
      expect(result.failureReason).toContain('deleted');
    });
  });

  describe('preserves parent properties', () => {
    it('preserves parent content', () => {
      const parent = createBaseComment({
        id: 'parent',
        content: [createTextSegment('Parent content')],
      });
      const reply = createBaseComment({
        id: 'reply',
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', reply);

      const result = applyOperation([parent], op);

      expect(result.comments[0].content).toEqual(parent.content);
    });

    it('preserves parent upvoters', () => {
      const upvoters = [{ name: 'Voter', email: 'voter@test.com' }];
      const parent = createBaseComment({
        id: 'parent',
        usersWhoUpvoted: upvoters,
      });
      const reply = createBaseComment({
        id: 'reply',
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', reply);

      const result = applyOperation([parent], op);

      expect(result.comments[0].usersWhoUpvoted).toEqual(upvoters);
    });

    it('preserves parent author', () => {
      const author = { name: 'Author', email: 'author@test.com' };
      const parent = createBaseComment({
        id: 'parent',
        author,
      });
      const reply = createBaseComment({
        id: 'reply',
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', reply);

      const result = applyOperation([parent], op);

      expect(result.comments[0].author).toEqual(author);
    });
  });

  describe('reply data integrity', () => {
    it('preserves all reply properties', () => {
      const parent = createBaseComment({ id: 'parent' });
      const reply = createBaseComment({
        id: 'full-reply',
        dateISO: '2024-01-15T11:00:00.000Z',
        content: [createTextSegment('Reply content')],
        author: { name: 'Reply Author', email: 'reply@test.com' },
        usersWhoUpvoted: [{ name: 'Voter', email: 'voter@test.com' }],
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', reply);

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies![0]).toEqual(reply);
    });
  });

  describe('empty comments array', () => {
    it('returns status "failed_parent_missing"', () => {
      const reply = createBaseComment({
        id: 'reply',
        parentCommentId: 'parent',
      });
      const op = createAddReplyOp('parent', reply);

      const result = applyOperation([], op);

      expect(result.status).toBe('failed_parent_missing');
    });
  });

  describe('multiple parents', () => {
    it('adds reply only to matching parent', () => {
      const parent1 = createBaseComment({ id: 'parent-1' });
      const parent2 = createBaseComment({ id: 'parent-2' });
      const reply = createBaseComment({
        id: 'reply',
        parentCommentId: 'parent-2',
      });
      const op = createAddReplyOp('parent-2', reply);

      const result = applyOperation([parent1, parent2], op);

      expect(result.comments[0].replies).toBeUndefined();
      expect(result.comments[1].replies).toHaveLength(1);
      expect(result.comments[1].replies![0]).toEqual(reply);
    });
  });
});
