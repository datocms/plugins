// Legacy format types for migration
type LegacyUpvoter = { name: string; email: string };

export type LegacyComment = {
  dateISO: string;
  content: unknown;
  author: { name: string; email: string };
  usersWhoUpvoted: (string | LegacyUpvoter)[];
  replies?: LegacyComment[];
  parentCommentISO?: string;
};

// New slim format after migration
export type NormalizedComment = {
  dateISO: string;
  content: unknown;
  authorEmail: string;
  upvoterEmails: string[];
  replies?: NormalizedComment[];
  parentCommentId?: string;
};

/** Normalizes legacy upvoter format to email strings. */
function normalizeUpvoters(upvoters: unknown): string[] {
  if (!Array.isArray(upvoters)) return [];

  return upvoters.flatMap((upvoter) => {
    if (typeof upvoter === 'string') return upvoter;
    if (
      upvoter &&
      typeof upvoter === 'object' &&
      typeof (upvoter as LegacyUpvoter).email === 'string'
    ) {
      return (upvoter as LegacyUpvoter).email;
    }

    return [];
  });
}

function isLegacyCommentRecord(value: unknown): value is LegacyComment {
  if (!value || typeof value !== 'object') return false;

  const comment = value as Partial<LegacyComment>;
  const hasAuthor =
    !!comment.author &&
    typeof comment.author === 'object' &&
    typeof comment.author.email === 'string';

  if (!hasAuthor || typeof comment.dateISO !== 'string') {
    return false;
  }

  if (
    comment.usersWhoUpvoted !== undefined &&
    !Array.isArray(comment.usersWhoUpvoted)
  ) {
    return false;
  }

  if (comment.replies !== undefined) {
    if (!Array.isArray(comment.replies)) return false;
    return comment.replies.every((reply) => isLegacyCommentRecord(reply));
  }

  return true;
}

export function normalizeComment(comment: LegacyComment): NormalizedComment {
  const { parentCommentISO, author, usersWhoUpvoted, replies, ...rest } = comment;
  return {
    ...rest,
    authorEmail: author.email,
    upvoterEmails: normalizeUpvoters(usersWhoUpvoted),
    replies: replies?.map(normalizeComment),
    ...(parentCommentISO !== undefined && { parentCommentId: parentCommentISO }),
  };
}

export function normalizeCommentIfValid(
  comment: unknown
): NormalizedComment | null {
  if (!isLegacyCommentRecord(comment)) {
    return null;
  }

  return normalizeComment(comment);
}

type CommentWithId = NormalizedComment & { id?: string };
type MigratedComment = NormalizedComment & { id: string };

/** Legacy: id missing, equals dateISO, or is ISO timestamp. */
function isLegacyIdFormat(comment: CommentWithId): boolean {
  if (!comment.id) return true;
  if (comment.id === comment.dateISO) return true;

  const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  return isoPattern.test(comment.id);
}

function treeNeedsMigration(comment: CommentWithId): boolean {
  return (
    isLegacyIdFormat(comment) ||
    comment.replies?.some((reply) => treeNeedsMigration(reply)) === true
  );
}

/** Migrates legacy IDs to UUIDs and updates parentCommentId references. */
function migrateCommentId(
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
  const needsMigration = comments.some((comment) => treeNeedsMigration(comment));

  if (!needsMigration) {
    return { comments: comments as MigratedComment[], wasMigrated: false };
  }

  const parentIdMap = new Map<string, string>();
  const migratedComments = comments.map((comment) =>
    migrateCommentId(comment, parentIdMap)
  );

  return { comments: migratedComments, wasMigrated: true };
}
