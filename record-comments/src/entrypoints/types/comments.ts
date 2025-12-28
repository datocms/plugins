import type { CommentSegment } from './mentions';
import { isValidCommentArray } from '@utils/typeGuards';
import { logError } from '@/utils/errorLogger';

/**
 * Information about a user who upvoted a comment.
 */
export type Upvoter = { name: string; email: string };

/**
 * Represents a single comment in the comments system.
 *
 * Comments are stored in a JSON field and support threading via replies.
 * Each comment has a unique identifier and tracks authorship, content,
 * upvotes, and optional nested replies.
 *
 * ## TECHNICAL DEBT: Comment Identifier History
 *
 * ### Historical Context
 * Earlier versions of this plugin used `dateISO` (the ISO timestamp) as the
 * comment identifier. The `id` field was later added to support proper UUIDs,
 * but both fields were kept for backward compatibility.
 *
 * ### Current State
 * New comments now generate:
 * - `id`: A proper UUID via `crypto.randomUUID()`
 * - `dateISO`: The ISO 8601 creation timestamp
 *
 * These are intentionally different values with different purposes:
 * - `id` is the stable, unique identifier used for lookups and references
 * - `dateISO` is the human-readable timestamp for display ("5 minutes ago")
 *
 * ### Legacy Data Concern
 * **WARNING:** Comments created before the UUID migration may have `id === dateISO`
 * (both set to the ISO timestamp). There is NO migration code to update these
 * legacy comments to use proper UUIDs.
 *
 * This means:
 * 1. Legacy comments have timestamp-based IDs (collision-prone if created
 *    within the same millisecond)
 * 2. Replies to legacy comments reference the timestamp-based ID via
 *    `parentCommentId`
 * 3. If legacy data is ever migrated to use UUIDs, the `parentCommentId`
 *    references would break unless also updated
 *
 * ### What Would Be Needed to Fully Resolve This
 * 1. A migration script that:
 *    - Scans all existing `project_comment` records
 *    - Generates new UUIDs for comments where `id === dateISO`
 *    - Updates all `parentCommentId` references to match
 *    - Handles the atomic update to prevent data corruption
 * 2. Version tracking to know if migration has run
 * 3. Rollback capability in case of migration failure
 *
 * Until such migration is implemented, this dual-field pattern remains
 * as technical debt.
 */
export type CommentType = {
  /**
   * Unique identifier for the comment.
   *
   * For NEW comments (post-UUID migration): Generated via `crypto.randomUUID()`.
   * For LEGACY comments: May be the ISO timestamp string (same as `dateISO`).
   *
   * Used for:
   * - React keys in list rendering
   * - Comment lookups in operations
   * - External references (e.g., `parentCommentId` in replies)
   *
   * @see parentCommentId - References this field for reply threading
   */
  id: string;

  /**
   * ISO 8601 timestamp of when the comment was created.
   *
   * This is the ONLY field that should be used for:
   * - "X time ago" relative time display
   * - Chronological sorting
   * - Historical/audit reference
   *
   * NOTE: For legacy comments, this may equal `id`. For new comments,
   * `id` is a UUID and `dateISO` is the actual timestamp. Do NOT use
   * `id` for time-based operations.
   */
  dateISO: string;

  /** The comment content as an array of text and mention segments. */
  content: CommentSegment[];

  /** The user who authored this comment. */
  author: { name: string; email: string };

  /** List of users who have upvoted this comment. */
  usersWhoUpvoted: Upvoter[];

  /** Nested replies to this comment (only present on top-level comments). */
  replies?: CommentType[];

  /**
   * For replies, the ID of the parent comment this is replying to.
   * Undefined for top-level comments.
   *
   * IMPORTANT: This references the parent's `id` field, NOT `dateISO`.
   * For legacy comments where `id === dateISO`, this distinction doesn't
   * matter. But for new comments with UUID-based `id`, this field contains
   * the parent's UUID.
   *
   * If a migration ever changes a parent comment's `id`, all replies'
   * `parentCommentId` values must be updated atomically, or the threading
   * relationship will be broken.
   */
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

/**
 * Safely parses comment data from various formats.
 *
 * DatoCMS stores JSON fields as strings in the API, but the subscription
 * might return them as parsed objects. This function handles both cases.
 *
 * IMPORTANT: This function validates the parsed data structure to prevent
 * silent data loss. Previously, JSON parsing failures or malformed data
 * would silently return an empty array, potentially losing valid comments.
 * Now we log errors when parsing fails so issues are visible in production.
 *
 * DESIGN DECISION - WHY RETURN EMPTY ARRAY INSTEAD OF ERROR STATE:
 * Returning an empty array on error (instead of a result object with error state)
 * is a deliberate tradeoff:
 *
 * PROS of current approach:
 * - Simple return type (CommentType[]) that all callers already handle
 * - Graceful degradation: UI shows "no comments" rather than crashing
 * - Errors are logged for debugging but don't block the application
 * - Works seamlessly with optimistic UI and subscription syncing
 *
 * CONS of current approach:
 * - Users can't distinguish "no comments" from "failed to load"
 * - Silent degradation might mask data corruption issues
 *
 * ALTERNATIVE (not implemented due to breaking changes):
 * Return a tagged union: { type: 'success', comments: CommentType[] } | { type: 'error', message: string }
 * This would require updating all callers (useCommentsSubscription, useCommentsData, etc.)
 *
 * For now, the logging-based approach is sufficient. Production error tracking
 * (e.g., Sentry) can be integrated in logError() to surface parsing failures.
 *
 * @param content - Raw content from API (string, array, or null/undefined)
 * @returns Validated CommentType[] or empty array if content is empty/null
 */
export function parseComments(content: unknown): CommentType[] {
  // Empty/null content is valid - no comments exist yet
  if (!content) return [];

  // If already an array, validate its structure
  if (Array.isArray(content)) {
    if (!isValidCommentArray(content)) {
      // SECURITY NOTE: We intentionally do NOT log content samples here.
      // Comment content may contain sensitive information (mentions of users,
      // records, etc.) that should not appear in logs or error tracking systems.
      // We log only structural metadata to aid debugging without exposing content.
      logError('parseComments: Array content failed validation - possible data corruption', undefined, {
        arrayLength: content.length,
        firstItemType: content.length > 0 ? typeof content[0] : 'empty',
        hasNestedArrays: content.some(item => Array.isArray(item)),
      });
      // Return empty to prevent corrupt data from propagating
      // This is safer than returning potentially malformed comments
      return [];
    }
    return content as CommentType[];
  }

  // Parse JSON string content
  if (typeof content === 'string') {
    try {
      const parsed: unknown = JSON.parse(content);

      // Validate the parsed structure matches CommentType[]
      if (!isValidCommentArray(parsed)) {
        // SECURITY NOTE: We log only structural metadata, not content samples.
        // See comment in array validation block above for rationale.
        logError('parseComments: Parsed JSON failed validation - possible data corruption', undefined, {
          contentLength: content.length,
          parsedType: typeof parsed,
          isArray: Array.isArray(parsed),
          parsedLength: Array.isArray(parsed) ? parsed.length : undefined,
        });
        return [];
      }

      return parsed as CommentType[];
    } catch (error) {
      // Log the parsing error - this could indicate data corruption.
      // SECURITY NOTE: We log only structural metadata, not content samples.
      // See comment in array validation block above for rationale.
      logError('parseComments: JSON parsing failed - content is not valid JSON', error, {
        contentLength: content.length,
        startsWithBracket: content.startsWith('[') || content.startsWith('{'),
        containsNullBytes: content.includes('\0'),
      });
      return [];
    }
  }

  // Unexpected content type
  logError('parseComments: Unexpected content type', undefined, {
    contentType: typeof content,
  });
  return [];
}

/**
 * Check if comment content is empty
 */
export function isContentEmpty(content: CommentSegment[]): boolean {
  if (content.length === 0) return true;
  return content.every(
    (seg) => seg.type === 'text' && seg.content.trim() === ''
  );
}

/**
 * Props for comments data management, typically lifted to parent component.
 * Used for components that need to interact with the comments state.
 */
export type CommentsDataProps = {
  /** Current list of comments */
  comments: CommentType[];
  /** Filtered comments based on search/filter criteria */
  filteredComments: CommentType[];
  /** State setter for updating comments */
  setComments: React.Dispatch<React.SetStateAction<CommentType[]>>;
  /** ID of the model storing comment records */
  commentsModelId: string | null;
  /** ID of the comment record */
  commentRecordId: string | null;
  /** Setter for the comment record ID */
  setCommentRecordId: (id: string | null) => void;
};
