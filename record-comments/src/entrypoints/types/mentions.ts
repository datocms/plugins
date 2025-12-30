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

export type BlockFieldType = 'modular_content' | 'structured_text' | 'single_block' | 'rich_text';

export type Mention =
  | UserMention
  | FieldMention
  | AssetMention
  | RecordMention
  | ModelMention;

export type CommentSegment =
  | { type: 'text'; content: string }
  | { type: 'mention'; mention: Mention };

// Keys prefixed to avoid collisions: "user:123", "field:title", etc.
export type MentionMapKey = `user:${string}` | `field:${string}` | `asset:${string}` | `record:${string}` | `model:${string}`;

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

export function createMentionKey(mention: Mention): MentionMapKey {
  switch (mention.type) {
    case 'user':
      return `user:${mention.id}`;
    case 'field': {
      const fieldPath = mention.fieldPath ?? mention.apiKey;
      // Encode dots as double colons (sections.0.hero_title -> sections::0::hero_title)
      const encodedPath = fieldPath.replace(/\./g, '::');
      // Add locale suffix unless already embedded in path (e.g., sections::it::0::hero_title)
      const localeAlreadyInPath = mention.locale && encodedPath.includes(`::${mention.locale}::`);
      const localeKey = (mention.locale && !localeAlreadyInPath) ? `::${mention.locale}` : '';
      return `field:${encodedPath}${localeKey}` as MentionMapKey;
    }
    case 'asset':
      return `asset:${mention.id}`;
    case 'record':
      return `record:${mention.id}`;
    case 'model':
      return `model:${mention.id}`;
  }
}




