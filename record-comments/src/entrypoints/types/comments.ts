import { isValidCommentArray } from '@utils/typeGuards';
import { logError } from '@/utils/errorLogger';
import type { CommentSegment, StoredCommentSegment } from './mentions';

/** id: UUID for lookups. dateISO: timestamp for display/sorting. Stores only IDs for author/upvoters. */
export type CommentType = {
  id: string;
  dateISO: string;
  content: StoredCommentSegment[];
  authorId: string;
  upvoterIds: string[];
  replies?: CommentType[];
  parentCommentId?: string;
};

/** Resolved author with full display data */
export type ResolvedAuthor = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

/** Resolved comment with full display data for rendering */
export type ResolvedCommentType = {
  id: string;
  dateISO: string;
  content: CommentSegment[];
  /** Exact persisted content used to detect edits made after editing began. */
  storedContent?: StoredCommentSegment[];
  author: ResolvedAuthor;
  upvoters: ResolvedAuthor[];
  replies?: ResolvedCommentType[];
  parentCommentId?: string;
};

export type QueryResult = {
  allProjectComments: Array<{
    id: string;
    content: string | CommentType[] | null;
  }>;
};

function normalizeParsedComments(comments: CommentType[]): CommentType[] {
  const normalized: CommentType[] = [];
  const stack: {
    source: CommentType[];
    target: CommentType[];
    index: number;
  }[] = [{ source: comments, target: normalized, index: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.source.length) {
      stack.pop();
      continue;
    }
    const comment = frame.source[frame.index++];
    const copy = { ...comment };
    frame.target.push(copy);
    if (comment.replies || comment.parentCommentId == null) {
      copy.replies = [];
      if (comment.replies?.length) {
        stack.push({ source: comment.replies, target: copy.replies, index: 0 });
      }
    }
  }
  return normalized;
}

export const COMMENTS_QUERY = `
  query CommentsQuery($modelId: String!, $recordId: String!) {
    allProjectComments(filter: { modelId: { eq: $modelId }, recordId: { eq: $recordId } }, first: 2) {
      id
      modelId
      recordId
      content
    }
  }
`;

function parseCommentsFromArray(content: unknown[]): CommentType[] {
  if (!isValidCommentArray(content)) {
    logError('parseComments: Array content failed validation', undefined, {
      arrayLength: content.length,
      firstItemType: content.length > 0 ? typeof content[0] : 'empty',
      hasNestedArrays: content.some((item) => Array.isArray(item)),
    });
    return [];
  }
  return normalizeParsedComments(content as CommentType[]);
}

function parseCommentsFromString(content: string): CommentType[] {
  try {
    const parsed: unknown = JSON.parse(content);

    if (!isValidCommentArray(parsed)) {
      logError('parseComments: Parsed JSON failed validation', undefined, {
        contentLength: content.length,
        parsedType: typeof parsed,
        isArray: Array.isArray(parsed),
        parsedLength: Array.isArray(parsed) ? parsed.length : undefined,
      });
      return [];
    }

    return normalizeParsedComments(parsed as CommentType[]);
  } catch (error) {
    logError('parseComments: JSON parsing failed', error, {
      contentLength: content.length,
      startsWithBracket: content.startsWith('[') || content.startsWith('{'),
      containsNullBytes: content.includes('\0'),
    });
    return [];
  }
}

/** Parses comment data from API. Returns empty array on error with logging. */
export function parseComments(content: unknown): CommentType[] {
  if (!content) return [];

  if (Array.isArray(content)) {
    return parseCommentsFromArray(content);
  }

  if (typeof content === 'string') {
    return parseCommentsFromString(content);
  }

  logError('parseComments: Unexpected content type', undefined, {
    contentType: typeof content,
  });
  return [];
}

/**
 * Checks if comment content is empty (no mentions and only whitespace text).
 * Works with both full segments (for display) and stored segments (for persistence).
 */
export function isContentEmpty(
  content: CommentSegment[] | StoredCommentSegment[],
): boolean {
  if (content.length === 0) return true;
  return content.every(
    (seg) => seg.type === 'text' && seg.content.trim() === '',
  );
}
