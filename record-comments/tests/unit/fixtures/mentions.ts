import type {
  UserMention,
  FieldMention,
  AssetMention,
  RecordMention,
  ModelMention,
  Mention,
  CommentSegment,
} from '@ctypes/mentions';

export function createUserMention(overrides: Partial<UserMention> = {}): UserMention {
  return {
    type: 'user',
    id: 'user-123',
    name: 'John Doe',
    email: 'john@example.com',
    avatarUrl: 'https://gravatar.com/avatar/abc123',
    ...overrides,
  };
}

export function createFieldMention(overrides: Partial<FieldMention> = {}): FieldMention {
  return {
    type: 'field',
    apiKey: 'title',
    label: 'Title',
    localized: false,
    fieldPath: 'title',
    ...overrides,
  };
}

export function createAssetMention(overrides: Partial<AssetMention> = {}): AssetMention {
  return {
    type: 'asset',
    id: 'asset-456',
    filename: 'image.png',
    url: 'https://cdn.datocms.com/uploads/image.png',
    thumbnailUrl: 'https://cdn.datocms.com/uploads/image.png?w=300',
    mimeType: 'image/png',
    ...overrides,
  };
}

export function createRecordMention(overrides: Partial<RecordMention> = {}): RecordMention {
  return {
    type: 'record',
    id: 'record-789',
    title: 'Sample Record',
    modelId: 'model-123',
    modelApiKey: 'blog_post',
    modelName: 'Blog Post',
    modelEmoji: null,
    thumbnailUrl: null,
    ...overrides,
  };
}

export function createModelMention(overrides: Partial<ModelMention> = {}): ModelMention {
  return {
    type: 'model',
    id: 'model-123',
    apiKey: 'blog_post',
    name: 'Blog Post',
    isBlockModel: false,
    ...overrides,
  };
}

export function createMentionSegment(mention: Mention): CommentSegment {
  return { type: 'mention', mention };
}

export function createTextSegment(content: string): CommentSegment {
  return { type: 'text', content };
}

// Pre-built fixtures for common test scenarios
export const mentionFixtures = {
  // User mentions
  userJohn: createUserMention({
    id: 'user-john',
    name: 'John Doe',
    email: 'john@example.com',
  }),

  userJane: createUserMention({
    id: 'user-jane',
    name: 'Jane Smith',
    email: 'jane@example.com',
    avatarUrl: null,
  }),

  // Field mentions
  titleField: createFieldMention({
    apiKey: 'title',
    label: 'Title',
    fieldPath: 'title',
    localized: false,
  }),

  localizedField: createFieldMention({
    apiKey: 'description',
    label: 'Description',
    fieldPath: 'description',
    localized: true,
    locale: 'en',
  }),

  nestedField: createFieldMention({
    apiKey: 'heading',
    label: 'Heading',
    fieldPath: 'sections.0.heading',
    localized: false,
  }),

  deeplyNestedField: createFieldMention({
    apiKey: 'text',
    label: 'Text',
    fieldPath: 'sections.0.content.1.text',
    localized: true,
    locale: 'en-US',
  }),

  // Asset mentions
  imageAsset: createAssetMention({
    id: 'asset-image',
    filename: 'hero-image.jpg',
    mimeType: 'image/jpeg',
  }),

  documentAsset: createAssetMention({
    id: 'asset-doc',
    filename: 'report.pdf',
    url: 'https://cdn.datocms.com/uploads/report.pdf',
    thumbnailUrl: null,
    mimeType: 'application/pdf',
  }),

  videoAsset: createAssetMention({
    id: 'asset-video',
    filename: 'intro.mp4',
    url: 'https://cdn.datocms.com/uploads/intro.mp4',
    thumbnailUrl: 'https://stream.mux.com/abc123/thumbnail.jpg',
    mimeType: 'video/mp4',
  }),

  // Record mentions
  blogPostRecord: createRecordMention({
    id: 'record-blog',
    title: 'My First Blog Post',
    modelId: 'model-blog',
    modelApiKey: 'blog_post',
    modelName: 'Blog Post',
  }),

  singletonRecord: createRecordMention({
    id: 'record-settings',
    title: 'Site Settings',
    modelId: 'model-settings',
    modelApiKey: 'site_settings',
    modelName: 'Site Settings',
    isSingleton: true,
  }),

  recordWithEmoji: createRecordMention({
    id: 'record-product',
    title: 'Premium Widget',
    modelId: 'model-product',
    modelApiKey: 'product',
    modelName: 'Product',
    modelEmoji: '🛒',
  }),

  // Model mentions
  blogPostModel: createModelMention({
    id: 'model-blog',
    apiKey: 'blog_post',
    name: 'Blog Post',
    isBlockModel: false,
  }),

  blockModel: createModelMention({
    id: 'model-hero',
    apiKey: 'hero_block',
    name: 'Hero Block',
    isBlockModel: true,
  }),
};

// Segments with mentions for testing
export const segmentFixtures = {
  textOnly: [createTextSegment('Hello, world!')],

  singleUserMention: [
    createTextSegment('Hello '),
    createMentionSegment(mentionFixtures.userJohn),
    createTextSegment('!'),
  ],

  multipleUserMentions: [
    createTextSegment('Hey '),
    createMentionSegment(mentionFixtures.userJohn),
    createTextSegment(' and '),
    createMentionSegment(mentionFixtures.userJane),
    createTextSegment(', check this out!'),
  ],

  fieldMention: [
    createTextSegment('See the '),
    createMentionSegment(mentionFixtures.titleField),
    createTextSegment(' field'),
  ],

  mixedMentions: [
    createMentionSegment(mentionFixtures.userJohn),
    createTextSegment(' updated '),
    createMentionSegment(mentionFixtures.titleField),
    createTextSegment(' in '),
    createMentionSegment(mentionFixtures.blogPostRecord),
  ],

  allMentionTypes: [
    createTextSegment('User: '),
    createMentionSegment(mentionFixtures.userJohn),
    createTextSegment(', Field: '),
    createMentionSegment(mentionFixtures.titleField),
    createTextSegment(', Asset: '),
    createMentionSegment(mentionFixtures.imageAsset),
    createTextSegment(', Record: '),
    createMentionSegment(mentionFixtures.blogPostRecord),
    createTextSegment(', Model: '),
    createMentionSegment(mentionFixtures.blogPostModel),
  ],
};
