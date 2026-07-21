import type { RawApiTypes } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import type { RawItem, RawItemType } from '../types';
import {
  getFieldValue,
  getPresentationImageField,
  getPresentationTitleField,
  type RawField,
} from './fields';
import { formatColor, formatCoordinates, formatFieldTitle } from './formatters';
import { buildUploadThumbnail } from './previews';
import { createPresentationResolver } from './resolver';
import { getItemStatus, getItemValidity } from './status';

function field(
  id: string,
  apiKey: string,
  fieldType: RawField['attributes']['field_type'],
  position: number,
  options: {
    localized?: boolean;
    editor?: string;
    heading?: boolean;
    itemTypeId?: string;
  } = {},
): RawField {
  return {
    id,
    type: 'field',
    attributes: {
      api_key: apiKey,
      field_type: fieldType,
      localized: options.localized ?? false,
      position,
      appearance: {
        editor: options.editor ?? 'single_line',
        parameters: { heading: options.heading ?? false },
      },
    },
    relationships: {
      item_type: {
        data: { id: options.itemTypeId ?? 'model-1', type: 'item_type' },
      },
    },
  } as unknown as RawField;
}

function itemType(
  id = 'model-1',
  titleFieldId: string | null = null,
  imageFieldId: string | null = null,
  draftModeActive = true,
): RawItemType {
  return {
    id,
    type: 'item_type',
    attributes: {
      name: 'Article',
      api_key: 'article',
      modular_block: false,
      draft_mode_active: draftModeActive,
    },
    relationships: {
      fields: { data: [] },
      presentation_title_field: {
        data: titleFieldId ? { id: titleFieldId, type: 'field' } : null,
      },
      presentation_image_field: {
        data: imageFieldId ? { id: imageFieldId, type: 'field' } : null,
      },
      workflow: { data: null },
    },
  } as unknown as RawItemType;
}

function item(
  id: string,
  modelId: string,
  attributes: Record<string, unknown>,
  status: 'draft' | 'updated' | 'published' | null = 'draft',
): RawItem {
  return {
    id,
    type: 'item',
    attributes,
    relationships: {
      item_type: { data: { id: modelId, type: 'item_type' } },
    },
    meta: {
      status,
      is_current_version_valid: false,
      is_published_version_valid: true,
    },
  } as unknown as RawItem;
}

describe('presentation field selection', () => {
  const plain = field('plain', 'plain', 'string', 0);
  const heading = field('heading', 'heading', 'string', 2, {
    heading: true,
  });
  const configured = field('configured', 'configured', 'text', 10);
  const image = field('image', 'image', 'file', 3);

  it('uses configured fields before native fallback precedence', () => {
    expect(
      getPresentationTitleField(itemType('model-1', 'configured'), [
        plain,
        heading,
        configured,
      ])?.id,
    ).toBe('configured');
    expect(getPresentationTitleField(itemType(), [plain, heading])?.id).toBe(
      'heading',
    );
  });

  it('falls back to the first file or gallery for images', () => {
    expect(getPresentationImageField(itemType(), [plain, image])?.id).toBe(
      'image',
    );
  });

  it('uses preferred then site locale order', () => {
    const localized = field('localized', 'title', 'string', 0, {
      localized: true,
    });
    const record = item('1', 'model-1', {
      title: { en: 'English', it: 'Italiano' },
    });

    expect(getFieldValue(record, localized, ['en', 'it'], 'it')).toBe(
      'Italiano',
    );
    expect(getFieldValue(record, localized, ['en', 'it'])).toBe('English');
  });
});

describe('presentation formatting', () => {
  it('formats native color and coordinate titles', () => {
    expect(formatColor({ red: 255, green: 16, blue: 0, alpha: 128 })).toBe(
      '#FF1000 50%',
    );
    expect(
      formatCoordinates({ latitude: 41.902782, longitude: 12.496366 }),
    ).toBe('Lat: 41.9028 Lon: 12.4964');
  });

  it('extracts readable text from rich text values', () => {
    expect(
      formatFieldTitle(
        '<p>Hello <strong>world</strong></p>',
        field('body', 'body', 'text', 0, { editor: 'wysiwyg' }),
      ),
    ).toBe('Hello world');
    expect(
      formatFieldTitle(
        { document: { children: [{ children: [{ value: 'DatoCMS' }] }] } },
        field('structured', 'structured', 'structured_text', 0),
      ),
    ).toBe('DatoCMS');
  });
});

describe('presentation resolver', () => {
  it('resolves linked titles, deduplicates hydration, and falls back', async () => {
    const linkField = field('link', 'related', 'link', 0);
    const linkedTitle = field('linked-title', 'name', 'string', 0, {
      itemTypeId: 'linked-model',
    });
    const rootType = itemType('root-model', 'link');
    const linkedType = itemType('linked-model', 'linked-title');
    const linked = item('linked-1', 'linked-model', { name: 'Linked title' });
    const loadItems = vi.fn().mockResolvedValue([linked]);
    const resolver = createPresentationResolver({
      itemTypes: [rootType, linkedType],
      fields: [
        {
          ...linkField,
          relationships: {
            ...linkField.relationships,
            item_type: { data: { id: 'root-model', type: 'item_type' } },
          },
        } as RawField,
        linkedTitle,
      ],
      locales: ['en'],
      loadItems,
    });
    const root = item('root-1', 'root-model', { related: 'linked-1' });

    const [first, second] = await Promise.all([
      resolver.resolve(root),
      resolver.resolve(root),
    ]);

    expect(first.title).toBe('Linked title');
    expect(second.title).toBe('Linked title');
    expect(loadItems).toHaveBeenCalledTimes(1);

    const fallback = await createPresentationResolver({
      itemTypes: [itemType('empty-model')],
      locales: ['en'],
    }).resolve(item('record-42', 'empty-model', {}));
    expect(fallback.title).toBe('Record #record-42');
  });

  it('stops cyclic links and uses the record fallback', async () => {
    const link = field('link', 'next', 'link', 0);
    const model = itemType('model-1', 'link');
    const record = item('record-1', 'model-1', { next: 'record-1' });
    const presentation = await createPresentationResolver({
      itemTypes: [model],
      fields: [link],
      items: [record],
      locales: ['en'],
    }).resolve(record);

    expect(presentation.title).toBe('Record #record-1');
  });

  it('keeps resolved titles when image hydration fails', async () => {
    const title = field('title', 'title', 'string', 0);
    const image = field('image', 'image', 'file', 1);
    const model = itemType('model-1', 'title', 'image');
    const resolver = createPresentationResolver({
      itemTypes: [model],
      fields: [title, image],
      locales: ['en'],
      loadUploads: vi.fn().mockRejectedValue(new Error('Upload unavailable')),
    });
    const first = item('record-1', 'model-1', {
      title: 'First record',
      image: { upload_id: 'upload-1' },
    });
    const second = item('record-2', 'model-1', {
      title: 'Second record',
      image: { upload_id: 'upload-2' },
    });

    const presentations = await resolver.resolveMany([first, second]);

    expect(presentations.map((presentation) => presentation.title)).toEqual([
      'First record',
      'Second record',
    ]);
    expect(presentations.map((presentation) => presentation.image)).toEqual([
      null,
      null,
    ]);
  });
});

describe('status, validity, and thumbnails', () => {
  it('matches native status and validity semantics', () => {
    const record = item('1', 'model-1', {}, null);
    expect(getItemStatus(record)).toBe('published');
    expect(getItemValidity(record, true)).toEqual({
      currentValid: false,
      publishedValid: true,
      hasCurrentError: true,
      hasPublishedError: false,
    });
  });

  it('builds cropped upload URLs with record focal point', () => {
    const upload = {
      id: 'upload-1',
      attributes: {
        url: 'https://assets.example/image.jpg',
        path: '/image.jpg',
        md5: '1234567890',
        mux_playback_id: null,
        updated_at: null,
        default_field_metadata: {
          alt: {},
          title: {},
          custom_data: {},
          focal_point: null,
          poster_time: null,
        },
      },
    } as unknown as RawApiTypes.Upload;

    const result = buildUploadThumbnail(upload, {
      locales: ['en'],
      focalPoint: { x: 0.2, y: 0.8 },
    });

    expect(result?.url).toContain('w=80');
    expect(result?.url).toContain('crop=focalpoint');
    expect(result?.url).toContain('fp-x=0.2');
    expect(result?.uploadId).toBe('upload-1');
  });
});
