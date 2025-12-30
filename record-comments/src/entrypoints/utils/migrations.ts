import type { Upvoter } from '@ctypes/comments';

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

/** Normalizes legacy upvoter format (email strings) to { name, email } objects. */
export function normalizeUpvoters(upvoters: (string | Upvoter)[]): Upvoter[] {
  if (!upvoters || !Array.isArray(upvoters)) return [];
  return upvoters.map((upvoter) => {
    if (typeof upvoter !== 'string') return upvoter;
    const email = upvoter;
    const derivedName = email.includes('@') ? email.split('@')[0] : email;
    return { name: derivedName, email };
  });
}

export function normalizeComment(comment: LegacyComment): NormalizedComment {
  const { parentCommentISO, ...rest } = comment;
  return {
    ...rest,
    usersWhoUpvoted: normalizeUpvoters(comment.usersWhoUpvoted),
    replies: comment.replies?.map(normalizeComment),
    ...(parentCommentISO !== undefined && { parentCommentId: parentCommentISO }),
  };
}

type CommentWithId = NormalizedComment & { id?: string };
type MigratedComment = NormalizedComment & { id: string };

/** Legacy: id missing, equals dateISO, or is ISO timestamp. */
export function isLegacyIdFormat(comment: CommentWithId): boolean {
  if (!comment.id) return true;
  if (comment.id === comment.dateISO) return true;

  const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  return isoPattern.test(comment.id);
}

/** Migrates legacy IDs to UUIDs and updates parentCommentId references. */
export function migrateCommentId(
  comment: CommentWithId,
  parentIdMap: Map<string, string> = new Map()
): MigratedComment {
  const oldId = comment.id ?? comment.dateISO;
  const needsMigration = isLegacyIdFormat(comment);
  const newId = needsMigration ? crypto.randomUUID() : oldId;

  if (needsMigration && oldId) {
    parentIdMap.set(oldId, newId);
  }

  let updatedParentCommentId = comment.parentCommentId;
  if (comment.parentCommentId && parentIdMap.has(comment.parentCommentId)) {
    updatedParentCommentId = parentIdMap.get(comment.parentCommentId);
  }

  const migratedReplies = comment.replies?.map((reply) => {
    const replyWithUpdatedParent: CommentWithId = {
      ...reply,
      parentCommentId: reply.parentCommentId === oldId ? newId : reply.parentCommentId,
    };
    return migrateCommentId(replyWithUpdatedParent, parentIdMap);
  });

  return {
    ...comment,
    id: newId,
    ...(updatedParentCommentId !== undefined && { parentCommentId: updatedParentCommentId }),
    ...(migratedReplies && { replies: migratedReplies }),
  };
}

export function migrateCommentsToUuid(comments: CommentWithId[]): {
  comments: MigratedComment[];
  wasMigrated: boolean;
} {
  const needsMigration = comments.some(
    (comment) =>
      isLegacyIdFormat(comment) ||
      comment.replies?.some(isLegacyIdFormat)
  );

  if (!needsMigration) {
    return { comments: comments as MigratedComment[], wasMigrated: false };
  }

  const parentIdMap = new Map<string, string>();
  const migratedComments = comments.map((comment) =>
    migrateCommentId(comment, parentIdMap)
  );

  return { comments: migratedComments, wasMigrated: true };
}
