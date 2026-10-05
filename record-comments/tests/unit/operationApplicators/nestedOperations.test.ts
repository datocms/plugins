import type { CommentType } from '@ctypes/comments';
import { applyOperation } from '@utils/operationApplicators';
import { describe, expect, it } from 'vitest';
import { createBaseComment } from '../fixtures/comments';

function nestedThread(depth: number): CommentType[] {
  let comment = createBaseComment({ id: `depth-${depth}` });
  for (let level = depth - 1; level >= 0; level--) {
    comment = createBaseComment({ id: `depth-${level}`, replies: [comment] });
  }
  return [comment, createBaseComment({ id: 'unrelated' })];
}

function atDepth(comments: CommentType[], depth: number): CommentType {
  let comment = comments[0];
  for (let level = 0; level < depth; level++) {
    const child = comment.replies?.[0];
    if (!child) throw new Error('Missing test child');
    comment = child;
  }
  return comment;
}

describe('nested comment operations', () => {
  it('does not create duplicate IDs across nested branches', () => {
    const comments = nestedThread(5);
    const existing = createBaseComment({ id: 'depth-5' });
    expect(
      applyOperation(comments, { type: 'ADD_COMMENT', comment: existing })
        .status,
    ).toBe('no_op_idempotent');
    expect(
      applyOperation(comments, {
        type: 'ADD_REPLY',
        parentCommentId: 'depth-2',
        reply: existing,
      }).status,
    ).toBe('no_op_idempotent');
  });

  it('adds, upvotes and deletes nested replies with idempotent replay', () => {
    const comments = nestedThread(5);
    const reply = createBaseComment({
      id: 'nested-reply',
      parentCommentId: 'depth-4',
    });
    const addition = {
      type: 'ADD_REPLY' as const,
      parentCommentId: 'depth-4',
      reply,
    };
    const added = applyOperation(comments, addition);
    expect(applyOperation(added.comments, addition).status).toBe(
      'no_op_idempotent',
    );
    const vote = {
      type: 'UPVOTE_COMMENT' as const,
      id: reply.id,
      parentCommentId: 'depth-4',
      action: 'add' as const,
      userId: 'voter',
    };
    const voted = applyOperation(added.comments, vote);
    expect(atDepth(voted.comments, 5).upvoterIds).toEqual(['voter']);
    expect(applyOperation(voted.comments, vote).status).toBe(
      'no_op_idempotent',
    );
    const deletion = {
      type: 'DELETE_COMMENT' as const,
      id: reply.id,
      parentCommentId: 'depth-4',
    };
    const deleted = applyOperation(voted.comments, deletion);
    expect(atDepth(deleted.comments, 5).id).toBe('depth-5');
    expect(applyOperation(deleted.comments, deletion).status).toBe(
      'no_op_idempotent',
    );
  });
});
