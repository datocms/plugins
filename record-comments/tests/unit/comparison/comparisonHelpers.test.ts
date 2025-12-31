import { describe, it, expect, beforeEach } from 'vitest';
import {
  areMentionsEqual,
  areSegmentsEqual,
  areUpvotersEqual,
  areRepliesEqual,
  areCommentsEqual,
} from '@utils/comparisonHelpers';
import {
  createBaseComment,
  createCommentWithReplies,
  createTextSegment,
  createUpvoter,
  resetIdCounter,
} from '../fixtures/comments';
import {
  createUserMention,
  createFieldMention,
  createAssetMention,
  createRecordMention,
  createModelMention,
  createMentionSegment,
} from '../fixtures/mentions';

describe('areMentionsEqual', () => {
  describe('user mentions', () => {
    it('returns true for identical user mentions', () => {
      const a = createUserMention({ id: 'user-1' });
      const b = createUserMention({ id: 'user-1' });
      expect(areMentionsEqual(a, b)).toBe(true);
    });

    it('returns false for different IDs', () => {
      const a = createUserMention({ id: 'user-1' });
      const b = createUserMention({ id: 'user-2' });
      expect(areMentionsEqual(a, b)).toBe(false);
    });

    it('returns false for different names', () => {
      const a = createUserMention({ name: 'John' });
      const b = createUserMention({ name: 'Jane' });
      expect(areMentionsEqual(a, b)).toBe(false);
    });

    it('returns false for different emails', () => {
      const a = createUserMention({ email: 'john@test.com' });
      const b = createUserMention({ email: 'jane@test.com' });
      expect(areMentionsEqual(a, b)).toBe(false);
    });

    it('returns false for different avatarUrl', () => {
      const a = createUserMention({ avatarUrl: 'url1' });
      const b = createUserMention({ avatarUrl: 'url2' });
      expect(areMentionsEqual(a, b)).toBe(false);
    });

    it('handles null avatarUrl correctly', () => {
      const a = createUserMention({ avatarUrl: null });
      const b = createUserMention({ avatarUrl: null });
      expect(areMentionsEqual(a, b)).toBe(true);
    });
  });

  describe('field mentions', () => {
    it('returns true for identical field mentions', () => {
      const a = createFieldMention();
      const b = createFieldMention();
      expect(areMentionsEqual(a, b)).toBe(true);
    });

    it('returns false for different fieldPath', () => {
      const a = createFieldMention({ fieldPath: 'title' });
      const b = createFieldMention({ fieldPath: 'description' });
      expect(areMentionsEqual(a, b)).toBe(false);
    });

    it('returns false for different locale', () => {
      const a = createFieldMention({ locale: 'en' });
      const b = createFieldMention({ locale: 'fr' });
      expect(areMentionsEqual(a, b)).toBe(false);
    });

    it('returns false for different localized flag', () => {
      const a = createFieldMention({ localized: true });
      const b = createFieldMention({ localized: false });
      expect(areMentionsEqual(a, b)).toBe(false);
    });

    it('returns false for different fieldType', () => {
      const a = createFieldMention({ fieldType: 'string' });
      const b = createFieldMention({ fieldType: 'text' });
      expect(areMentionsEqual(a, b)).toBe(false);
    });
  });

  describe('asset mentions', () => {
    it('returns true for identical asset mentions', () => {
      const a = createAssetMention();
      const b = createAssetMention();
      expect(areMentionsEqual(a, b)).toBe(true);
    });

    it('returns false for different IDs', () => {
      const a = createAssetMention({ id: 'asset-1' });
      const b = createAssetMention({ id: 'asset-2' });
      expect(areMentionsEqual(a, b)).toBe(false);
    });

    it('returns false for different filenames', () => {
      const a = createAssetMention({ filename: 'a.png' });
      const b = createAssetMention({ filename: 'b.png' });
      expect(areMentionsEqual(a, b)).toBe(false);
    });

    it('returns false for different mimeTypes', () => {
      const a = createAssetMention({ mimeType: 'image/png' });
      const b = createAssetMention({ mimeType: 'image/jpeg' });
      expect(areMentionsEqual(a, b)).toBe(false);
    });
  });

  describe('record mentions', () => {
    it('returns true for identical record mentions', () => {
      const a = createRecordMention();
      const b = createRecordMention();
      expect(areMentionsEqual(a, b)).toBe(true);
    });

    it('returns false for different titles', () => {
      const a = createRecordMention({ title: 'Title A' });
      const b = createRecordMention({ title: 'Title B' });
      expect(areMentionsEqual(a, b)).toBe(false);
    });

    it('returns false for different isSingleton', () => {
      const a = createRecordMention({ isSingleton: true });
      const b = createRecordMention({ isSingleton: false });
      expect(areMentionsEqual(a, b)).toBe(false);
    });

    it('handles undefined isSingleton', () => {
      const a = createRecordMention();
      delete (a as any).isSingleton;
      const b = createRecordMention();
      delete (b as any).isSingleton;
      expect(areMentionsEqual(a, b)).toBe(true);
    });
  });

  describe('model mentions', () => {
    it('returns true for identical model mentions', () => {
      const a = createModelMention();
      const b = createModelMention();
      expect(areMentionsEqual(a, b)).toBe(true);
    });

    it('returns false for different isBlockModel', () => {
      const a = createModelMention({ isBlockModel: true });
      const b = createModelMention({ isBlockModel: false });
      expect(areMentionsEqual(a, b)).toBe(false);
    });
  });

  describe('cross-type comparisons', () => {
    it('returns false for different mention types', () => {
      const user = createUserMention();
      const field = createFieldMention();
      expect(areMentionsEqual(user, field)).toBe(false);
    });

    it('returns false for user vs asset', () => {
      const user = createUserMention();
      const asset = createAssetMention();
      expect(areMentionsEqual(user, asset)).toBe(false);
    });

    it('returns false for record vs model', () => {
      const record = createRecordMention();
      const model = createModelMention();
      expect(areMentionsEqual(record, model)).toBe(false);
    });
  });
});

describe('areSegmentsEqual', () => {
  describe('text segments', () => {
    it('returns true for identical text segments', () => {
      const a = [createTextSegment('Hello')];
      const b = [createTextSegment('Hello')];
      expect(areSegmentsEqual(a, b)).toBe(true);
    });

    it('returns false for different text content', () => {
      const a = [createTextSegment('Hello')];
      const b = [createTextSegment('World')];
      expect(areSegmentsEqual(a, b)).toBe(false);
    });

    it('returns true for empty arrays', () => {
      expect(areSegmentsEqual([], [])).toBe(true);
    });

    it('returns false for different lengths', () => {
      const a = [createTextSegment('A'), createTextSegment('B')];
      const b = [createTextSegment('A')];
      expect(areSegmentsEqual(a, b)).toBe(false);
    });
  });

  describe('mention segments', () => {
    it('returns true for identical mention segments', () => {
      const mention = createUserMention();
      const a = [createMentionSegment(mention)];
      const b = [createMentionSegment(mention)];
      expect(areSegmentsEqual(a, b)).toBe(true);
    });

    it('returns false for different mention types', () => {
      const a = [createMentionSegment(createUserMention())];
      const b = [createMentionSegment(createFieldMention())];
      expect(areSegmentsEqual(a, b)).toBe(false);
    });
  });

  describe('mixed segments', () => {
    it('returns true for identical mixed segments', () => {
      const mention = createUserMention();
      const a = [createTextSegment('Hello '), createMentionSegment(mention)];
      const b = [createTextSegment('Hello '), createMentionSegment(mention)];
      expect(areSegmentsEqual(a, b)).toBe(true);
    });

    it('returns false when text differs in mixed segments', () => {
      const mention = createUserMention();
      const a = [createTextSegment('Hello '), createMentionSegment(mention)];
      const b = [createTextSegment('Hi '), createMentionSegment(mention)];
      expect(areSegmentsEqual(a, b)).toBe(false);
    });

    it('returns false for text vs mention', () => {
      const a = [createTextSegment('Hello')];
      const b = [createMentionSegment(createUserMention())];
      expect(areSegmentsEqual(a, b)).toBe(false);
    });
  });

  describe('reference equality', () => {
    it('returns true for same reference', () => {
      const segments = [createTextSegment('Hello')];
      expect(areSegmentsEqual(segments, segments)).toBe(true);
    });
  });
});

describe('areUpvotersEqual', () => {
  it('returns true for identical upvoters', () => {
    const a = [createUpvoter({ email: 'a@test.com' })];
    const b = [createUpvoter({ email: 'a@test.com' })];
    expect(areUpvotersEqual(a, b)).toBe(true);
  });

  it('returns true for empty arrays', () => {
    expect(areUpvotersEqual([], [])).toBe(true);
  });

  it('returns false for different emails', () => {
    const a = [createUpvoter({ email: 'a@test.com' })];
    const b = [createUpvoter({ email: 'b@test.com' })];
    expect(areUpvotersEqual(a, b)).toBe(false);
  });

  it('returns false for different lengths', () => {
    const a = [createUpvoter({ email: 'a@test.com' }), createUpvoter({ email: 'b@test.com' })];
    const b = [createUpvoter({ email: 'a@test.com' })];
    expect(areUpvotersEqual(a, b)).toBe(false);
  });

  it('compares by email only (ignores name differences)', () => {
    const a = [createUpvoter({ name: 'Alice', email: 'test@test.com' })];
    const b = [createUpvoter({ name: 'Bob', email: 'test@test.com' })];
    expect(areUpvotersEqual(a, b)).toBe(true);
  });

  it('is order-sensitive', () => {
    const a = [createUpvoter({ email: 'a@test.com' }), createUpvoter({ email: 'b@test.com' })];
    const b = [createUpvoter({ email: 'b@test.com' }), createUpvoter({ email: 'a@test.com' })];
    expect(areUpvotersEqual(a, b)).toBe(false);
  });

  it('returns true for same reference', () => {
    const upvoters = [createUpvoter()];
    expect(areUpvotersEqual(upvoters, upvoters)).toBe(true);
  });
});

describe('areRepliesEqual', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('returns true for both undefined', () => {
    expect(areRepliesEqual(undefined, undefined)).toBe(true);
  });

  it('returns true for both empty arrays', () => {
    expect(areRepliesEqual([], [])).toBe(true);
  });

  it('returns false for undefined vs empty array', () => {
    expect(areRepliesEqual(undefined, [])).toBe(false);
  });

  it('returns false for array vs undefined', () => {
    expect(areRepliesEqual([], undefined)).toBe(false);
  });

  it('returns true for identical replies', () => {
    const reply1 = createBaseComment({ id: 'reply-1' });
    const reply2 = createBaseComment({ id: 'reply-1' });
    expect(areRepliesEqual([reply1], [reply2])).toBe(true);
  });

  it('returns false for different reply IDs', () => {
    const a = [createBaseComment({ id: 'reply-1' })];
    const b = [createBaseComment({ id: 'reply-2' })];
    expect(areRepliesEqual(a, b)).toBe(false);
  });

  it('returns false for different reply content', () => {
    const a = [createBaseComment({ id: 'reply-1', content: [createTextSegment('A')] })];
    const b = [createBaseComment({ id: 'reply-1', content: [createTextSegment('B')] })];
    expect(areRepliesEqual(a, b)).toBe(false);
  });

  it('returns false for different reply upvoters', () => {
    const a = [createBaseComment({ id: 'reply-1', usersWhoUpvoted: [] })];
    const b = [
      createBaseComment({
        id: 'reply-1',
        usersWhoUpvoted: [createUpvoter()],
      }),
    ];
    expect(areRepliesEqual(a, b)).toBe(false);
  });

  it('returns false for different lengths', () => {
    const reply = createBaseComment({ id: 'reply-1' });
    const a = [reply, createBaseComment({ id: 'reply-2' })];
    const b = [reply];
    expect(areRepliesEqual(a, b)).toBe(false);
  });

  describe('recursion depth limit', () => {
    it('returns false when exceeding max recursion depth', () => {
      // Create two identical deeply nested structures (separate object references)
      function createDeepNesting() {
        let current = createBaseComment({ id: 'level-0' });
        for (let i = 1; i <= 25; i++) {
          current = createBaseComment({
            id: `level-${i}`,
            replies: [current],
          });
        }
        return current;
      }

      const a = createDeepNesting();
      const b = createDeepNesting();

      // Different object references with same structure should fail due to depth limit
      expect(areRepliesEqual([a], [b], 0)).toBe(false);
    });

    it('handles reasonable nesting depth', () => {
      const nested = createBaseComment({
        id: 'parent',
        replies: [
          createBaseComment({
            id: 'child',
            replies: [createBaseComment({ id: 'grandchild' })],
          }),
        ],
      });

      expect(areRepliesEqual([nested], [nested])).toBe(true);
    });
  });

  it('returns true for same reference', () => {
    const replies = [createBaseComment({ id: 'reply-1' })];
    expect(areRepliesEqual(replies, replies)).toBe(true);
  });
});

describe('areCommentsEqual', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('returns true for identical comments', () => {
    const a = createBaseComment({ id: 'test-1' });
    const b = createBaseComment({ id: 'test-1' });
    expect(areCommentsEqual(a, b)).toBe(true);
  });

  it('returns false for different IDs', () => {
    const a = createBaseComment({ id: 'test-1' });
    const b = createBaseComment({ id: 'test-2' });
    expect(areCommentsEqual(a, b)).toBe(false);
  });

  it('returns false for different author emails', () => {
    const a = createBaseComment({
      id: 'test-1',
      author: { name: 'Test', email: 'a@test.com' },
    });
    const b = createBaseComment({
      id: 'test-1',
      author: { name: 'Test', email: 'b@test.com' },
    });
    expect(areCommentsEqual(a, b)).toBe(false);
  });

  it('returns false for different content', () => {
    const a = createBaseComment({
      id: 'test-1',
      content: [createTextSegment('A')],
    });
    const b = createBaseComment({
      id: 'test-1',
      content: [createTextSegment('B')],
    });
    expect(areCommentsEqual(a, b)).toBe(false);
  });

  it('returns false for different upvoters', () => {
    const a = createBaseComment({ id: 'test-1', usersWhoUpvoted: [] });
    const b = createBaseComment({
      id: 'test-1',
      usersWhoUpvoted: [createUpvoter()],
    });
    expect(areCommentsEqual(a, b)).toBe(false);
  });

  it('returns false for different replies', () => {
    const a = createBaseComment({ id: 'test-1', replies: [] });
    const b = createCommentWithReplies(1, { id: 'test-1' });
    expect(areCommentsEqual(a, b)).toBe(false);
  });

  it('compares replies deeply', () => {
    const replyA = createBaseComment({
      id: 'reply-1',
      content: [createTextSegment('Reply A')],
    });
    const replyB = createBaseComment({
      id: 'reply-1',
      content: [createTextSegment('Reply B')],
    });

    const a = createBaseComment({ id: 'parent', replies: [replyA] });
    const b = createBaseComment({ id: 'parent', replies: [replyB] });

    expect(areCommentsEqual(a, b)).toBe(false);
  });

  it('returns true for same reference', () => {
    const comment = createBaseComment();
    expect(areCommentsEqual(comment, comment)).toBe(true);
  });

  it('ignores dateISO differences (uses id for identity)', () => {
    const a = createBaseComment({ id: 'test-1', dateISO: '2024-01-01T00:00:00Z' });
    const b = createBaseComment({ id: 'test-1', dateISO: '2024-12-31T23:59:59Z' });
    expect(areCommentsEqual(a, b)).toBe(true);
  });

  it('ignores author name differences (uses email for identity)', () => {
    const a = createBaseComment({
      id: 'test-1',
      author: { name: 'Alice', email: 'test@test.com' },
    });
    const b = createBaseComment({
      id: 'test-1',
      author: { name: 'Bob', email: 'test@test.com' },
    });
    expect(areCommentsEqual(a, b)).toBe(true);
  });
});
