import type { CommentSegment, Mention } from '@ctypes/mentions';
import {
  isUserMention,
  isFieldMention,
  isAssetMention,
  isRecordMention,
  isModelMention,
} from '@ctypes/mentions';
import type { CommentType, Upvoter } from '@ctypes/comments';

/** Compares all mention fields (not just ID) to detect metadata changes. */
export function areMentionsEqual(a: Mention, b: Mention): boolean {
  if (a.type !== b.type) return false;

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

  return false;
}

function areSegmentItemsEqual(a: CommentSegment, b: CommentSegment): boolean {
  if (a.type !== b.type) return false;

  if (a.type === 'text' && b.type === 'text') {
    return a.content === b.content;
  }

  if (a.type === 'mention' && b.type === 'mention') {
    return areMentionsEqual(a.mention, b.mention);
  }

  return false;
}

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

export function areUpvotersEqual(a: Upvoter[], b: Upvoter[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i].email !== b[i].email) return false;
  }

  return true;
}

// Stack overflow protection for deeply nested replies (returns false if exceeded)
const MAX_REPLY_RECURSION_DEPTH = 20;

/** Uses `id` as identifier (NOT dateISO). Also checks content, upvotes, nested replies. */
export function areRepliesEqual(
  a: CommentType[] | undefined,
  b: CommentType[] | undefined,
  depth = 0
): boolean {
  if (depth > MAX_REPLY_RECURSION_DEPTH) {
    return false;
  }

  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const replyA = a[i];
    const replyB = b[i];

    if (replyA.id !== replyB.id) return false;
    if (!areSegmentsEqual(replyA.content, replyB.content)) return false;
    if (!areUpvotersEqual(replyA.usersWhoUpvoted, replyB.usersWhoUpvoted)) return false;
    if (!areRepliesEqual(replyA.replies, replyB.replies, depth + 1)) return false;
  }

  return true;
}

/** Uses `id` as canonical identifier (NOT dateISO). */
export function areCommentsEqual(a: CommentType, b: CommentType): boolean {
  if (a === b) return true;
  if (a.id !== b.id) return false;
  if (a.author.email !== b.author.email) return false;
  if (!areSegmentsEqual(a.content, b.content)) return false;
  if (!areUpvotersEqual(a.usersWhoUpvoted, b.usersWhoUpvoted)) return false;
  if (!areRepliesEqual(a.replies, b.replies)) return false;
  return true;
}
