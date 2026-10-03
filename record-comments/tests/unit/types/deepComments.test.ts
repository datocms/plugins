import type { CommentType } from '@ctypes/comments';
import { parseComments } from '@ctypes/comments';
import { isValidCommentArray } from '@utils/typeGuards';
import { describe, expect, it } from 'vitest';
import { createBaseComment } from '../fixtures/comments';

describe('large and deeply nested stored comments', () => {
  it('validates and normalizes 12,000 nested replies without stack overflow', () => {
    let original = createBaseComment({ id: 'leaf' });
    for (let index = 0; index < 12_000; index++) {
      original = createBaseComment({
        id: `comment-${index}`,
        replies: [original],
      });
    }
    expect(isValidCommentArray([original])).toBe(true);
    const parsed = parseComments([original]);
    let comment: CommentType | undefined = parsed[0];
    let depth = 0;
    while (comment?.replies?.length) {
      comment = comment.replies[0];
      depth++;
    }
    expect(depth).toBe(12_000);
    expect(comment?.id).toBe('leaf');
  }, 60_000);

  it('rejects duplicate IDs across separate nested branches', () => {
    const duplicate = createBaseComment({ id: 'same-id' });
    const branches = [
      createBaseComment({ id: 'left', replies: [duplicate] }),
      createBaseComment({ id: 'right', replies: [{ ...duplicate }] }),
    ];
    expect(isValidCommentArray(branches)).toBe(false);
    expect(parseComments(branches)).toEqual([]);
  });

  it('normalizes a broad synthetic aggregate and keeps unknown metadata', () => {
    const comments = Array.from({ length: 5_000 }, (_, index) => ({
      ...createBaseComment({ id: `comment-${index}` }),
      metadata: { preserved: true },
    }));
    const parsed = parseComments(JSON.stringify(comments));
    expect(parsed).toHaveLength(5_000);
    expect(parsed[4_999]).toMatchObject({
      id: 'comment-4999',
      metadata: { preserved: true },
    });
  });
});
