/**
 * Migration utilities for normalizing legacy comment data formats.
 *
 * These functions handle the transformation of older comment data structures
 * to the current format. They're used by ConfigScreen during migration and
 * can be reused if needed elsewhere.
 */

import type { Upvoter } from '@ctypes/comments';

// Re-export for consumers that import from this module
export type { Upvoter } from '@ctypes/comments';

export type LegacyComment = {
  dateISO: string;
  content: unknown;
  author: { name: string; email: string };
  usersWhoUpvoted: (string | Upvoter)[];
  replies?: LegacyComment[];
  parentCommentISO?: string;
};

export type NormalizedComment = {
  dateISO: string;
  content: unknown;
  author: { name: string; email: string };
  usersWhoUpvoted: Upvoter[];
  replies?: NormalizedComment[];
  parentCommentId?: string;
};

/**
 * Normalizes legacy upvoter format (email strings) to new format ({ name, email }).
 * Legacy format stored upvoters as plain email strings.
 *
 * @param upvoters - Array of upvoters in legacy (string) or current (object) format
 * @returns Array of upvoters in the normalized { name, email } format
 *
 * @example
 * // Legacy format
 * normalizeUpvoters(['user@example.com'])
 * // Returns: [{ name: 'user', email: 'user@example.com' }]
 *
 * @example
 * // Current format (unchanged)
 * normalizeUpvoters([{ name: 'User', email: 'user@example.com' }])
 * // Returns: [{ name: 'User', email: 'user@example.com' }]
 */
export function normalizeUpvoters(upvoters: (string | Upvoter)[]): Upvoter[] {
  if (!upvoters || !Array.isArray(upvoters)) return [];
  return upvoters.map((upvoter) => {
    const isLegacyStringFormat = typeof upvoter === 'string';
    if (!isLegacyStringFormat) {
      return upvoter;
    }
    // Legacy format: upvoter is just an email string
    const email = upvoter;
    const isEmailAddress = email.includes('@');
    const derivedName = isEmailAddress ? email.split('@')[0] : email;
    return { name: derivedName, email };
  });
}

/**
 * Normalizes a comment and its replies to use the new upvoter format.
 * Also renames parentCommentISO to parentCommentId for consistency.
 *
 * This function recursively normalizes nested replies.
 *
 * @param comment - A comment in legacy format
 * @returns The comment normalized to the current format
 */
export function normalizeComment(comment: LegacyComment): NormalizedComment {
  const { parentCommentISO, ...rest } = comment;
  return {
    ...rest,
    usersWhoUpvoted: normalizeUpvoters(comment.usersWhoUpvoted),
    replies: comment.replies?.map(normalizeComment),
    ...(parentCommentISO !== undefined && { parentCommentId: parentCommentISO }),
  };
}
