import {
  migrateCommentsToUuid,
  normalizeCommentIfValid,
} from '@utils/migrations';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('migration helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeCommentIfValid', () => {
    it('returns null for malformed legacy comments', () => {
      expect(normalizeCommentIfValid({})).toBeNull();
      expect(
        normalizeCommentIfValid({
          dateISO: '2024-01-01T00:00:00.000Z',
          author: {},
          usersWhoUpvoted: [],
        }),
      ).toBeNull();
    });

    it('filters malformed upvoters while keeping valid data', () => {
      expect(
        normalizeCommentIfValid({
          dateISO: '2024-01-01T00:00:00.000Z',
          content: [],
          author: { name: 'Jane', email: 'jane@example.com' },
          usersWhoUpvoted: [
            'a@example.com',
            { name: 'Bob', email: 'bob@example.com' },
            42,
          ],
        }),
      ).toEqual({
        dateISO: '2024-01-01T00:00:00.000Z',
        content: [],
        authorEmail: 'jane@example.com',
        upvoterEmails: ['a@example.com', 'bob@example.com'],
      });
    });
  });

  describe('migrateCommentsToUuid', () => {
    it('detects legacy ids recursively in deeply nested replies', () => {
      vi.spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce('uuid-1')
        .mockReturnValueOnce('uuid-2')
        .mockReturnValueOnce('uuid-3');

      const result = migrateCommentsToUuid([
        {
          id: '2024-01-01T00:00:00.000Z',
          dateISO: '2024-01-01T00:00:00.000Z',
          content: [],
          authorEmail: 'parent@example.com',
          upvoterEmails: [],
          replies: [
            {
              id: 'reply-existing',
              dateISO: '2024-01-01T00:01:00.000Z',
              content: [],
              authorEmail: 'reply@example.com',
              upvoterEmails: [],
              parentCommentId: '2024-01-01T00:00:00.000Z',
              replies: [
                {
                  id: '2024-01-01T00:02:00.000Z',
                  dateISO: '2024-01-01T00:02:00.000Z',
                  content: [],
                  authorEmail: 'deep@example.com',
                  upvoterEmails: [],
                  parentCommentId: 'reply-existing',
                },
              ],
            },
          ],
        },
      ]);

      expect(result.wasMigrated).toBe(true);
      expect(result.comments[0].id).toBe('uuid-1');
      expect(result.comments[0].replies?.[0].parentCommentId).toBe('uuid-1');
      expect(result.comments[0].replies?.[0].replies?.[0].id).toBe('uuid-2');
    });

    it('does not migrate fully modern comments', () => {
      const modernComments = [
        {
          id: 'uuid-parent',
          dateISO: '2024-01-01T00:00:00.000Z',
          content: [],
          authorEmail: 'parent@example.com',
          upvoterEmails: [],
          replies: [
            {
              id: 'uuid-reply',
              dateISO: '2024-01-01T00:01:00.000Z',
              content: [],
              authorEmail: 'reply@example.com',
              upvoterEmails: [],
              parentCommentId: 'uuid-parent',
            },
          ],
        },
      ];

      const result = migrateCommentsToUuid(modernComments);

      expect(result.wasMigrated).toBe(false);
      expect(result.comments).toEqual(modernComments);
    });
  });
});
