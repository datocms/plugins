import type { RawApiTypes } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import type { RawItem, RawItemType } from '../types';
import {
  getFieldValue,
  getPresentationImageField,
  getPresentationTitleField,
  type RawField,
} from './fields';
import {
  extractStructuredText,
  formatColor,
  formatCoordinates,
  formatFieldTitle,
} from './formatters';
import { buildUploadThumbnail } from './previews';
import {
  createPresentationResolver,
  PRESENTATION_CACHE_LIMITS,
} from './resolver';
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

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function upload(id: string): RawApiTypes.Upload {
  return {
    id,
    attributes: {
      url: `https://assets.example/${id}.jpg`,
      path: `/${id}.jpg`,
      md5: null,
      mux_playback_id: null,
      updated_at: null,
      default_field_metadata: { focal_point: null, poster_time: null },
    },
  } as unknown as RawApiTypes.Upload;
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

  it('keeps native position and API key precedence without sorting schema arrays', () => {
    const last = field('last', 'z', 'string', 1, { heading: true });
    const first = field('first', 'a', 'string', 1, { heading: true });
    const fields = [last, first, plain];
    expect(getPresentationTitleField(itemType(), fields)?.id).toBe('first');
    expect(fields).toEqual([last, first, plain]);
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

  it('handles deeply nested and cyclic Structured Text without recursive traversal', () => {
    let deep: unknown = { value: 'Deep title' };
    for (let index = 0; index < 10_000; index += 1) {
      deep = { children: [deep] };
    }
    expect(extractStructuredText(deep)).toBe('Deep title');

    const cyclic: { children: unknown[] } = {
      children: [{ value: 'Readable' }],
    };
    cyclic.children.push(cyclic, cyclic.children);
    expect(extractStructuredText(cyclic)).toBe('Readable');
  });

  it('stops Structured Text extraction after enough title text is available', () => {
    const unreachable = {
      get children(): unknown {
        throw new Error(
          'The remainder of this huge document must not be traversed',
        );
      },
    };
    expect(
      formatFieldTitle(
        {
          document: {
            children: [{ value: 'x'.repeat(1_000_000) }, unreachable],
          },
        },
        field('structured', 'structured', 'structured_text', 0),
      ),
    ).toBe(`${'x'.repeat(199)}…`);
    expect(
      formatFieldTitle(
        {
          document: { children: [{ value: ' Hello  ' }, { value: ' world ' }] },
        },
        field('structured', 'structured', 'structured_text', 0),
        { maxLength: 10 },
      ),
    ).toBe('Hello wor…');
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

  it('deduplicates an entity requested again while its batch is in flight', async () => {
    const response = deferred<readonly RawItem[]>();
    const started = deferred<void>();
    const loadItems = vi.fn(() => {
      started.resolve();
      return response.promise;
    });
    const resolver = createPresentationResolver({
      itemTypes: [
        itemType('model-1', 'link'),
        itemType('linked-model', 'name'),
      ],
      fields: [
        field('link', 'next', 'link', 0),
        field('name', 'name', 'string', 0, { itemTypeId: 'linked-model' }),
      ],
      locales: ['en'],
      loadItems,
    });
    const record = item('root', 'model-1', { next: 'linked' });
    const first = resolver.resolve(record);
    await started.promise;
    const second = resolver.resolve(record);
    await Promise.resolve();
    await Promise.resolve();
    expect(loadItems).toHaveBeenCalledTimes(1);
    response.resolve([item('linked', 'linked-model', { name: 'Resolved' })]);
    expect(
      (await Promise.all([first, second])).map((value) => value.title),
    ).toEqual(['Resolved', 'Resolved']);
  });

  it('keeps newly primed data when an older hydration response arrives', async () => {
    const response = deferred<readonly RawItem[]>();
    const started = deferred<void>();
    const resolver = createPresentationResolver({
      itemTypes: [
        itemType('model-1', 'link'),
        itemType('linked-model', 'name'),
      ],
      fields: [
        field('link', 'next', 'link', 0),
        field('name', 'name', 'string', 0, { itemTypeId: 'linked-model' }),
      ],
      locales: ['en'],
      loadItems: () => {
        started.resolve();
        return response.promise;
      },
    });
    const record = item('root', 'model-1', { next: 'linked' });
    const first = resolver.resolve(record);
    await started.promise;
    resolver.primeItems([
      item('linked', 'linked-model', { name: 'Current value' }),
    ]);
    expect((await first).title).toBe('Current value');
    response.resolve([item('linked', 'linked-model', { name: 'Stale value' })]);
    await Promise.resolve();
    expect((await resolver.resolve(record)).title).toBe('Current value');
  });

  it('evicts old records and uploads after navigation exceeds the cache limits', async () => {
    const loadItems = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => item(id, 'linked-model', { name: `Reloaded ${id}` })),
    );
    const loadUploads = vi.fn(async (ids: readonly string[]) =>
      ids.map(upload),
    );
    const resolver = createPresentationResolver({
      itemTypes: [
        itemType('model-1', 'link', 'image'),
        itemType('linked-model', 'name'),
      ],
      fields: [
        field('link', 'next', 'link', 0),
        field('image', 'image', 'file', 1),
        field('name', 'name', 'string', 0, { itemTypeId: 'linked-model' }),
      ],
      locales: ['en'],
      loadItems,
      loadUploads,
    });
    resolver.primeItems(
      Array.from({ length: PRESENTATION_CACHE_LIMITS.items + 1 }, (_, index) =>
        item(`linked-${index}`, 'linked-model', { name: `Cached ${index}` }),
      ),
    );
    resolver.primeUploads(
      Array.from(
        { length: PRESENTATION_CACHE_LIMITS.uploads + 1 },
        (_, index) => upload(`upload-${index}`),
      ),
    );

    const recent = await resolver.resolve(
      item('recent', 'model-1', {
        next: `linked-${PRESENTATION_CACHE_LIMITS.items}`,
        image: { upload_id: `upload-${PRESENTATION_CACHE_LIMITS.uploads}` },
      }),
    );
    expect(recent.title).toBe(`Cached ${PRESENTATION_CACHE_LIMITS.items}`);
    expect(loadItems).not.toHaveBeenCalled();
    expect(loadUploads).not.toHaveBeenCalled();

    const evicted = await resolver.resolve(
      item('old', 'model-1', {
        next: 'linked-0',
        image: { upload_id: 'upload-0' },
      }),
    );
    expect(evicted.title).toBe('Reloaded linked-0');
    expect(evicted.image?.uploadId).toBe('upload-0');
    expect(loadItems).toHaveBeenCalledWith(['linked-0']);
    expect(loadUploads).toHaveBeenCalledWith(['upload-0']);
  });

  it('bounds hydration batch sizes and shared concurrency for a synthetic large selection', async () => {
    let active = 0;
    let maxActive = 0;
    const batches: number[] = [];
    async function hydrate<T>(ids: readonly string[], make: (id: string) => T) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      batches.push(ids.length);
      await Promise.resolve();
      active -= 1;
      return ids.map(make);
    }
    const resolver = createPresentationResolver({
      itemTypes: [
        itemType('model-1', 'link', 'image'),
        itemType('linked-model', 'name'),
      ],
      fields: [
        field('link', 'next', 'link', 0),
        field('image', 'image', 'file', 1),
        field('name', 'name', 'string', 0, { itemTypeId: 'linked-model' }),
      ],
      locales: ['en'],
      loadItems: (ids) =>
        hydrate(ids, (id) => item(id, 'linked-model', { name: id })),
      loadUploads: (ids) => hydrate(ids, upload),
    });
    const records = Array.from({ length: 501 }, (_, index) =>
      item(`root-${index}`, 'model-1', {
        next: `linked-${index}`,
        image: { upload_id: `upload-${index}` },
      }),
    );

    // Also exercise the cache boundary when callers resolve independently.
    const result = await Promise.all(
      records.map((record) => resolver.resolve(record)),
    );
    expect(result).toHaveLength(records.length);
    expect(result[500].title).toBe('linked-500');
    expect(Math.max(...batches)).toBe(100);
    expect(maxActive).toBe(2);
  });

  it('stops starting work after a visible-page resolution is cancelled', async () => {
    const controller = new AbortController();
    const loadedIds: string[] = [];
    const resolver = createPresentationResolver({
      itemTypes: [itemType('model-1', 'link')],
      fields: [field('link', 'next', 'link', 0)],
      locales: ['en'],
      loadItems: async (ids) => {
        loadedIds.push(...ids);
        controller.abort();
        return [];
      },
    });
    const records = Array.from({ length: 1_000 }, (_, index) =>
      item(`root-${index}`, 'model-1', {
        next: `linked-${index}`,
      }),
    );
    await expect(
      resolver.resolveMany(records, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadedIds.length).toBeGreaterThan(0);
    expect(loadedIds.length).toBeLessThanOrEqual(25);
  });

  it('skips queued model hydration after all requesting pages are cancelled', async () => {
    const controller = new AbortController();
    const response = deferred<readonly RawField[]>();
    const started = deferred<void>();
    const loadFields = vi.fn(() => {
      if (loadFields.mock.calls.length === 2) started.resolve();
      return response.promise;
    });
    const models = Array.from({ length: 25 }, (_, index) =>
      itemType(`model-${index}`),
    );
    const resolver = createPresentationResolver({
      itemTypes: models,
      locales: ['en'],
      loadFields,
    });
    const records = models.map((model) =>
      item(`record-${model.id}`, model.id, {}),
    );
    const pending = resolver.resolveMany(records, {
      signal: controller.signal,
    });
    await started.promise;
    controller.abort();
    response.resolve([]);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadFields).toHaveBeenCalledTimes(2);
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
