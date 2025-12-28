/**
 * Type Guards for Runtime Type Validation
 *
 * These guards validate unknown data at runtime, enabling safe type narrowing
 * without using unsafe type assertions like `as SomeType`.
 */

// ============================================================================
// Primitive Attribute Guards (internal helpers, not exported)
// ============================================================================

/**
 * Checks if a value is a string.
 */
function isStringAttr(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Checks if a value is a string or null.
 */
function isNullableStringAttr(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * Checks if a value is a string, undefined, or null.
 * TipTap stores default values as null, so we need to accept null for optional attrs.
 */
function isOptionalStringAttr(value: unknown): value is string | undefined | null {
  return value === undefined || value === null || typeof value === 'string';
}

/**
 * Checks if a value is a boolean or undefined.
 */
function isOptionalBooleanAttr(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

// ============================================================================
// Mention Attribute Guards (for TipTap serialization)
// ============================================================================

/**
 * Validates attributes for a UserMention.
 */
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

/**
 * Checks if a value is a boolean or undefined.
 * Used for attributes that have a boolean default in TipTap - when the value
 * matches the default, TipTap may not store it, resulting in undefined.
 */
function isOptionalBooleanAttrForTipTap(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

/**
 * Validates attributes for a FieldMention.
 *
 * Note: `localized` is optional because TipTap doesn't store attributes that match
 * their default value. Since `localized` defaults to `false` in the schema, non-localized
 * fields will have `localized: undefined` when read from TipTap attrs.
 */
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

/**
 * Validates attributes for an AssetMention.
 */
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

/**
 * Validates attributes for a RecordMention.
 */
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

/**
 * Validates attributes for a ModelMention.
 *
 * Note: `isBlockModel` is optional because TipTap doesn't store attributes that match
 * their default value. Since `isBlockModel` defaults to `false` in the schema, non-block
 * models will have `isBlockModel: undefined` when read from TipTap attrs.
 */
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


// ============================================================================
// Comment Validation Guards
// ============================================================================

/**
 * Validates an ISO 8601 date string.
 */
export function isValidISOString(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return false;
  }

  // Additional check: the parsed date should produce a valid ISO string
  try {
    const date = new Date(parsed);
    return date.toISOString().length > 0;
  } catch {
    return false;
  }
}

/**
 * Checks if a value is a non-null object (Record-like).
 * Used as a type guard to safely narrow unknown to Record<string, unknown>.
 */
function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates that a value is a valid author object.
 */
export function isValidAuthor(
  author: unknown
): author is { name: string; email: string } {
  if (!isNonNullObject(author)) {
    return false;
  }

  // After isNonNullObject guard, author is narrowed to Record<string, unknown>
  return isStringAttr(author.name) && isStringAttr(author.email);
}

/**
 * Validates that a value is a valid Upvoter object.
 */
function isValidUpvoter(upvoter: unknown): upvoter is { name: string; email: string } {
  return isValidAuthor(upvoter);
}

/**
 * Validates that a value is a valid CommentSegment.
 *
 * A CommentSegment is either a text segment or a mention segment.
 * We do minimal validation here - just checking the discriminator and basic structure.
 */
function isValidCommentSegment(segment: unknown): boolean {
  if (!isNonNullObject(segment)) {
    return false;
  }

  // After isNonNullObject guard, segment is narrowed to Record<string, unknown>
  if (segment.type === 'text') {
    return isStringAttr(segment.content);
  }

  if (segment.type === 'mention') {
    // Just validate that mention exists and has a type - full mention validation
    // is complex and the existing mention type guards cover that if needed
    return segment.mention !== null && typeof segment.mention === 'object';
  }

  return false;
}

/**
 * Validates that a value is a valid CommentType object.
 *
 * This validates the core structure required for a comment:
 * - id (string): Unique identifier
 * - dateISO (string): ISO 8601 timestamp
 * - content (array): Array of CommentSegments
 * - author (object): { name, email }
 * - usersWhoUpvoted (array): Array of upvoters
 * - replies (optional array): Nested comments
 * - parentCommentId (optional string): Reference to parent for replies
 *
 * CYCLE DETECTION:
 * The function uses a WeakSet to track already-visited objects and prevent
 * infinite recursion if replies accidentally contain circular references.
 * This is a defensive measure - properly formatted comments should never
 * have cycles, but malformed data shouldn't crash the validation.
 */
export function isValidComment(comment: unknown, visited: WeakSet<object> = new WeakSet()): boolean {
  if (!isNonNullObject(comment)) {
    return false;
  }

  // Cycle detection: if we've already seen this object, it's a circular reference
  if (visited.has(comment)) {
    return false;
  }
  visited.add(comment);

  // After isNonNullObject guard, comment is narrowed to Record<string, unknown>

  // Required string fields
  if (!isStringAttr(comment.id)) return false;
  if (!isStringAttr(comment.dateISO)) return false;
  if (!isValidISOString(comment.dateISO)) return false;

  // Required author object
  if (!isValidAuthor(comment.author)) return false;

  // Required content array (can be empty, but must be an array)
  if (!Array.isArray(comment.content)) return false;
  // Validate each segment in content
  for (const segment of comment.content) {
    if (!isValidCommentSegment(segment)) return false;
  }

  // Required usersWhoUpvoted array (can be empty)
  if (!Array.isArray(comment.usersWhoUpvoted)) return false;
  // Validate each upvoter
  for (const upvoter of comment.usersWhoUpvoted) {
    if (!isValidUpvoter(upvoter)) return false;
  }

  // Optional fields
  if (comment.parentCommentId !== undefined && !isStringAttr(comment.parentCommentId)) {
    return false;
  }

  // Optional replies array - if present, must contain valid comments (recursive)
  // Pass the visited Set to detect cycles in deeply nested replies
  if (comment.replies !== undefined) {
    if (!Array.isArray(comment.replies)) return false;
    for (const reply of comment.replies) {
      if (!isValidComment(reply, visited)) return false;
    }
  }

  return true;
}

/**
 * Validates that an array contains valid CommentType objects.
 *
 * Returns true only if ALL elements in the array are valid comments.
 * Used to validate parsed JSON before treating it as CommentType[].
 */
export function isValidCommentArray(data: unknown): boolean {
  if (!Array.isArray(data)) {
    return false;
  }

  for (const comment of data) {
    if (!isValidComment(comment)) {
      return false;
    }
  }

  return true;
}
