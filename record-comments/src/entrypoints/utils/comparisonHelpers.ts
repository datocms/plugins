import type { CommentSegment, Mention } from '@ctypes/mentions';
import {
  isUserMention,
  isFieldMention,
  isAssetMention,
  isRecordMention,
  isModelMention,
} from '@ctypes/mentions';
import type { CommentType, Upvoter } from '@ctypes/comments';

/**
 * Compare two mentions for equality.
 * Compares all relevant fields to detect metadata changes (name, title, url, etc.)
 * not just the unique identifier.
 *
 * Exported for use by MentionDisplay.tsx's React.memo comparator.
 * Uses type guards for proper type narrowing without unsafe casts.
 */
export function areMentionsEqual(a: Mention, b: Mention): boolean {
  if (a.type !== b.type) return false;

  // Use type guards for proper type narrowing without unsafe casts
  if (isUserMention(a) && isUserMention(b)) {
    return (
      a.id === b.id &&
      a.name === b.name &&
      a.email === b.email &&
      a.avatarUrl === b.avatarUrl
    );
  }

  if (isFieldMention(a) && isFieldMention(b)) {
    return (
      a.fieldPath === b.fieldPath &&
      a.locale === b.locale &&
      a.apiKey === b.apiKey &&
      a.label === b.label &&
      a.localized === b.localized &&
      a.fieldType === b.fieldType
    );
  }

  if (isAssetMention(a) && isAssetMention(b)) {
    return (
      a.id === b.id &&
      a.filename === b.filename &&
      a.url === b.url &&
      a.thumbnailUrl === b.thumbnailUrl &&
      a.mimeType === b.mimeType
    );
  }

  if (isRecordMention(a) && isRecordMention(b)) {
    return (
      a.id === b.id &&
      a.title === b.title &&
      a.modelId === b.modelId &&
      a.modelApiKey === b.modelApiKey &&
      a.modelName === b.modelName &&
      a.modelEmoji === b.modelEmoji &&
      a.thumbnailUrl === b.thumbnailUrl &&
      a.isSingleton === b.isSingleton
    );
  }

  if (isModelMention(a) && isModelMention(b)) {
    return (
      a.id === b.id &&
      a.apiKey === b.apiKey &&
      a.name === b.name &&
      a.isBlockModel === b.isBlockModel
    );
  }

  // Types match but no specific handler - shouldn't happen with exhaustive checks
  return false;
}

/**
 * Compare two comment segments for equality.
 * More efficient than JSON.stringify for simple text/mention comparisons.
 */
function areSegmentItemsEqual(a: CommentSegment, b: CommentSegment): boolean {
  if (a.type !== b.type) return false;

  // After the type check, we know both have the same type
  // Use explicit narrowing for both values
  if (a.type === 'text' && b.type === 'text') {
    return a.content === b.content;
  }

  // Both are mentions (a.type === 'mention' && b.type === 'mention')
  if (a.type === 'mention' && b.type === 'mention') {
    return areMentionsEqual(a.mention, b.mention);
  }

  return false;
}

/**
 * Compare two arrays of comment segments for equality.
 * Performs length check first, then element-wise comparison.
 */
export function areSegmentsEqual(
  a: CommentSegment[],
  b: CommentSegment[]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (!areSegmentItemsEqual(a[i], b[i])) return false;
  }

  return true;
}

/**
 * Compare two arrays of upvoters for equality.
 * Email is the unique identifier for upvoters.
 */
export function areUpvotersEqual(a: Upvoter[], b: Upvoter[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i].email !== b[i].email) return false;
  }

  return true;
}

/**
 * Maximum recursion depth for reply comparison.
 *
 * This safeguard prevents potential stack overflow from deeply nested replies.
 * In practice, DatoCMS UI and typical usage patterns rarely exceed 3-4 levels
 * of nesting. A limit of 20 is generous while still providing protection against
 * pathological data or circular reference bugs that escape the type system.
 *
 * If this limit is reached, the function returns `false` (safe default: assumes
 * the replies are different, which may trigger unnecessary re-renders but won't
 * crash the application).
 */
const MAX_REPLY_RECURSION_DEPTH = 20;

/**
 * Compare two arrays of replies for equality.
 * Uses `id` as the unique identifier (NOT dateISO, which is for display only).
 * Also checks content, upvotes, and nested replies for changes.
 *
 * @param a - First reply array
 * @param b - Second reply array
 * @param depth - Current recursion depth (internal use only)
 * @returns true if replies are equal, false otherwise
 */
export function areRepliesEqual(
  a: CommentType[] | undefined,
  b: CommentType[] | undefined,
  depth = 0
): boolean {
  // Safeguard against excessive recursion depth
  if (depth > MAX_REPLY_RECURSION_DEPTH) {
    // Return false as a safe default - better to re-render than to crash
    return false;
  }

  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const replyA = a[i];
    const replyB = b[i];

    // Compare unique identifier - use `id` field, not `dateISO`
    // The `id` field is the canonical identifier (UUID for new comments,
    // dateISO for legacy comments). See types/comments.ts for details.
    if (replyA.id !== replyB.id) return false;

    // Compare content
    if (!areSegmentsEqual(replyA.content, replyB.content)) return false;

    // Compare upvoters
    if (!areUpvotersEqual(replyA.usersWhoUpvoted, replyB.usersWhoUpvoted)) {
      return false;
    }

    // Recursively compare nested replies (replies can have replies)
    if (!areRepliesEqual(replyA.replies, replyB.replies, depth + 1)) {
      return false;
    }
  }

  return true;
}

/**
 * Compare two comment objects for equality.
 * Performs targeted comparisons rather than full JSON serialization.
 * Uses `id` as the canonical unique identifier (NOT dateISO).
 */
export function areCommentsEqual(a: CommentType, b: CommentType): boolean {
  if (a === b) return true;

  // Compare unique identifier - use `id` field, not `dateISO`
  // The `id` field is the canonical identifier (UUID for new comments,
  // dateISO for legacy comments). See types/comments.ts for details.
  if (a.id !== b.id) return false;

  // Compare author (email is the stable identifier)
  if (a.author.email !== b.author.email) return false;

  // Compare content segments
  if (!areSegmentsEqual(a.content, b.content)) return false;

  // Compare upvoters
  if (!areUpvotersEqual(a.usersWhoUpvoted, b.usersWhoUpvoted)) return false;

  // Compare replies (for top-level comments)
  if (!areRepliesEqual(a.replies, b.replies)) return false;

  return true;
}
