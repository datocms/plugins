import { parseComments } from '@ctypes/comments';
import { isValidCommentArray } from '@utils/typeGuards';
import { describe, expect, it } from 'vitest';
import { createBaseComment } from '../fixtures/comments';

describe('nested stored comments', () => {
  it('rejects duplicate IDs across separate nested branches', () => {
    const duplicate = createBaseComment({ id: 'same-id' });
    const branches = [
      createBaseComment({ id: 'left', replies: [duplicate] }),
      createBaseComment({ id: 'right', replies: [{ ...duplicate }] }),
    ];
    expect(isValidCommentArray(branches)).toBe(false);
    expect(parseComments(branches)).toEqual([]);
  });
});
