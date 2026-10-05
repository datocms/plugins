import {
  commentIdWasMigrated,
  migrateCommentsToUuid,
  type NormalizedComment,
  normalizeComment,
  normalizeCommentIfValid,
} from '@utils/migrations';
import { afterEach, describe, expect, it, vi } from 'vitest';

const timestamp = '2024-01-01T00:00:00.000Z';

function normalizedComment(
  overrides: Partial<NormalizedComment> = {},
): NormalizedComment {
  return {
    dateISO: timestamp,
    content: [{ type: 'text', content: 'Keep this comment' }],
    authorEmail: 'author@example.com',
    upvoterEmails: [],
    ...overrides,
  };
}

function legacyComment() {
  return {
    dateISO: timestamp,
    content: [{ type: 'text', content: 'Keep this comment' }],
    author: { name: 'Jane', email: 'jane@example.com', historical: 'value' },
    usersWhoUpvoted: [
      'a@example.com',
      { name: 'Bob', email: 'bob@example.com' },
    ],
  };
}

function mockUuidSequence() {
  let counter = 0;
  return vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    counter++;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  });
}

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

    it('rejects malformed upvoters instead of silently losing votes', () => {
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
      ).toBeNull();
    });

    it('preserves author, voter metadata, content and unknown fields', () => {
      const source = {
        ...legacyComment(),
        locale: 'pt',
        extension: { nested: [1, 2] },
      };
      const snapshot = JSON.stringify(source);
      const result = normalizeCommentIfValid(source);

      expect(result).toEqual({
        dateISO: source.dateISO,
        content: source.content,
        authorEmail: source.author.email,
        upvoterEmails: ['a@example.com', 'bob@example.com'],
        legacyAuthor: source.author,
        legacyUpvoters: source.usersWhoUpvoted,
        locale: 'pt',
        extension: source.extension,
      });
      expect(JSON.stringify(source)).toBe(snapshot);
      expect(normalizeCommentIfValid(result)).toEqual(result);
    });

    it('accepts mixed legacy, email and user ID formats in one tree', () => {
      const source = {
        ...legacyComment(),
        replies: [
          normalizedComment({ id: 'email-reply', parentCommentId: timestamp }),
          {
            id: 'current-reply',
            dateISO: timestamp,
            content: [],
            authorId: 'user-123',
            upvoterIds: ['user-456'],
            parentCommentISO: timestamp,
            locale: 'en',
          },
        ],
      };
      const result = normalizeCommentIfValid(source);
      expect(result?.replies?.[0]).toEqual(source.replies[0]);
      expect(result?.replies?.[1]).toEqual({
        id: 'current-reply',
        dateISO: timestamp,
        content: [],
        authorId: 'user-123',
        upvoterIds: ['user-456'],
        parentCommentId: timestamp,
        locale: 'en',
      });
    });

    it('retains email and ID fields when both formats coexist', () => {
      const source = normalizedComment({
        authorId: 'user-123',
        upvoterIds: ['user-456'],
      });
      expect(normalizeCommentIfValid(source)).toEqual(source);
    });

    it('preserves missing user ID votes for hybrid comments instead of inventing an empty list', () => {
      const source = { ...legacyComment(), authorId: 'user-123' };
      const result = normalizeCommentIfValid(source);
      expect(result?.upvoterEmails).toEqual([
        'a@example.com',
        'bob@example.com',
      ]);
      expect(result?.upvoterIds).toBeUndefined();
    });

    it('preserves email votes when only the author has already been converted to an ID', () => {
      const result = normalizeCommentIfValid({
        id: 'modern-id',
        dateISO: timestamp,
        content: [],
        authorId: 'user-123',
        upvoterEmails: ['a@example.com'],
      });
      expect(result?.authorId).toBe('user-123');
      expect(result?.upvoterEmails).toEqual(['a@example.com']);
      expect(result?.upvoterIds).toBeUndefined();
    });

    it.each([
      { replies: [{}] },
      { replies: 'invalid' },
      { parentCommentISO: 42 },
      { parentCommentISO: 'old', parentCommentId: 'different' },
      { authorEmail: 'different@example.com' },
      { upvoterEmails: ['different@example.com'] },
      { upvoterIds: [42] },
      { legacyAuthor: { name: 'Different', email: 'different@example.com' } },
      { legacyUpvoters: ['different@example.com'] },
      { id: '' },
    ])(
      'rejects invalid or conflicting data without partial conversion: %j',
      (overrides) => {
        const source = { ...legacyComment(), ...overrides };
        const snapshot = JSON.stringify(source);
        expect(normalizeCommentIfValid(source)).toBeNull();
        expect(JSON.stringify(source)).toBe(snapshot);
      },
    );

    it('rejects cyclic or shared reply objects safely', () => {
      const source = normalizedComment();
      source.replies = [source];
      expect(normalizeCommentIfValid(source)).toBeNull();
      const reply = normalizedComment();
      expect(
        normalizeCommentIfValid(normalizedComment({ replies: [reply, reply] })),
      ).toBeNull();
    });

    it('makes the direct normalizer fail rather than return a partial legacy tree', () => {
      expect(() =>
        normalizeComment({
          ...legacyComment(),
          replies: [legacyComment(), { dateISO: timestamp } as never],
        }),
      ).toThrow('malformed');
    });
  });

  describe('migrateCommentsToUuid', () => {
    it('detects legacy ids recursively in deeply nested replies', () => {
      const firstUuid = '00000000-0000-4000-8000-000000000001';
      const secondUuid = '00000000-0000-4000-8000-000000000002';
      vi.spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce(firstUuid)
        .mockReturnValueOnce(secondUuid)
        .mockReturnValueOnce('00000000-0000-4000-8000-000000000003');

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
      expect(result.comments[0].id).toBe(firstUuid);
      expect(result.comments[0].replies?.[0].parentCommentId).toBe(firstUuid);
      expect(result.comments[0].replies?.[0].replies?.[0].id).toBe(secondUuid);
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
      expect(result.comments).toBe(modernComments);
    });

    it('resolves parent references when the referenced comment appears later', () => {
      const uuid = mockUuidSequence();
      const source = [
        normalizedComment({
          dateISO: '2024-01-02T00:00:00.000Z',
          parentCommentId: timestamp,
        }),
        normalizedComment(),
      ];
      const snapshot = JSON.stringify(source);
      const result = migrateCommentsToUuid(source);

      expect(result.comments[0].parentCommentId).toBe(result.comments[1].id);
      expect(JSON.stringify(source)).toBe(snapshot);
      const again = migrateCommentsToUuid(result.comments);
      expect(again.wasMigrated).toBe(false);
      expect(again.comments).toBe(result.comments);
      expect(uuid).toHaveBeenCalledTimes(2);
    });

    it('uses structural parents to distinguish identical legacy timestamps', () => {
      mockUuidSequence();
      const source = [0, 1].map(() =>
        normalizedComment({
          replies: [normalizedComment({ parentCommentId: timestamp })],
        }),
      );
      const result = migrateCommentsToUuid(source);
      const ids = new Set<string>();
      for (const parent of result.comments) {
        ids.add(parent.id);
        const reply = parent.replies?.[0];
        expect(reply?.parentCommentId).toBe(parent.id);
        if (reply) ids.add(reply.id);
      }
      expect(ids.size).toBe(4);
    });

    it('rejects ambiguous flat parent references instead of guessing', () => {
      mockUuidSequence();
      const source = [
        normalizedComment(),
        normalizedComment(),
        normalizedComment({
          dateISO: '2024-01-02T00:00:00.000Z',
          parentCommentId: timestamp,
        }),
      ];
      expect(() => migrateCommentsToUuid(source)).toThrow('ambiguous');
    });

    it('repairs legacy timestamp references to a parent with an existing modern ID', () => {
      const uuid = mockUuidSequence();
      const result = migrateCommentsToUuid([
        normalizedComment({
          id: 'modern-parent',
          replies: [
            normalizedComment({
              id: 'modern-reply',
              parentCommentId: timestamp,
            }),
          ],
        }),
      ]);
      expect(result.wasMigrated).toBe(true);
      expect(result.comments[0].id).toBe('modern-parent');
      expect(result.comments[0].replies?.[0].parentCommentId).toBe(
        'modern-parent',
      );
      expect(uuid).not.toHaveBeenCalled();
    });

    it('derives missing parent references from the reply structure', () => {
      const result = migrateCommentsToUuid([
        normalizedComment({
          id: 'modern-parent',
          replies: [normalizedComment({ id: 'modern-reply' })],
        }),
      ]);
      expect(result.comments[0].replies?.[0].parentCommentId).toBe(
        'modern-parent',
      );
      expect(result.wasMigrated).toBe(true);
    });

    it('marks only newly generated IDs and preserves their original identifier metadata', () => {
      mockUuidSequence();
      const result = migrateCommentsToUuid([normalizedComment()]);
      const migrated = result.comments[0];
      expect(migrated.legacyCommentId).toBe(timestamp);
      expect(commentIdWasMigrated(migrated)).toBe(true);
      const reloaded = normalizeCommentIfValid(migrated);
      expect(reloaded?.id).toBe(migrated.id);
      if (reloaded) expect(commentIdWasMigrated(reloaded)).toBe(false);
    });

    it('retains provenance metadata on modern source IDs without authorizing ID changes', () => {
      const source = normalizedComment({
        id: 'modern-id',
        legacyCommentId: timestamp,
      });
      const result = migrateCommentsToUuid([source]);
      expect(result.wasMigrated).toBe(false);
      expect(result.comments[0].id).toBe('modern-id');
      expect(commentIdWasMigrated(result.comments[0])).toBe(false);
    });

    it('rejects conflicting legacy identifier metadata without overwriting source data', () => {
      mockUuidSequence();
      const source = normalizedComment({
        legacyCommentId: 'different-original-id',
      });
      const snapshot = JSON.stringify(source);
      expect(() => migrateCommentsToUuid([source])).toThrow(
        'metadata conflicts',
      );
      expect(JSON.stringify(source)).toBe(snapshot);
    });

    it('preserves a direct modern ID reference when a timestamp alias is duplicated', () => {
      const source = [
        normalizedComment({ id: 'parent-a' }),
        normalizedComment({ id: 'parent-b' }),
        normalizedComment({ id: 'reply', parentCommentId: 'parent-b' }),
      ];
      expect(migrateCommentsToUuid(source)).toEqual({
        comments: source,
        wasMigrated: false,
      });
    });

    it('rejects duplicate modern IDs, missing parents and cyclic parent references', () => {
      expect(() =>
        migrateCommentsToUuid([
          normalizedComment({ id: 'duplicate' }),
          normalizedComment({ id: 'duplicate' }),
        ]),
      ).toThrow('Duplicate modern');
      expect(() =>
        migrateCommentsToUuid([
          normalizedComment({ id: 'reply', parentCommentId: 'missing' }),
        ]),
      ).toThrow('missing or ambiguous');
      expect(() =>
        migrateCommentsToUuid([
          normalizedComment({ id: 'a', parentCommentId: 'b' }),
          normalizedComment({ id: 'b', parentCommentId: 'a' }),
        ]),
      ).toThrow('Cyclic');
    });

    it('retries UUID collisions without changing existing modern IDs', () => {
      const existingUuid = '00000000-0000-4000-8000-000000000001';
      const newUuid = '00000000-0000-4000-8000-000000000002';
      vi.spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce(existingUuid)
        .mockReturnValueOnce(newUuid);
      const result = migrateCommentsToUuid([
        normalizedComment(),
        normalizedComment({ id: existingUuid }),
      ]);
      expect(result.comments.map((comment) => comment.id)).toEqual([
        newUuid,
        existingUuid,
      ]);
    });

    it('bounds UUID collision retries and leaves source data intact on failure', () => {
      const existingUuid = '00000000-0000-4000-8000-000000000001';
      const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(existingUuid);
      const source = [
        normalizedComment(),
        normalizedComment({ id: existingUuid }),
      ];
      const snapshot = JSON.stringify(source);
      expect(() => migrateCommentsToUuid(source)).toThrow('unique');
      expect(uuid).toHaveBeenCalledTimes(5);
      expect(JSON.stringify(source)).toBe(snapshot);
    });
  });
});
