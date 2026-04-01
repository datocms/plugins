import type {
  CommentType,
  ResolvedAuthor,
  ResolvedCommentType,
} from '@ctypes/comments';
import type { CommentSegment, StoredCommentSegment } from '@ctypes/mentions';

// Counter for unique IDs
let idCounter = 0;

function generateId(): string {
  idCounter += 1;
  return `comment-${idCounter}`;
}

function generateDateISO(offsetMs = 0): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

export function resetIdCounter(): void {
  idCounter = 0;
}

export function createTextSegment(text: string): StoredCommentSegment {
  return { type: 'text', content: text };
}

export function createBaseComment(
  overrides: Partial<CommentType> = {},
): CommentType {
  const id = overrides.id ?? generateId();
  return {
    id,
    dateISO: overrides.dateISO ?? generateDateISO(),
    content: overrides.content ?? [createTextSegment('Test comment')],
    authorId: overrides.authorId ?? 'user-123',
    upvoterIds: overrides.upvoterIds ?? [],
    replies: overrides.replies,
    parentCommentId: overrides.parentCommentId,
  };
}

export function createCommentWithReplies(
  replyCount = 2,
  commentOverrides: Partial<CommentType> = {},
): CommentType {
  const parentId = commentOverrides.id ?? generateId();
  const replies: CommentType[] = Array.from({ length: replyCount }, (_, i) =>
    createBaseComment({
      id: `${parentId}-reply-${i + 1}`,
      content: [createTextSegment(`Reply ${i + 1}`)],
      parentCommentId: parentId,
    }),
  );

  return createBaseComment({
    ...commentOverrides,
    id: parentId,
    replies,
  });
}

export function createCommentWithUpvotes(
  upvoterCount = 2,
  commentOverrides: Partial<CommentType> = {},
): CommentType {
  const upvoterIds = Array.from(
    { length: upvoterCount },
    (_, i) => `upvoter-${i + 1}`,
  );

  return createBaseComment({
    ...commentOverrides,
    upvoterIds,
  });
}

export function createCommentList(count: number): CommentType[] {
  return Array.from({ length: count }, (_, i) =>
    createBaseComment({
      content: [createTextSegment(`Comment ${i + 1}`)],
      dateISO: generateDateISO(i * 60000), // Each comment 1 minute apart
    }),
  );
}

export function createNestedComment(depth: number): CommentType {
  if (depth <= 0) {
    return createBaseComment({ content: [createTextSegment('Leaf comment')] });
  }

  const parentId = generateId();
  return createBaseComment({
    id: parentId,
    content: [createTextSegment(`Comment at depth ${depth}`)],
    replies: [
      {
        ...createNestedComment(depth - 1),
        parentCommentId: parentId,
      },
    ],
  });
}

// Helper for creating full CommentSegment (with full mention data) for editing
export function createFullTextSegment(text: string): CommentSegment {
  return { type: 'text', content: text };
}

// Helper for creating resolved author
export function createResolvedAuthor(
  overrides: Partial<ResolvedAuthor> = {},
): ResolvedAuthor {
  return {
    id: overrides.id ?? 'author-123',
    email: overrides.email ?? 'test@example.com',
    name: overrides.name ?? 'Test Author',
    avatarUrl: overrides.avatarUrl ?? null,
  };
}

// Helper for creating resolved comments (used for comparison tests)
export function createResolvedComment(
  overrides: Partial<ResolvedCommentType> = {},
): ResolvedCommentType {
  const id = overrides.id ?? generateId();
  return {
    id,
    dateISO: overrides.dateISO ?? generateDateISO(),
    content: overrides.content ?? [createFullTextSegment('Test comment')],
    author: overrides.author ?? createResolvedAuthor(),
    upvoters: overrides.upvoters ?? [],
    replies: overrides.replies,
    parentCommentId: overrides.parentCommentId,
  };
}

export function createResolvedCommentWithReplies(
  replyCount = 2,
  commentOverrides: Partial<ResolvedCommentType> = {},
): ResolvedCommentType {
  const parentId = commentOverrides.id ?? generateId();
  const replies: ResolvedCommentType[] = Array.from(
    { length: replyCount },
    (_, i) =>
      createResolvedComment({
        id: `${parentId}-reply-${i + 1}`,
        content: [createFullTextSegment(`Reply ${i + 1}`)],
        parentCommentId: parentId,
      }),
  );

  return createResolvedComment({
    ...commentOverrides,
    id: parentId,
    replies,
  });
}

// Pre-built fixtures for common test scenarios
export const fixtures = {
  emptyComment: createBaseComment({
    id: 'empty-comment',
    content: [],
  }),

  whitespaceOnlyComment: createBaseComment({
    id: 'whitespace-comment',
    content: [createTextSegment('   ')],
  }),

  simpleComment: createBaseComment({
    id: 'simple-comment',
    content: [createTextSegment('Hello, world!')],
  }),

  commentWithMultipleSegments: createBaseComment({
    id: 'multi-segment-comment',
    content: [
      createTextSegment('Hello '),
      createTextSegment('world'),
      createTextSegment('!'),
    ],
  }),

  // User IDs for testing
  userIds: {
    alice: 'user-alice',
    bob: 'user-bob',
    charlie: 'user-charlie',
  },
};
