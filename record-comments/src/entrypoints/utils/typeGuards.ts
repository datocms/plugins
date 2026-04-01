// Primitive attribute helpers

function isStringAttr(value: unknown): value is string {
  return typeof value === 'string';
}

function isNullableStringAttr(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** TipTap stores defaults as null, so accept null for optional attrs. */
function isOptionalStringAttr(
  value: unknown,
): value is string | undefined | null {
  return value === undefined || value === null || typeof value === 'string';
}

/** TipTap omits attrs matching defaults, so booleans defaulting to false may be undefined. */
function isOptionalBooleanAttr(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

export function isValidUserMentionAttrs(
  attrs: Record<string, unknown>,
): attrs is Record<string, unknown> & {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
} {
  return (
    isStringAttr(attrs.id) &&
    isStringAttr(attrs.name) &&
    isStringAttr(attrs.email) &&
    isNullableStringAttr(attrs.avatarUrl)
  );
}

export function isValidFieldMentionAttrs(
  attrs: Record<string, unknown>,
): attrs is Record<string, unknown> & {
  apiKey: string;
  label: string;
  localized?: boolean;
  fieldPath: string;
  locale?: string;
  fieldType?: string;
} {
  return (
    isStringAttr(attrs.apiKey) &&
    isStringAttr(attrs.label) &&
    isOptionalBooleanAttr(attrs.localized) &&
    isStringAttr(attrs.fieldPath) &&
    isOptionalStringAttr(attrs.locale) &&
    isOptionalStringAttr(attrs.fieldType)
  );
}

export function isValidAssetMentionAttrs(
  attrs: Record<string, unknown>,
): attrs is Record<string, unknown> & {
  id: string;
  filename: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
} {
  return (
    isStringAttr(attrs.id) &&
    isStringAttr(attrs.filename) &&
    isStringAttr(attrs.url) &&
    isNullableStringAttr(attrs.thumbnailUrl) &&
    isStringAttr(attrs.mimeType)
  );
}

export function isValidRecordMentionAttrs(
  attrs: Record<string, unknown>,
): attrs is Record<string, unknown> & {
  id: string;
  title: string;
  modelId: string;
  modelApiKey: string;
  modelName: string;
  modelEmoji: string | null;
  thumbnailUrl: string | null;
  isSingleton?: boolean;
} {
  return (
    isStringAttr(attrs.id) &&
    isStringAttr(attrs.title) &&
    isStringAttr(attrs.modelId) &&
    isStringAttr(attrs.modelApiKey) &&
    isStringAttr(attrs.modelName) &&
    isNullableStringAttr(attrs.modelEmoji) &&
    isNullableStringAttr(attrs.thumbnailUrl) &&
    isOptionalBooleanAttr(attrs.isSingleton)
  );
}

export function isValidModelMentionAttrs(
  attrs: Record<string, unknown>,
): attrs is Record<string, unknown> & {
  id: string;
  apiKey: string;
  name: string;
  isBlockModel?: boolean;
} {
  return (
    isStringAttr(attrs.id) &&
    isStringAttr(attrs.apiKey) &&
    isStringAttr(attrs.name) &&
    isOptionalBooleanAttr(attrs.isBlockModel)
  );
}

export function isValidISOString(value: string): boolean {
  if (!value || typeof value !== 'string') return false;

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;

  try {
    return new Date(parsed).toISOString().length > 0;
  } catch {
    return false;
  }
}

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validates authorId is a non-empty string */
export function isValidAuthorId(authorId: unknown): authorId is string {
  return isStringAttr(authorId) && authorId.length > 0;
}

/** Validates upvoterIds is an array of strings */
function isValidUpvoterIds(upvoterIds: unknown): upvoterIds is string[] {
  if (!Array.isArray(upvoterIds)) return false;
  return upvoterIds.every((id) => isStringAttr(id));
}

function isValidStoredUserMention(mention: Record<string, unknown>): boolean {
  return mention.type === 'user' && isStringAttr(mention.id);
}

function isValidStoredFieldMention(mention: Record<string, unknown>): boolean {
  return (
    mention.type === 'field' &&
    isStringAttr(mention.fieldPath) &&
    isStringAttr(mention.modelId) &&
    isOptionalStringAttr(mention.locale)
  );
}

function isValidStoredAssetMention(mention: Record<string, unknown>): boolean {
  return mention.type === 'asset' && isStringAttr(mention.id);
}

function isValidStoredRecordMention(mention: Record<string, unknown>): boolean {
  return (
    mention.type === 'record' &&
    isStringAttr(mention.id) &&
    isStringAttr(mention.modelId)
  );
}

function isValidStoredModelMention(mention: Record<string, unknown>): boolean {
  return mention.type === 'model' && isStringAttr(mention.id);
}

export function isValidStoredMention(mention: unknown): boolean {
  if (!isNonNullObject(mention)) return false;

  return (
    isValidStoredUserMention(mention) ||
    isValidStoredFieldMention(mention) ||
    isValidStoredAssetMention(mention) ||
    isValidStoredRecordMention(mention) ||
    isValidStoredModelMention(mention)
  );
}

function isValidCommentSegment(segment: unknown): boolean {
  if (!isNonNullObject(segment)) return false;

  if (segment.type === 'text') {
    return isStringAttr(segment.content);
  }

  if (segment.type === 'mention') {
    return isValidStoredMention(segment.mention);
  }

  return false;
}

function isValidCommentBaseFields(comment: Record<string, unknown>): boolean {
  return (
    isStringAttr(comment.id) &&
    isStringAttr(comment.dateISO) &&
    isValidISOString(comment.dateISO) &&
    isValidAuthorId(comment.authorId)
  );
}

function isValidCommentContentSegments(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.every((segment) => isValidCommentSegment(segment));
}

function isValidCommentOptionalFields(
  comment: Record<string, unknown>,
): boolean {
  const parentIdIsValid =
    comment.parentCommentId === undefined ||
    isStringAttr(comment.parentCommentId);

  return isValidUpvoterIds(comment.upvoterIds) && parentIdIsValid;
}

function isValidCommentReplies(
  replies: unknown,
  visited: WeakSet<object>,
): boolean {
  if (replies === undefined) return true;
  if (!Array.isArray(replies)) return false;
  return replies.every((reply) => isValidComment(reply, visited));
}

/** Uses WeakSet for cycle detection to prevent infinite recursion on malformed data. */
export function isValidComment(
  comment: unknown,
  visited: WeakSet<object> = new WeakSet(),
): boolean {
  if (!isNonNullObject(comment)) return false;
  if (visited.has(comment)) return false;

  visited.add(comment);

  return (
    isValidCommentBaseFields(comment) &&
    isValidCommentContentSegments(comment.content) &&
    isValidCommentOptionalFields(comment) &&
    isValidCommentReplies(comment.replies, visited)
  );
}

export function isValidCommentArray(data: unknown): boolean {
  if (!Array.isArray(data)) return false;
  return data.every((comment) => isValidComment(comment));
}
