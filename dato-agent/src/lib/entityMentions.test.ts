import type { Client } from '@datocms/cma-client-browser';
import type { Field, ItemType, Upload } from 'datocms-plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  createAssetMention,
  createRecordMention,
  mentionThumbnailUrl,
  recordMentionTitle,
} from './entityMentions';

type ItemTypeOptions = {
  collectionAppearance?: string;
  imagePreviewFieldId?: string;
  presentationImageFieldId?: string;
  presentationTitleFieldId?: string;
  singleton?: boolean;
  titleFieldId?: string;
};

function relationship(id?: string) {
  return { data: id ? { id, type: 'field' } : null };
}

function itemType(options: ItemTypeOptions = {}): ItemType {
  return {
    id: 'article-model',
    type: 'item_type',
    attributes: {
      api_key: 'article',
      collection_appearance: options.collectionAppearance ?? 'table',
      modular_block: false,
      name: 'Article',
      singleton: options.singleton ?? false,
    },
    relationships: {
      image_preview_field: relationship(options.imagePreviewFieldId),
      presentation_image_field: relationship(options.presentationImageFieldId),
      presentation_title_field: relationship(options.presentationTitleFieldId),
      title_field: relationship(options.titleFieldId),
    },
  } as unknown as ItemType;
}

function field(
  id: string,
  apiKey: string,
  fieldType: string,
  position: number,
): Field {
  return {
    id,
    type: 'field',
    attributes: {
      api_key: apiKey,
      field_type: fieldType,
      label: apiKey,
      localized: false,
      position,
    },
    relationships: {
      item_type: { data: { id: 'article-model', type: 'item_type' } },
    },
  } as unknown as Field;
}

type UploadResult = {
  basename?: string;
  filename?: string;
  id: string;
  mime_type?: string | null;
  mux_playback_id?: string | null;
  url?: string | null;
};

function clientWithUploads(uploads: Record<string, UploadResult | Error>): {
  client: Client;
  find: ReturnType<typeof vi.fn>;
} {
  const find = vi.fn(async (id: string) => {
    const result = uploads[id];
    if (!result) throw new Error(`Unknown upload ${id}`);
    if (result instanceof Error) throw result;
    return result;
  });

  return {
    client: { uploads: { find } } as unknown as Client,
    find,
  };
}

const model = {
  id: 'article-model',
  apiKey: 'article',
  name: '📰 Article',
};

describe('recordMentionTitle', () => {
  it('uses the model name for singleton records', () => {
    expect(
      recordMentionTitle({
        fields: [],
        itemType: itemType({ singleton: true }),
        mainLocale: 'en',
        modelName: 'Homepage',
        record: { id: 'home', values: {} },
      }),
    ).toBe('Homepage');
  });

  it('prefers the presentation title field over the legacy title field', () => {
    const fields = [
      field('presentation', 'headline', 'string', 1),
      field('legacy', 'seo_title', 'string', 2),
    ];

    expect(
      recordMentionTitle({
        fields,
        itemType: itemType({
          presentationTitleFieldId: 'presentation',
          titleFieldId: 'legacy',
        }),
        mainLocale: 'en',
        modelName: 'Article',
        record: {
          id: 'article-1',
          values: { headline: 'Presentation title', seo_title: 'Legacy title' },
        },
      }),
    ).toBe('Presentation title');
  });

  it('uses the legacy title field when no presentation title is configured', () => {
    const fields = [field('legacy', 'title', 'string', 1)];

    expect(
      recordMentionTitle({
        fields,
        itemType: itemType({ titleFieldId: 'legacy' }),
        mainLocale: 'en',
        modelName: 'Article',
        record: { id: 'article-1', values: { title: 'Legacy title' } },
      }),
    ).toBe('Legacy title');
  });

  it('uses the project main locale for localized titles', () => {
    const fields = [field('title-field', 'title', 'string', 1)];

    expect(
      recordMentionTitle({
        fields,
        itemType: itemType({ presentationTitleFieldId: 'title-field' }),
        mainLocale: 'it',
        modelName: 'Article',
        record: {
          id: 'article-1',
          values: { title: { en: 'English', it: 'Italiano' } },
        },
      }),
    ).toBe('Italiano');
  });

  it('stringifies non-string scalar presentation titles', () => {
    const fields = [field('number-field', 'number', 'integer', 1)];

    expect(
      recordMentionTitle({
        fields,
        itemType: itemType({ presentationTitleFieldId: 'number-field' }),
        mainLocale: 'en',
        modelName: 'Article',
        record: { id: 'article-1', values: { number: 42 } },
      }),
    ).toBe('42');
  });

  it.each([
    ['no model metadata', undefined, [], { title: 'Ignored' }],
    [
      'no configured title field',
      itemType(),
      [field('title-field', 'title', 'string', 1)],
      { title: 'Ignored' },
    ],
    [
      'an unloaded configured field',
      itemType({ presentationTitleFieldId: 'missing' }),
      [field('title-field', 'title', 'string', 1)],
      { title: 'Ignored' },
    ],
    [
      'a blank configured value',
      itemType({ presentationTitleFieldId: 'title-field' }),
      [field('title-field', 'title', 'string', 1)],
      { title: '   ' },
    ],
    [
      'a localized title without the main locale',
      itemType({ presentationTitleFieldId: 'title-field' }),
      [field('title-field', 'title', 'string', 1)],
      { title: { fr: 'Français' } },
    ],
  ])('falls back to the record ID for %s', (_label, type, fields, values) => {
    expect(
      recordMentionTitle({
        fields,
        itemType: type,
        mainLocale: 'en',
        modelName: 'Article',
        record: { id: 'article-1', values },
      }),
    ).toBe('Record #article-1');
  });
});

describe('record mention thumbnails', () => {
  it('uses the presentation image field before image preview and other media', async () => {
    const { client, find } = clientWithUploads({
      presentation: {
        id: 'presentation',
        filename: 'presentation.jpg',
        mime_type: 'image/jpeg',
        url: 'https://cdn.example/presentation.jpg',
      },
      preview: {
        id: 'preview',
        filename: 'preview.jpg',
        mime_type: 'image/jpeg',
        url: 'https://cdn.example/preview.jpg',
      },
    });
    const fields = [
      field('preview-field', 'preview', 'file', 1),
      field('presentation-field', 'presentation', 'file', 2),
    ];

    const mention = await createRecordMention({
      client,
      fields,
      itemType: itemType({
        imagePreviewFieldId: 'preview-field',
        presentationImageFieldId: 'presentation-field',
      }),
      mainLocale: 'en',
      model,
      record: {
        id: 'article-1',
        values: {
          presentation: { upload_id: 'presentation' },
          preview: { upload_id: 'preview' },
        },
      },
    });

    expect(mention.thumbnailUrl).toBe(
      'https://cdn.example/presentation.jpg?w=48&fit=max&auto=format&dpr=2&q=80',
    );
    expect(find).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledWith('presentation');
  });

  it('uses the image preview field when no presentation image is configured', async () => {
    const { client, find } = clientWithUploads({
      preview: {
        id: 'preview',
        filename: 'preview.jpg',
        mime_type: 'image/jpeg',
        url: 'https://cdn.example/preview.jpg',
      },
    });

    const mention = await createRecordMention({
      client,
      fields: [field('preview-field', 'preview', 'file', 1)],
      itemType: itemType({ imagePreviewFieldId: 'preview-field' }),
      mainLocale: 'en',
      model,
      record: {
        id: 'article-1',
        values: { preview: { upload_id: 'preview' } },
      },
    });

    expect(mention.thumbnailUrl).toContain('/preview.jpg?w=48');
    expect(find).toHaveBeenCalledWith('preview');
  });

  it('falls back to the first positioned file or gallery field', async () => {
    const { client, find } = clientWithUploads({
      first: {
        id: 'first',
        filename: 'first.jpg',
        mime_type: 'image/jpeg',
        url: 'https://cdn.example/first.jpg',
      },
      later: {
        id: 'later',
        filename: 'later.jpg',
        mime_type: 'image/jpeg',
        url: 'https://cdn.example/later.jpg',
      },
    });
    const fields = [
      field('later-field', 'later_image', 'file', 8),
      field('text-field', 'body', 'text', 1),
      field('first-field', 'first_image', 'gallery', 3),
    ];

    const mention = await createRecordMention({
      client,
      fields,
      itemType: itemType(),
      mainLocale: 'en',
      model,
      record: {
        id: 'article-1',
        values: {
          first_image: [{ upload_id: 'first' }, { upload_id: 'later' }],
          later_image: { upload_id: 'later' },
        },
      },
    });

    expect(mention.thumbnailUrl).toContain('/first.jpg?w=48');
    expect(find).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledWith('first');
  });

  it('resolves a localized gallery and uses its first upload', async () => {
    const { client, find } = clientWithUploads({
      italian: {
        id: 'italian',
        filename: 'italian.jpg',
        mime_type: 'image/jpeg',
        url: 'https://cdn.example/italian.jpg',
      },
    });

    const mention = await createRecordMention({
      client,
      fields: [field('gallery-field', 'gallery', 'gallery', 1)],
      itemType: itemType(),
      mainLocale: 'it',
      model,
      record: {
        id: 'article-1',
        values: {
          gallery: {
            en: [{ upload_id: 'english' }],
            it: [{ upload_id: 'italian' }, { upload_id: 'second' }],
          },
        },
      },
    });

    expect(mention.thumbnailUrl).toContain('/italian.jpg?w=48');
    expect(find).toHaveBeenCalledWith('italian');
  });

  it('falls back to another media field when the configured image has no upload', async () => {
    const { client, find } = clientWithUploads({
      fallback: {
        id: 'fallback',
        filename: 'fallback.jpg',
        mime_type: 'image/jpeg',
        url: 'https://cdn.example/fallback.jpg',
      },
    });
    const fields = [
      field('configured-field', 'configured', 'file', 1),
      field('fallback-field', 'fallback', 'file', 2),
    ];

    const mention = await createRecordMention({
      client,
      fields,
      itemType: itemType({ presentationImageFieldId: 'configured-field' }),
      mainLocale: 'en',
      model,
      record: {
        id: 'article-1',
        values: {
          configured: null,
          fallback: { upload_id: 'fallback' },
        },
      },
    });

    expect(mention.thumbnailUrl).toContain('/fallback.jpg?w=48');
    expect(find).toHaveBeenCalledWith('fallback');
  });

  it('suppresses thumbnails for compact collections', async () => {
    const { client, find } = clientWithUploads({
      image: {
        id: 'image',
        filename: 'image.jpg',
        mime_type: 'image/jpeg',
        url: 'https://cdn.example/image.jpg',
      },
    });

    const mention = await createRecordMention({
      client,
      fields: [field('image-field', 'image', 'file', 1)],
      itemType: itemType({ collectionAppearance: 'compact' }),
      mainLocale: 'en',
      model,
      record: {
        id: 'article-1',
        values: { image: { upload_id: 'image' } },
      },
    });

    expect(mention.thumbnailUrl).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  it('creates a video thumbnail from a Mux playback ID', async () => {
    const { client } = clientWithUploads({
      video: {
        id: 'video',
        filename: 'video.mp4',
        mime_type: 'video/mp4',
        mux_playback_id: 'mux-record',
        url: 'https://cdn.example/video.mp4',
      },
    });

    const mention = await createRecordMention({
      client,
      fields: [field('video-field', 'video', 'file', 1)],
      itemType: itemType({ presentationImageFieldId: 'video-field' }),
      mainLocale: 'en',
      model,
      record: {
        id: 'article-1',
        values: { video: { upload_id: 'video' } },
      },
    });

    expect(mention.thumbnailUrl).toBe(
      'https://image.mux.com/mux-record/thumbnail.jpg?width=48&fit_mode=preserve',
    );
  });

  it('keeps the record mention usable when the upload lookup fails', async () => {
    const { client } = clientWithUploads({
      broken: new Error('Upload unavailable'),
    });

    await expect(
      createRecordMention({
        client,
        fields: [
          field('title-field', 'title', 'string', 1),
          field('image-field', 'image', 'file', 2),
        ],
        itemType: itemType({
          presentationImageFieldId: 'image-field',
          presentationTitleFieldId: 'title-field',
        }),
        mainLocale: 'en',
        model,
        record: {
          id: 'article-1',
          values: {
            image: { upload_id: 'broken' },
            title: 'Still usable',
          },
        },
      }),
    ).resolves.toMatchObject({
      id: 'article-1',
      modelEmoji: '📰',
      thumbnailUrl: null,
      title: 'Still usable',
      type: 'record',
    });
  });

  it('does not attempt upload resolution without a CMA client', async () => {
    const mention = await createRecordMention({
      client: null,
      fields: [field('image-field', 'image', 'file', 1)],
      itemType: itemType({ presentationImageFieldId: 'image-field' }),
      mainLocale: 'en',
      model,
      record: {
        id: 'article-1',
        values: { image: { upload_id: 'image' } },
      },
    });

    expect(mention.thumbnailUrl).toBeNull();
  });
});

describe('mentionThumbnailUrl', () => {
  it('builds an optimized image thumbnail URL', () => {
    expect(
      mentionThumbnailUrl({
        mimeType: 'image/png',
        url: 'https://cdn.example/image.png',
        width: 48,
      }),
    ).toBe('https://cdn.example/image.png?w=48&fit=max&auto=format&dpr=2&q=80');
  });

  it('builds a Mux video thumbnail URL', () => {
    expect(
      mentionThumbnailUrl({
        mimeType: 'video/mp4',
        muxPlaybackId: 'mux-asset',
        url: 'https://cdn.example/video.mp4',
        width: 300,
      }),
    ).toBe(
      'https://image.mux.com/mux-asset/thumbnail.jpg?width=300&fit_mode=preserve',
    );
  });

  it.each([
    ['an image without a URL', 'image/jpeg', undefined, undefined],
    ['a video without a Mux ID', 'video/mp4', 'https://video', undefined],
    ['non-visual media', 'application/pdf', 'https://document', undefined],
  ])('returns null for %s', (_label, mimeType, url, muxPlaybackId) => {
    expect(
      mentionThumbnailUrl({ mimeType, muxPlaybackId, url, width: 48 }),
    ).toBeNull();
  });
});

describe('createAssetMention', () => {
  it.each([
    [
      'image',
      {
        id: 'image',
        attributes: {
          filename: 'image.jpg',
          mime_type: 'image/jpeg',
          mux_playback_id: null,
          url: 'https://cdn.example/image.jpg',
        },
      },
      'https://cdn.example/image.jpg?w=300&fit=max&auto=format&dpr=2&q=80',
    ],
    [
      'video',
      {
        id: 'video',
        attributes: {
          filename: 'video.mp4',
          mime_type: 'video/mp4',
          mux_playback_id: 'mux-upload',
          url: 'https://cdn.example/video.mp4',
        },
      },
      'https://image.mux.com/mux-upload/thumbnail.jpg?width=300&fit_mode=preserve',
    ],
  ])('creates the expected %s picker thumbnail', (_label, upload, expected) => {
    expect(createAssetMention(upload as unknown as Upload).thumbnailUrl).toBe(
      expected,
    );
  });
});
