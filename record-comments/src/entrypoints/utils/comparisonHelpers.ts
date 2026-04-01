import type { ResolvedAuthor, ResolvedCommentType } from '@ctypes/comments';
import type { CommentSegment, Mention } from '@ctypes/mentions';
import {
  isAssetMention,
  isFieldMention,
  isModelMention,
  isRecordMention,
  isUserMention,
} from '@ctypes/mentions';

function areUserMentionsEqual(
  a: Extract<Mention, { type: 'user' }>,
  b: Extract<Mention, { type: 'user' }>,
): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.email === b.email &&
    a.avatarUrl === b.avatarUrl
  );
}

function areFieldMentionsEqual(
  a: Extract<Mention, { type: 'field' }>,
  b: Extract<Mention, { type: 'field' }>,
): boolean {
  return (
    a.fieldPath === b.fieldPath &&
    a.locale === b.locale &&
    a.apiKey === b.apiKey &&
    a.label === b.label &&
    a.localized === b.localized &&
    a.fieldType === b.fieldType
  );
}

function areAssetMentionsEqual(
  a: Extract<Mention, { type: 'asset' }>,
  b: Extract<Mention, { type: 'asset' }>,
): boolean {
  return (
    a.id === b.id &&
    a.filename === b.filename &&
    a.url === b.url &&
    a.thumbnailUrl === b.thumbnailUrl &&
    a.mimeType === b.mimeType
  );
}

function areRecordMentionsEqual(
  a: Extract<Mention, { type: 'record' }>,
  b: Extract<Mention, { type: 'record' }>,
): boolean {
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

function areModelMentionsEqual(
  a: Extract<Mention, { type: 'model' }>,
  b: Extract<Mention, { type: 'model' }>,
): boolean {
  return (
    a.id === b.id &&
    a.apiKey === b.apiKey &&
    a.name === b.name &&
    a.isBlockModel === b.isBlockModel
  );
}

/** Compares all mention fields (not just ID) to detect metadata changes. */
export function areMentionsEqual(a: Mention, b: Mention): boolean {
  if (a.type !== b.type) return false;

  if (isUserMention(a) && isUserMention(b)) {
    return areUserMentionsEqual(a, b);
  }

  if (isFieldMention(a) && isFieldMention(b)) {
    return areFieldMentionsEqual(a, b);
  }

  if (isAssetMention(a) && isAssetMention(b)) {
    return areAssetMentionsEqual(a, b);
  }

  if (isRecordMention(a) && isRecordMention(b)) {
    return areRecordMentionsEqual(a, b);
  }

  if (isModelMention(a) && isModelMention(b)) {
    return areModelMentionsEqual(a, b);
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
  b: CommentSegment[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (!areSegmentItemsEqual(a[i], b[i])) return false;
  }

  return true;
}

export function areUpvotersEqual(
  a: ResolvedAuthor[],
  b: ResolvedAuthor[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i].email !== b[i].email) return false;
  }

  return true;
}

// Stack overflow protection for deeply nested replies (returns false if exceeded)
const MAX_REPLY_RECURSION_DEPTH = 20;

function areSingleRepliesEqual(
  replyA: ResolvedCommentType,
  replyB: ResolvedCommentType,
  depth: number,
): boolean {
  if (replyA.id !== replyB.id) return false;
  if (!areSegmentsEqual(replyA.content, replyB.content)) return false;
  if (!areUpvotersEqual(replyA.upvoters, replyB.upvoters)) return false;
  return areRepliesEqual(replyA.replies, replyB.replies, depth + 1);
}

/** Uses `id` as identifier (NOT dateISO). Also checks content, upvotes, nested replies. */
export function areRepliesEqual(
  a: ResolvedCommentType[] | undefined,
  b: ResolvedCommentType[] | undefined,
  depth = 0,
): boolean {
  if (depth > MAX_REPLY_RECURSION_DEPTH) {
    return false;
  }

  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (!areSingleRepliesEqual(a[i], b[i], depth)) return false;
  }

  return true;
}

/** Uses `id` as canonical identifier (NOT dateISO). */
export function areCommentsEqual(
  a: ResolvedCommentType,
  b: ResolvedCommentType,
): boolean {
  if (a === b) return true;
  if (a.id !== b.id) return false;
  if (a.author.email !== b.author.email) return false;
  if (!areSegmentsEqual(a.content, b.content)) return false;
  if (!areUpvotersEqual(a.upvoters, b.upvoters)) return false;
  if (!areRepliesEqual(a.replies, b.replies)) return false;
  return true;
}
