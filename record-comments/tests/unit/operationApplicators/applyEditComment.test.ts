import { describe, it, expect, beforeEach } from 'vitest';
import { applyOperation } from '@utils/operationApplicators';
import {
  createBaseComment,
  createCommentWithReplies,
  createTextSegment,
  resetIdCounter,
} from '../fixtures/comments';
import { createEditCommentOp } from '../fixtures/operations';
import { createMentionSegment, mentionFixtures } from '../fixtures/mentions';

describe('applyEditComment', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('editing top-level comment', () => {
    it('updates comment content', () => {
      const comment = createBaseComment({
        id: 'to-edit',
        content: [createTextSegment('Original')],
      });
      const newContent = [createTextSegment('Updated')];
      const op = createEditCommentOp('to-edit', newContent);

      const result = applyOperation([comment], op);

      expect(result.comments[0].content).toEqual(newContent);
    });

    it('returns status "applied"', () => {
      const comment = createBaseComment({ id: 'to-edit' });
      const op = createEditCommentOp('to-edit', [createTextSegment('New')]);

      const result = applyOperation([comment], op);

      expect(result.status).toBe('applied');
    });

    it('preserves other comment properties', () => {
      const upvoters = [{ name: 'Voter', email: 'voter@test.com' }];
      const comment = createBaseComment({
        id: 'to-edit',
        author: { name: 'Author', email: 'author@test.com' },
        usersWhoUpvoted: upvoters,
        dateISO: '2024-01-15T10:00:00.000Z',
      });
      const op = createEditCommentOp('to-edit', [createTextSegment('New')]);

      const result = applyOperation([comment], op);

      expect(result.comments[0].author).toEqual(comment.author);
      expect(result.comments[0].usersWhoUpvoted).toEqual(upvoters);
      expect(result.comments[0].dateISO).toBe(comment.dateISO);
      expect(result.comments[0].id).toBe(comment.id);
    });

    it('preserves other comments in array', () => {
      const commentToEdit = createBaseComment({ id: 'to-edit' });
      const otherComment = createBaseComment({ id: 'other' });
      const op = createEditCommentOp('to-edit', [createTextSegment('New')]);

      const result = applyOperation([commentToEdit, otherComment], op);

      expect(result.comments).toHaveLength(2);
      expect(result.comments[1]).toEqual(otherComment);
    });
  });

  describe('editing reply', () => {
    it('updates reply content', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const replyId = parent.replies![0].id;
      const newContent = [createTextSegment('Updated reply')];
      const op = createEditCommentOp(replyId, newContent, 'parent');

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies![0].content).toEqual(newContent);
    });

    it('returns status "applied"', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const replyId = parent.replies![0].id;
      const op = createEditCommentOp(replyId, [createTextSegment('New')], 'parent');

      const result = applyOperation([parent], op);

      expect(result.status).toBe('applied');
    });

    it('preserves parent content', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const originalParentContent = parent.content;
      const replyId = parent.replies![0].id;
      const op = createEditCommentOp(replyId, [createTextSegment('New')], 'parent');

      const result = applyOperation([parent], op);

      expect(result.comments[0].content).toEqual(originalParentContent);
    });

    it('preserves other replies', () => {
      const parent = createCommentWithReplies(3, { id: 'parent' });
      const replyToEdit = parent.replies![1].id;
      const otherReplyContents = [parent.replies![0].content, parent.replies![2].content];
      const op = createEditCommentOp(replyToEdit, [createTextSegment('New')], 'parent');

      const result = applyOperation([parent], op);

      expect(result.comments[0].replies![0].content).toEqual(otherReplyContents[0]);
      expect(result.comments[0].replies![2].content).toEqual(otherReplyContents[1]);
    });
  });

  describe('target missing', () => {
    it('returns status "failed_target_missing" when top-level comment not found', () => {
      const comment = createBaseComment({ id: 'existing' });
      const op = createEditCommentOp('nonexistent', [createTextSegment('New')]);

      const result = applyOperation([comment], op);

      expect(result.status).toBe('failed_target_missing');
    });

    it('returns original comments unchanged', () => {
      const comment = createBaseComment({ id: 'existing' });
      const op = createEditCommentOp('nonexistent', [createTextSegment('New')]);

      const result = applyOperation([comment], op);

      expect(result.comments).toEqual([comment]);
    });

    it('returns status "failed_target_missing" when reply not found', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const op = createEditCommentOp('nonexistent-reply', [createTextSegment('New')], 'parent');

      const result = applyOperation([parent], op);

      expect(result.status).toBe('failed_target_missing');
    });

    it('includes appropriate failure reason for top-level comment', () => {
      const comment = createBaseComment({ id: 'existing' });
      const op = createEditCommentOp('nonexistent', [createTextSegment('New')]);

      const result = applyOperation([comment], op);

      expect(result.failureReason).toBeDefined();
      expect(result.failureReason).toContain('comment');
      expect(result.failureReason).toContain('deleted');
    });

    it('includes appropriate failure reason for reply', () => {
      const parent = createCommentWithReplies(1, { id: 'parent' });
      const op = createEditCommentOp('nonexistent-reply', [createTextSegment('New')], 'parent');

      const result = applyOperation([parent], op);

      expect(result.failureReason).toBeDefined();
      expect(result.failureReason).toContain('reply');
    });
  });

  describe('parent missing', () => {
    it('returns status "failed_parent_missing" when parent not found', () => {
      const comment = createBaseComment({ id: 'some-comment' });
      const op = createEditCommentOp('some-reply', [createTextSegment('New')], 'nonexistent-parent');

      const result = applyOperation([comment], op);

      expect(result.status).toBe('failed_parent_missing');
    });

    it('includes failure reason about thread deletion', () => {
      const comment = createBaseComment({ id: 'some-comment' });
      const op = createEditCommentOp('some-reply', [createTextSegment('New')], 'nonexistent-parent');

      const result = applyOperation([comment], op);

      expect(result.failureReason).toBeDefined();
      expect(result.failureReason).toContain('thread');
    });
  });

  describe('content with mentions', () => {
    it('updates content to include mentions', () => {
      const comment = createBaseComment({
        id: 'to-edit',
        content: [createTextSegment('Original')],
      });
      const newContent = [
        createTextSegment('Hey '),
        createMentionSegment(mentionFixtures.userJohn),
        createTextSegment('!'),
      ];
      const op = createEditCommentOp('to-edit', newContent);

      const result = applyOperation([comment], op);

      expect(result.comments[0].content).toEqual(newContent);
      expect(result.comments[0].content).toHaveLength(3);
    });

    it('updates content to remove mentions', () => {
      const comment = createBaseComment({
        id: 'to-edit',
        content: [
          createTextSegment('Hey '),
          createMentionSegment(mentionFixtures.userJohn),
        ],
      });
      const newContent = [createTextSegment('Plain text only')];
      const op = createEditCommentOp('to-edit', newContent);

      const result = applyOperation([comment], op);

      expect(result.comments[0].content).toEqual(newContent);
    });
  });

  describe('empty comments array', () => {
    it('returns status "failed_target_missing"', () => {
      const op = createEditCommentOp('any-id', [createTextSegment('New')]);

      const result = applyOperation([], op);

      expect(result.status).toBe('failed_target_missing');
    });
  });
});
