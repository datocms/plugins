import type { CommentSegment } from './mentions';
import { isValidCommentArray } from '@utils/typeGuards';
import { logError } from '@/utils/errorLogger';

export type Upvoter = { name: string; email: string };

/** id: UUID for lookups. dateISO: timestamp for display/sorting. Legacy data may have id === dateISO. */
export type CommentType = {
  id: string;
  dateISO: string;
  content: CommentSegment[];
  author: { name: string; email: string };
  usersWhoUpvoted: Upvoter[];
  replies?: CommentType[];
  parentCommentId?: string;
};

export type QueryResult = {
  allProjectComments: Array<{
    id: string;
    content: string | CommentType[] | null;
  }>;
};

export const COMMENTS_QUERY = `
  query CommentsQuery($modelId: String!, $recordId: String!) {
    allProjectComments(filter: { modelId: { eq: $modelId }, recordId: { eq: $recordId } }, first: 1) {
      id
      content
    }
  }
`;

/** Parses comment data from API. Returns empty array on error with logging. */
export function parseComments(content: unknown): CommentType[] {
  if (!content) return [];

  if (Array.isArray(content)) {
    if (!isValidCommentArray(content)) {
      logError('parseComments: Array content failed validation', undefined, {
        arrayLength: content.length,
        firstItemType: content.length > 0 ? typeof content[0] : 'empty',
        hasNestedArrays: content.some(item => Array.isArray(item)),
      });
      return [];
    }
    return content as CommentType[];
  }

  if (typeof content === 'string') {
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

      return parsed as CommentType[];
    } catch (error) {
      logError('parseComments: JSON parsing failed', error, {
        contentLength: content.length,
        startsWithBracket: content.startsWith('[') || content.startsWith('{'),
        containsNullBytes: content.includes('\0'),
      });
      return [];
    }
  }

  logError('parseComments: Unexpected content type', undefined, { contentType: typeof content });
  return [];
}

export function isContentEmpty(content: CommentSegment[]): boolean {
  if (content.length === 0) return true;
  return content.every(
    (seg) => seg.type === 'text' && seg.content.trim() === ''
  );
}

export type CommentsDataProps = {
  comments: CommentType[];
  filteredComments: CommentType[];
  setComments: React.Dispatch<React.SetStateAction<CommentType[]>>;
  commentsModelId: string | null;
  commentRecordId: string | null;
  setCommentRecordId: (id: string | null) => void;
};
