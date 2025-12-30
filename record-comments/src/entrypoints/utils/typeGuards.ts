// Primitive attribute helpers

function isStringAttr(value: unknown): value is string {
  return typeof value === 'string';
}

function isNullableStringAttr(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** TipTap stores defaults as null, so accept null for optional attrs. */
function isOptionalStringAttr(value: unknown): value is string | undefined | null {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalBooleanAttr(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

export function isValidUserMentionAttrs(
  attrs: Record<string, unknown>
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

// TipTap omits attrs matching defaults, so booleans defaulting to false may be undefined
function isOptionalBooleanAttrForTipTap(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

export function isValidFieldMentionAttrs(
  attrs: Record<string, unknown>
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
    isOptionalBooleanAttrForTipTap(attrs.localized) &&
    isStringAttr(attrs.fieldPath) &&
    isOptionalStringAttr(attrs.locale) &&
    isOptionalStringAttr(attrs.fieldType)
  );
}

export function isValidAssetMentionAttrs(
  attrs: Record<string, unknown>
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
  attrs: Record<string, unknown>
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
  attrs: Record<string, unknown>
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
    isOptionalBooleanAttrForTipTap(attrs.isBlockModel)
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

export function isValidAuthor(
  author: unknown
): author is { name: string; email: string } {
  if (!isNonNullObject(author)) return false;
  return isStringAttr(author.name) && isStringAttr(author.email);
}

function isValidUpvoter(upvoter: unknown): upvoter is { name: string; email: string } {
  return isValidAuthor(upvoter);
}

function isValidCommentSegment(segment: unknown): boolean {
  if (!isNonNullObject(segment)) return false;

  if (segment.type === 'text') {
    return isStringAttr(segment.content);
  }

  if (segment.type === 'mention') {
    return segment.mention !== null && typeof segment.mention === 'object';
  }

  return false;
}

/** Uses WeakSet for cycle detection to prevent infinite recursion on malformed data. */
export function isValidComment(comment: unknown, visited: WeakSet<object> = new WeakSet()): boolean {
  if (!isNonNullObject(comment)) return false;

  if (visited.has(comment)) return false;
  visited.add(comment);

  if (!isStringAttr(comment.id)) return false;
  if (!isStringAttr(comment.dateISO)) return false;
  if (!isValidISOString(comment.dateISO)) return false;
  if (!isValidAuthor(comment.author)) return false;

  if (!Array.isArray(comment.content)) return false;
  for (const segment of comment.content) {
    if (!isValidCommentSegment(segment)) return false;
  }

  if (!Array.isArray(comment.usersWhoUpvoted)) return false;
  for (const upvoter of comment.usersWhoUpvoted) {
    if (!isValidUpvoter(upvoter)) return false;
  }

  if (comment.parentCommentId !== undefined && !isStringAttr(comment.parentCommentId)) {
    return false;
  }

  if (comment.replies !== undefined) {
    if (!Array.isArray(comment.replies)) return false;
    for (const reply of comment.replies) {
      if (!isValidComment(reply, visited)) return false;
    }
  }

  return true;
}

export function isValidCommentArray(data: unknown): boolean {
  if (!Array.isArray(data)) return false;

  for (const comment of data) {
    if (!isValidComment(comment)) return false;
  }

  return true;
}
