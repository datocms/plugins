export type UserMention = {
  type: 'user';
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

export type FieldMention = {
  type: 'field';
  apiKey: string;
  label: string;
  localized: boolean;
  fieldPath: string; // e.g. "title" or "blocks.0.heading"
  locale?: string;
  fieldType?: string;
};

export type AssetMention = {
  type: 'asset';
  id: string;
  filename: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
};

export type RecordMention = {
  type: 'record';
  id: string;
  title: string;
  modelId: string;
  modelApiKey: string;
  modelName: string;
  modelEmoji: string | null;
  thumbnailUrl: string | null;
  isSingleton?: boolean;
};

export type ModelMention = {
  type: 'model';
  id: string;
  apiKey: string;
  name: string;
  isBlockModel: boolean;
};

export type BlockInfo = {
  index: number;
  modelId: string;
  modelName: string;
};

export type Mention =
  | UserMention
  | FieldMention
  | AssetMention
  | RecordMention
  | ModelMention;

export type MentionType = Mention['type'];

export type CommentSegment =
  | { type: 'text'; content: string }
  | { type: 'mention'; mention: Mention };

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

// ============================================================================
// Stored (Slim) Mention Types - Used for persistence, contain only IDs
// ============================================================================

export type StoredUserMention = {
  type: 'user';
  id: string;
};

export type StoredFieldMention = {
  type: 'field';
  fieldPath: string;
  locale?: string;
  modelId: string;
};

export type StoredAssetMention = {
  type: 'asset';
  id: string;
};

export type StoredRecordMention = {
  type: 'record';
  id: string;
  modelId: string;
};

export type StoredModelMention = {
  type: 'model';
  id: string;
};

export type StoredMention =
  | StoredUserMention
  | StoredFieldMention
  | StoredAssetMention
  | StoredRecordMention
  | StoredModelMention;

export type StoredCommentSegment =
  | { type: 'text'; content: string }
  | { type: 'mention'; mention: StoredMention };
