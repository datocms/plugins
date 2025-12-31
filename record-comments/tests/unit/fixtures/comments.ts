import type { CommentType, Upvoter } from '@ctypes/comments';
import type { CommentSegment } from '@ctypes/mentions';

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

export function createUpvoter(overrides: Partial<Upvoter> = {}): Upvoter {
  return {
    name: 'Upvoter User',
    email: 'upvoter@example.com',
    ...overrides,
  };
}

export function createTextSegment(text: string): CommentSegment {
  return { type: 'text', content: text };
}

export function createBaseComment(overrides: Partial<CommentType> = {}): CommentType {
  const id = overrides.id ?? generateId();
  return {
    id,
    dateISO: overrides.dateISO ?? generateDateISO(),
    content: overrides.content ?? [createTextSegment('Test comment')],
    author: overrides.author ?? { name: 'Test User', email: 'test@example.com' },
    usersWhoUpvoted: overrides.usersWhoUpvoted ?? [],
    replies: overrides.replies,
    parentCommentId: overrides.parentCommentId,
  };
}

export function createCommentWithReplies(
  replyCount = 2,
  commentOverrides: Partial<CommentType> = {}
): CommentType {
  const parentId = commentOverrides.id ?? generateId();
  const replies: CommentType[] = Array.from({ length: replyCount }, (_, i) =>
    createBaseComment({
      id: `${parentId}-reply-${i + 1}`,
      content: [createTextSegment(`Reply ${i + 1}`)],
      parentCommentId: parentId,
    })
  );

  return createBaseComment({
    ...commentOverrides,
    id: parentId,
    replies,
  });
}

export function createCommentWithUpvotes(
  upvoterCount = 2,
  commentOverrides: Partial<CommentType> = {}
): CommentType {
  const upvoters: Upvoter[] = Array.from({ length: upvoterCount }, (_, i) =>
    createUpvoter({
      name: `Upvoter ${i + 1}`,
      email: `upvoter${i + 1}@example.com`,
    })
  );

  return createBaseComment({
    ...commentOverrides,
    usersWhoUpvoted: upvoters,
  });
}

export function createCommentList(count: number): CommentType[] {
  return Array.from({ length: count }, (_, i) =>
    createBaseComment({
      content: [createTextSegment(`Comment ${i + 1}`)],
      dateISO: generateDateISO(i * 60000), // Each comment 1 minute apart
    })
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

  author: {
    alice: { name: 'Alice Smith', email: 'alice@example.com' },
    bob: { name: 'Bob Jones', email: 'bob@example.com' },
    charlie: { name: 'Charlie Brown', email: 'charlie@example.com' },
  },
};
