// User mention - stores complete user info
export type UserMention = {
  type: 'user';
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

// Field mention - stores field metadata
export type FieldMention = {
  type: 'field';
  apiKey: string;
  label: string;
  localized: boolean;
  fieldPath: string; // Full path: "title" or "blocks.0.heading"
  locale?: string;   // Selected locale for localized fields (e.g., "en", "it")
  fieldType?: string; // Editor type from appearance.editor (e.g., "single_line", "structured_text")
};

// Asset mention - stores upload/media info
export type AssetMention = {
  type: 'asset';
  id: string;
  filename: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
};

// Record mention - stores record reference with model context
export type RecordMention = {
  type: 'record';
  id: string;
  title: string;
  modelId: string;
  modelApiKey: string;
  modelName: string;
  modelEmoji: string | null;
  thumbnailUrl: string | null;
};

// Model mention - stores model/content type info
export type ModelMention = {
  type: 'model';
  id: string;
  apiKey: string;
  name: string;
  isBlockModel: boolean;
};

// Union of all mention types
export type Mention =
  | UserMention
  | FieldMention
  | AssetMention
  | RecordMention
  | ModelMention;

// A segment is either plain text or a mention
export type CommentSegment =
  | { type: 'text'; content: string }
  | { type: 'mention'; mention: Mention };

// Helper type for the mentions map - keys are prefixed to avoid collisions
// e.g., "user:123", "field:title", "asset:abc123"
export type MentionMapKey = `user:${string}` | `field:${string}` | `asset:${string}` | `record:${string}` | `model:${string}`;

// Type guard functions for narrowing mention types
export function isUserMention(mention: Mention): mention is UserMention {
  return mention.type === 'user';
}

export function isFieldMention(mention: Mention): mention is FieldMention {
  return mention.type === 'field';
}

export function isAssetMention(mention: Mention): mention is AssetMention {
  return mention.type === 'asset';
}

export function isRecordMention(mention: Mention): mention is RecordMention {
  return mention.type === 'record';
}

export function isModelMention(mention: Mention): mention is ModelMention {
  return mention.type === 'model';
}

// Helper to create mention map keys
export function createMentionKey(mention: Mention): MentionMapKey {
  switch (mention.type) {
    case 'user':
      return `user:${mention.id}`;
    case 'field': {
      // Use fieldPath as key since it uniquely identifies nested fields
      // Fallback to apiKey for backwards compatibility with old mentions
      // Include locale for localized fields to allow mentioning same field in different locales
      const fieldPath = mention.fieldPath ?? mention.apiKey;
      const localeKey = mention.locale ? `.${mention.locale}` : '';
      return `field:${fieldPath}${localeKey}`;
    }
    case 'asset':
      return `asset:${mention.id}`;
    case 'record':
      return `record:${mention.id}`;
    case 'model':
      return `model:${mention.id}`;
  }
}




