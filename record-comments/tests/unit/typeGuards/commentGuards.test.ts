import { describe, it, expect } from 'vitest';
import {
  isValidComment,
  isValidCommentArray,
  isValidAuthor,
  isValidISOString,
} from '@utils/typeGuards';
import { createBaseComment, createCommentWithReplies } from '../fixtures/comments';
import { createMentionSegment, mentionFixtures } from '../fixtures/mentions';

describe('isValidISOString', () => {
  describe('valid ISO strings', () => {
    it('accepts standard ISO format', () => {
      expect(isValidISOString('2024-01-15T10:30:00.000Z')).toBe(true);
    });

    it('accepts ISO format without milliseconds', () => {
      expect(isValidISOString('2024-01-15T10:30:00Z')).toBe(true);
    });

    it('accepts ISO format with timezone offset', () => {
      expect(isValidISOString('2024-01-15T10:30:00+05:00')).toBe(true);
    });

    it('accepts date only (parses as midnight UTC)', () => {
      expect(isValidISOString('2024-01-15')).toBe(true);
    });
  });

  describe('invalid ISO strings', () => {
    it('rejects empty string', () => {
      expect(isValidISOString('')).toBe(false);
    });

    it('rejects random text', () => {
      expect(isValidISOString('not a date')).toBe(false);
    });

    it('rejects invalid date values', () => {
      expect(isValidISOString('2024-13-45T99:99:99Z')).toBe(false);
    });

    // Note: Date.parse() is lenient - these are actually accepted by the implementation
    it('accepts partial dates (Date.parse is lenient)', () => {
      expect(isValidISOString('2024-01')).toBe(true);
    });

    it('rejects Unix timestamps as pure numbers', () => {
      expect(isValidISOString('1705320600000')).toBe(false);
    });

    it('accepts human-readable formats (Date.parse is lenient)', () => {
      expect(isValidISOString('January 15, 2024')).toBe(true);
    });
  });
});

describe('isValidAuthor', () => {
  describe('valid authors', () => {
    it('accepts author with name and email', () => {
      expect(isValidAuthor({ name: 'John Doe', email: 'john@example.com' })).toBe(true);
    });

    it('accepts empty strings for name and email', () => {
      expect(isValidAuthor({ name: '', email: '' })).toBe(true);
    });
  });

  describe('invalid authors', () => {
    it('rejects null', () => {
      expect(isValidAuthor(null)).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isValidAuthor(undefined)).toBe(false);
    });

    it('rejects empty object', () => {
      expect(isValidAuthor({})).toBe(false);
    });

    it('rejects missing name', () => {
      expect(isValidAuthor({ email: 'john@example.com' })).toBe(false);
    });

    it('rejects missing email', () => {
      expect(isValidAuthor({ name: 'John Doe' })).toBe(false);
    });

    it('rejects non-string name', () => {
      expect(isValidAuthor({ name: 123, email: 'john@example.com' })).toBe(false);
    });

    it('rejects non-string email', () => {
      expect(isValidAuthor({ name: 'John', email: null })).toBe(false);
    });

    it('rejects arrays', () => {
      expect(isValidAuthor(['John', 'john@example.com'])).toBe(false);
    });

    it('rejects primitives', () => {
      expect(isValidAuthor('John Doe')).toBe(false);
      expect(isValidAuthor(42)).toBe(false);
    });
  });
});

describe('isValidComment', () => {
  describe('valid comments', () => {
    it('accepts valid comment with required fields', () => {
      const comment = createBaseComment();
      expect(isValidComment(comment)).toBe(true);
    });

    it('accepts comment with empty content array', () => {
      const comment = createBaseComment({ content: [] });
      expect(isValidComment(comment)).toBe(true);
    });

    it('accepts comment with text segments', () => {
      const comment = createBaseComment({
        content: [{ type: 'text', content: 'Hello world' }],
      });
      expect(isValidComment(comment)).toBe(true);
    });

    it('accepts comment with mention segments', () => {
      const comment = createBaseComment({
        content: [createMentionSegment(mentionFixtures.userJohn)],
      });
      expect(isValidComment(comment)).toBe(true);
    });

    it('accepts comment with replies', () => {
      const comment = createCommentWithReplies(2);
      expect(isValidComment(comment)).toBe(true);
    });

    it('accepts comment with upvoters', () => {
      const comment = createBaseComment({
        usersWhoUpvoted: [
          { name: 'Voter 1', email: 'voter1@test.com' },
          { name: 'Voter 2', email: 'voter2@test.com' },
        ],
      });
      expect(isValidComment(comment)).toBe(true);
    });

    it('accepts comment with parentCommentId', () => {
      const comment = createBaseComment({ parentCommentId: 'parent-123' });
      expect(isValidComment(comment)).toBe(true);
    });
  });

  describe('invalid comments', () => {
    it('rejects null', () => {
      expect(isValidComment(null)).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isValidComment(undefined)).toBe(false);
    });

    it('rejects empty object', () => {
      expect(isValidComment({})).toBe(false);
    });

    it('rejects missing id', () => {
      const comment = createBaseComment();
      const { id: _id, ...withoutId } = comment;
      expect(isValidComment(withoutId)).toBe(false);
    });

    it('rejects non-string id', () => {
      const comment = createBaseComment();
      expect(isValidComment({ ...comment, id: 123 })).toBe(false);
    });

    it('rejects missing dateISO', () => {
      const comment = createBaseComment();
      const { dateISO: _dateISO, ...withoutDateISO } = comment;
      expect(isValidComment(withoutDateISO)).toBe(false);
    });

    it('rejects invalid dateISO', () => {
      const comment = createBaseComment({ dateISO: 'not-a-date' });
      expect(isValidComment(comment)).toBe(false);
    });

    it('rejects invalid author', () => {
      const comment = createBaseComment();
      expect(isValidComment({ ...comment, author: { name: 123 } })).toBe(false);
    });

    it('rejects non-array content', () => {
      const comment = createBaseComment();
      expect(isValidComment({ ...comment, content: 'string content' })).toBe(false);
    });

    it('rejects invalid content segments', () => {
      const comment = createBaseComment({
        content: [{ type: 'invalid' }] as any,
      });
      expect(isValidComment(comment)).toBe(false);
    });

    it('rejects non-array usersWhoUpvoted', () => {
      const comment = createBaseComment();
      expect(isValidComment({ ...comment, usersWhoUpvoted: {} })).toBe(false);
    });

    it('rejects invalid upvoters', () => {
      const comment = createBaseComment({
        usersWhoUpvoted: [{ invalid: true }] as any,
      });
      expect(isValidComment(comment)).toBe(false);
    });

    it('rejects non-string parentCommentId', () => {
      const comment = createBaseComment();
      expect(isValidComment({ ...comment, parentCommentId: 123 })).toBe(false);
    });

    it('rejects non-array replies', () => {
      const comment = createBaseComment();
      expect(isValidComment({ ...comment, replies: 'not array' })).toBe(false);
    });

    it('rejects invalid replies', () => {
      const comment = createBaseComment();
      expect(isValidComment({ ...comment, replies: [{ invalid: true }] })).toBe(false);
    });
  });

  describe('cycle detection', () => {
    it('rejects circular references', () => {
      const comment: any = createBaseComment({ id: 'circular' });
      comment.replies = [comment]; // Create circular reference

      expect(isValidComment(comment)).toBe(false);
    });

    it('accepts deeply nested non-circular structures', () => {
      const deep = createBaseComment({
        id: 'level-1',
        replies: [
          createBaseComment({
            id: 'level-2',
            parentCommentId: 'level-1',
            replies: [
              createBaseComment({
                id: 'level-3',
                parentCommentId: 'level-2',
              }),
            ],
          }),
        ],
      });

      expect(isValidComment(deep)).toBe(true);
    });
  });

  describe('content segment validation', () => {
    it('accepts text segment with string content', () => {
      const comment = createBaseComment({
        content: [{ type: 'text', content: 'Hello' }],
      });
      expect(isValidComment(comment)).toBe(true);
    });

    it('rejects text segment with non-string content', () => {
      const comment = createBaseComment({
        content: [{ type: 'text', content: 123 }] as any,
      });
      expect(isValidComment(comment)).toBe(false);
    });

    it('accepts mention segment with mention object', () => {
      const comment = createBaseComment({
        content: [{ type: 'mention', mention: mentionFixtures.userJohn }],
      });
      expect(isValidComment(comment)).toBe(true);
    });

    it('rejects mention segment with null mention', () => {
      const comment = createBaseComment({
        content: [{ type: 'mention', mention: null }] as any,
      });
      expect(isValidComment(comment)).toBe(false);
    });

    it('rejects unknown segment type', () => {
      const comment = createBaseComment({
        content: [{ type: 'unknown', data: {} }] as any,
      });
      expect(isValidComment(comment)).toBe(false);
    });
  });
});

describe('isValidCommentArray', () => {
  describe('valid arrays', () => {
    it('accepts empty array', () => {
      expect(isValidCommentArray([])).toBe(true);
    });

    it('accepts array of valid comments', () => {
      const comments = [createBaseComment({ id: '1' }), createBaseComment({ id: '2' })];
      expect(isValidCommentArray(comments)).toBe(true);
    });

    it('accepts array with comments containing replies', () => {
      const comments = [createCommentWithReplies(2, { id: '1' })];
      expect(isValidCommentArray(comments)).toBe(true);
    });
  });

  describe('invalid arrays', () => {
    it('rejects null', () => {
      expect(isValidCommentArray(null)).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isValidCommentArray(undefined)).toBe(false);
    });

    it('rejects non-array objects', () => {
      expect(isValidCommentArray({})).toBe(false);
    });

    it('rejects strings', () => {
      expect(isValidCommentArray('[]')).toBe(false);
    });

    it('rejects array with one invalid comment', () => {
      const comments = [
        createBaseComment({ id: '1' }),
        { invalid: true },
        createBaseComment({ id: '2' }),
      ];
      expect(isValidCommentArray(comments)).toBe(false);
    });

    it('rejects array with null element', () => {
      const comments = [createBaseComment({ id: '1' }), null];
      expect(isValidCommentArray(comments)).toBe(false);
    });
  });
});
