import type { CommentType } from '@ctypes/comments';
import type { CommentSegment, StoredCommentSegment } from '@ctypes/mentions';
import type { MentionEntry, MentionStateContent, MentionStateOperation } from '@ctypes/mentionState';
import { MENTION_STATE_RECORD_PREFIX } from '@/constants';

const EMPTY_STATE: MentionStateContent = {
  unread: [],
  updatedAt: new Date(0).toISOString(),
};

export function buildMentionStateRecordId(userId: string): string {
  return `${MENTION_STATE_RECORD_PREFIX}${userId}`;
}

function normalizeMentionStateContent(raw: unknown): MentionStateContent {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_STATE };
  }

  const content = raw as Partial<MentionStateContent>;
  const unread = Array.isArray(content.unread) ? content.unread : [];
  const updatedAt = typeof content.updatedAt === 'string' ? content.updatedAt : new Date(0).toISOString();

  return { unread, updatedAt };
}

export function parseMentionStateContent(raw: unknown): MentionStateContent {
  if (typeof raw === 'string') {
    try {
      return normalizeMentionStateContent(JSON.parse(raw));
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  return normalizeMentionStateContent(raw);
}

export function applyMentionStateOperation(
  content: MentionStateContent,
  op: MentionStateOperation
): { content: MentionStateContent; changed: boolean } {
  const existing = new Map<string, MentionEntry>();

  for (const entry of content.unread) {
    if (entry && typeof entry.key === 'string') {
      existing.set(entry.key, entry);
    }
  }

  let changed = false;

  if (op.additions) {
    for (const entry of op.additions) {
      if (!entry || typeof entry.key !== 'string') continue;
      if (!existing.has(entry.key)) {
        existing.set(entry.key, entry);
        changed = true;
      }
    }
  }

  if (op.removals) {
    for (const key of op.removals) {
      if (existing.delete(key)) {
        changed = true;
      }
    }
  }

  const nextUnread = Array.from(existing.values());
  const nextContent: MentionStateContent = {
    unread: nextUnread,
    updatedAt: changed ? new Date().toISOString() : content.updatedAt,
  };

  return { content: nextContent, changed };
}

export function extractMentionedUserIds(
  segments: CommentSegment[] | StoredCommentSegment[]
): string[] {
  const ids = new Set<string>();

  for (const segment of segments) {
    if (segment.type !== 'mention') continue;
    if (segment.mention.type !== 'user') continue;

    const id = segment.mention.id;
    if (typeof id === 'string' && id.trim().length > 0) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

type MentionContext = {
  modelId: string;
  recordId: string;
  isReply?: boolean;
  parentCommentId?: string;
};

export function buildMentionEntriesByUser(
  comment: CommentType,
  context: MentionContext,
  userIds: string[]
): Map<string, MentionEntry[]> {
  const entriesByUser = new Map<string, MentionEntry[]>();
  const uniqueUserIds = Array.from(new Set(userIds)).filter((id) => id.trim().length > 0);

  for (const userId of uniqueUserIds) {
    const entry: MentionEntry = {
      key: `${comment.id}:${userId}`,
      commentId: comment.id,
      recordId: context.recordId,
      modelId: context.modelId,
      createdAt: comment.dateISO,
      authorId: comment.authorId,
      content: comment.content,
      isReply: context.isReply,
      parentCommentId: context.parentCommentId,
    };

    entriesByUser.set(userId, [entry]);
  }

  return entriesByUser;
}
