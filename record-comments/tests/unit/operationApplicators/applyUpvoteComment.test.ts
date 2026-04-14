import { applyOperation } from '@utils/operationApplicators';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createBaseComment,
  createCommentWithReplies,
  createCommentWithUpvotes,
  resetIdCounter,
} from '../fixtures/comments';
import { createUpvoteCommentOp } from '../fixtures/operations';

describe('applyUpvoteComment', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('adding upvote to top-level comment', () => {
    it('adds user ID to upvoterIds array', () => {
      const comment = createBaseComment({ id: 'to-upvote' });
      const userId = 'new-voter-123';
      const op = createUpvoteCommentOp('to-upvote', 'add', userId);

      const result = applyOperation([comment], op);

      expect(result.comments[0].upvoterIds).toHaveLength(1);
      expect(result.comments[0].upvoterIds[0]).toBe(userId);
    });

    it('returns status "applied"', () => {
      const comment = createBaseComment({ id: 'to-upvote' });
      const op = createUpvoteCommentOp('to-upvote', 'add', 'voter-user-1');

      const result = applyOperation([comment], op);

      expect(result.status).toBe('applied');
    });

    it('appends to existing upvoters', () => {
      const existingUpvoterId = 'existing-voter-1';
      const comment = createBaseComment({
        id: 'to-upvote',
        upvoterIds: [existingUpvoterId],
      });
      const newUserId = 'new-voter-2';
      const op = createUpvoteCommentOp('to-upvote', 'add', newUserId);

      const result = applyOperation([comment], op);

      expect(result.comments[0].upvoterIds).toHaveLength(2);
      expect(result.comments[0].upvoterIds[0]).toBe(existingUpvoterId);
      expect(result.comments[0].upvoterIds[1]).toBe(newUserId);
    });
  });

  describe('removing upvote from top-level comment', () => {
    it('removes user ID from upvoterIds array', () => {
      const voterIdToRemove = 'voter-to-remove';
      const comment = createCommentWithUpvotes(2, { id: 'to-upvote' });
      comment.upvoterIds.push(voterIdToRemove);
      const op = createUpvoteCommentOp('to-upvote', 'remove', voterIdToRemove);

      const result = applyOperation([comment], op);

      expect(result.comments[0].upvoterIds).toHaveLength(2);
      expect(result.comments[0].upvoterIds).not.toContain(voterIdToRemove);
    });

    it('returns status "applied"', () => {
      const voterId = 'voter-1';
      const comment = createBaseComment({
        id: 'to-upvote',
        upvoterIds: [voterId],
      });
      const op = createUpvoteCommentOp('to-upvote', 'remove', voterId);

      const result = applyOperation([comment], op);

      expect(result.status).toBe('applied');
    });

    it('preserves other upvoters', () => {
      const voterToKeep = 'voter-to-keep';
      const voterToRemove = 'voter-to-remove';
      const comment = createBaseComment({
        id: 'to-upvote',
        upvoterIds: [voterToKeep, voterToRemove],
      });
      const op = createUpvoteCommentOp('to-upvote', 'remove', voterToRemove);

      const result = applyOperation([comment], op);

      expect(result.comments[0].upvoterIds).toHaveLength(1);
      expect(result.comments[0].upvoterIds[0]).toBe(voterToKeep);
    });

    it('results in empty array when removing last upvoter', () => {
      const voterId = 'last-voter';
      const comment = createBaseComment({
        id: 'to-upvote',
        upvoterIds: [voterId],
      });
      const op = createUpvoteCommentOp('to-upvote', 'remove', voterId);

      const result = applyOperation([comment], op);

      expect(result.comments[0].upvoterIds).toHaveLength(0);
    });
  });

  describe('idempotency for add', () => {
    it('does not duplicate upvote when user already upvoted', () => {
      const voterId = 'already-voted';
      const comment = createBaseComment({
        id: 'to-upvote',
        upvoterIds: [voterId],
      });
      const op = createUpvoteCommentOp('to-upvote', 'add', voterId);

      const result = applyOperation([comment], op);

      expect(result.comments[0].upvoterIds).toHaveLength(1);
    });

    it('still returns status "applied" (idempotent success)', () => {
      const voterId = 'voter-1';
      const comment = createBaseComment({
        id: 'to-upvote',
        upvoterIds: [voterId],
      });
      const op = createUpvoteCommentOp('to-upvote', 'add', voterId);

      const result = applyOperation([comment], op);

      expect(result.status).toBe('applied');
    });
  });

  describe('idempotency for remove', () => {
    it('does nothing when user has not upvoted', () => {
      const comment = createBaseComment({
        id: 'to-upvote',
        upvoterIds: [],
      });
      const op = createUpvoteCommentOp(
        'to-upvote',
        'remove',
        'nonexistent-voter',
      );

      const result = applyOperation([comment], op);

      expect(result.comments[0].upvoterIds).toHaveLength(0);
      expect(result.status).toBe('applied');
    });
  });

  describe('upvoting reply', () => {
    it('adds upvote to reply', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const replyId = parent.replies?.[0].id;
      const userId = 'voter-user-1';
      const op = createUpvoteCommentOp(replyId, 'add', userId, 'parent');

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies?.[0].upvoterIds).toHaveLength(1);
      expect(result.comments[0].replies?.[0].upvoterIds[0]).toBe(userId);
    });

    it('removes upvote from reply', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const replyId = parent.replies?.[0].id;
      const userId = 'voter-user-1';
      parent.replies[0].upvoterIds = [userId];
      const op = createUpvoteCommentOp(replyId, 'remove', userId, 'parent');

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies?.[0].upvoterIds).toHaveLength(0);
    });

    it('returns status "applied"', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const replyId = parent.replies?.[0].id;
      const op = createUpvoteCommentOp(
        replyId,
        'add',
        'voter-user-1',
        'parent',
      );

      const result = applyOperation([parent], op);

      expect(result.status).toBe('applied');
    });
  });

  describe('target missing', () => {
    it('returns status "failed_target_missing" when comment not found', () => {
      const comment = createBaseComment({ id: 'existing' });
      const op = createUpvoteCommentOp('nonexistent', 'add', 'voter-1');

      const result = applyOperation([comment], op);

      expect(result.status).toBe('failed_target_missing');
    });

    it('returns status "failed_target_missing" when reply not found', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const op = createUpvoteCommentOp(
        'nonexistent-reply',
        'add',
        'voter-1',
        'parent',
      );

      const result = applyOperation([parent], op);

      expect(result.status).toBe('failed_target_missing');
    });
  });

  describe('parent missing', () => {
    it('returns status "failed_parent_missing" when parent not found', () => {
      const comment = createBaseComment({ id: 'some-comment' });
      const op = createUpvoteCommentOp(
        'some-reply',
        'add',
        'voter-1',
        'nonexistent-parent',
      );

      const result = applyOperation([comment], op);

      expect(result.status).toBe('failed_parent_missing');
    });
  });

  describe('preserves other properties', () => {
    it('preserves comment content when upvoting', () => {
      const comment = createBaseComment({
        id: 'to-upvote',
        content: [{ type: 'text', content: 'Original content' }],
      });
      const op = createUpvoteCommentOp('to-upvote', 'add', 'voter-1');

      const result = applyOperation([comment], op);

      expect(result.comments[0].content).toEqual(comment.content);
    });

    it('preserves comment replies when upvoting', () => {
      const parent = createCommentWithReplies(2, { id: 'parent' });
      const op = createUpvoteCommentOp('parent', 'add', 'voter-1');

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies).toHaveLength(2);
    });
  });
});
