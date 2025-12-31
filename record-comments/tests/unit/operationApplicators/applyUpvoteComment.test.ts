import { describe, it, expect, beforeEach } from 'vitest';
import { applyOperation } from '@utils/operationApplicators';
import {
  createBaseComment,
  createCommentWithReplies,
  createCommentWithUpvotes,
  createUpvoter,
  resetIdCounter,
} from '../fixtures/comments';
import { createUpvoteCommentOp } from '../fixtures/operations';

describe('applyUpvoteComment', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('adding upvote to top-level comment', () => {
    it('adds user to usersWhoUpvoted array', () => {
      const comment = createBaseComment({ id: 'to-upvote' });
      const user = createUpvoter({ name: 'New Voter', email: 'newvoter@test.com' });
      const op = createUpvoteCommentOp('to-upvote', 'add', user);

      const result = applyOperation([comment], op);

      expect(result.comments[0].usersWhoUpvoted).toHaveLength(1);
      expect(result.comments[0].usersWhoUpvoted[0]).toEqual(user);
    });

    it('returns status "applied"', () => {
      const comment = createBaseComment({ id: 'to-upvote' });
      const user = createUpvoter();
      const op = createUpvoteCommentOp('to-upvote', 'add', user);

      const result = applyOperation([comment], op);

      expect(result.status).toBe('applied');
    });

    it('appends to existing upvoters', () => {
      const existingUpvoter = createUpvoter({ email: 'existing@test.com' });
      const comment = createBaseComment({
        id: 'to-upvote',
        usersWhoUpvoted: [existingUpvoter],
      });
      const newUser = createUpvoter({ email: 'new@test.com' });
      const op = createUpvoteCommentOp('to-upvote', 'add', newUser);

      const result = applyOperation([comment], op);

      expect(result.comments[0].usersWhoUpvoted).toHaveLength(2);
      expect(result.comments[0].usersWhoUpvoted[0]).toEqual(existingUpvoter);
      expect(result.comments[0].usersWhoUpvoted[1]).toEqual(newUser);
    });
  });

  describe('removing upvote from top-level comment', () => {
    it('removes user from usersWhoUpvoted array by email', () => {
      const voterToRemove = createUpvoter({ email: 'remove@test.com' });
      const comment = createCommentWithUpvotes(2, { id: 'to-upvote' });
      comment.usersWhoUpvoted.push(voterToRemove);
      const op = createUpvoteCommentOp('to-upvote', 'remove', voterToRemove);

      const result = applyOperation([comment], op);

      expect(result.comments[0].usersWhoUpvoted).toHaveLength(2);
      expect(
        result.comments[0].usersWhoUpvoted.find((u) => u.email === 'remove@test.com')
      ).toBeUndefined();
    });

    it('returns status "applied"', () => {
      const voter = createUpvoter();
      const comment = createBaseComment({
        id: 'to-upvote',
        usersWhoUpvoted: [voter],
      });
      const op = createUpvoteCommentOp('to-upvote', 'remove', voter);

      const result = applyOperation([comment], op);

      expect(result.status).toBe('applied');
    });

    it('preserves other upvoters', () => {
      const voterToKeep = createUpvoter({ email: 'keep@test.com' });
      const voterToRemove = createUpvoter({ email: 'remove@test.com' });
      const comment = createBaseComment({
        id: 'to-upvote',
        usersWhoUpvoted: [voterToKeep, voterToRemove],
      });
      const op = createUpvoteCommentOp('to-upvote', 'remove', voterToRemove);

      const result = applyOperation([comment], op);

      expect(result.comments[0].usersWhoUpvoted).toHaveLength(1);
      expect(result.comments[0].usersWhoUpvoted[0]).toEqual(voterToKeep);
    });

    it('results in empty array when removing last upvoter', () => {
      const voter = createUpvoter();
      const comment = createBaseComment({
        id: 'to-upvote',
        usersWhoUpvoted: [voter],
      });
      const op = createUpvoteCommentOp('to-upvote', 'remove', voter);

      const result = applyOperation([comment], op);

      expect(result.comments[0].usersWhoUpvoted).toHaveLength(0);
    });
  });

  describe('idempotency for add', () => {
    it('does not duplicate upvote when user already upvoted', () => {
      const voter = createUpvoter({ email: 'already@test.com' });
      const comment = createBaseComment({
        id: 'to-upvote',
        usersWhoUpvoted: [voter],
      });
      const op = createUpvoteCommentOp('to-upvote', 'add', voter);

      const result = applyOperation([comment], op);

      expect(result.comments[0].usersWhoUpvoted).toHaveLength(1);
    });

    it('still returns status "applied" (idempotent success)', () => {
      const voter = createUpvoter();
      const comment = createBaseComment({
        id: 'to-upvote',
        usersWhoUpvoted: [voter],
      });
      const op = createUpvoteCommentOp('to-upvote', 'add', voter);

      const result = applyOperation([comment], op);

      expect(result.status).toBe('applied');
    });
  });

  describe('idempotency for remove', () => {
    it('does nothing when user has not upvoted', () => {
      const comment = createBaseComment({
        id: 'to-upvote',
        usersWhoUpvoted: [],
      });
      const user = createUpvoter();
      const op = createUpvoteCommentOp('to-upvote', 'remove', user);

      const result = applyOperation([comment], op);

      expect(result.comments[0].usersWhoUpvoted).toHaveLength(0);
      expect(result.status).toBe('applied');
    });
  });

  describe('upvoting reply', () => {
    it('adds upvote to reply', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const replyId = parent.replies![0].id;
      const user = createUpvoter();
      const op = createUpvoteCommentOp(replyId, 'add', user, 'parent');

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies![0].usersWhoUpvoted).toHaveLength(1);
      expect(result.comments[0].replies![0].usersWhoUpvoted[0]).toEqual(user);
    });

    it('removes upvote from reply', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const replyId = parent.replies![0].id;
      const user = createUpvoter();
      parent.replies![0].usersWhoUpvoted = [user];
      const op = createUpvoteCommentOp(replyId, 'remove', user, 'parent');

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies![0].usersWhoUpvoted).toHaveLength(0);
    });

    it('returns status "applied"', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const replyId = parent.replies![0].id;
      const user = createUpvoter();
      const op = createUpvoteCommentOp(replyId, 'add', user, 'parent');

      const result = applyOperation([parent], op);

      expect(result.status).toBe('applied');
    });
  });

  describe('target missing', () => {
    it('returns status "failed_target_missing" when comment not found', () => {
      const comment = createBaseComment({ id: 'existing' });
      const user = createUpvoter();
      const op = createUpvoteCommentOp('nonexistent', 'add', user);

      const result = applyOperation([comment], op);

      expect(result.status).toBe('failed_target_missing');
    });

    it('returns status "failed_target_missing" when reply not found', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const user = createUpvoter();
      const op = createUpvoteCommentOp('nonexistent-reply', 'add', user, 'parent');

      const result = applyOperation([parent], op);

      expect(result.status).toBe('failed_target_missing');
    });
  });

  describe('parent missing', () => {
    it('returns status "failed_parent_missing" when parent not found', () => {
      const comment = createBaseComment({ id: 'some-comment' });
      const user = createUpvoter();
      const op = createUpvoteCommentOp('some-reply', 'add', user, 'nonexistent-parent');

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
      const user = createUpvoter();
      const op = createUpvoteCommentOp('to-upvote', 'add', user);

      const result = applyOperation([comment], op);

      expect(result.comments[0].content).toEqual(comment.content);
    });

    it('preserves comment replies when upvoting', () => {
      const parent = createCommentWithReplies(2, { id: 'parent' });
      const user = createUpvoter();
      const op = createUpvoteCommentOp('parent', 'add', user);

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies).toHaveLength(2);
    });
  });
});
