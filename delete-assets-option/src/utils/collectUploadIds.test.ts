import { describe, expect, it, vi } from 'vitest';
import {
  createUploadCollector,
  type UploadFieldDescriptor,
} from './collectUploadIds';

function field(
  api_key: string,
  field_type: string,
  localized = false,
): UploadFieldDescriptor {
  return { api_key, field_type, localized };
}

function record(modelId: string, attributes: Record<string, unknown>) {
  return {
    id: 'synthetic-record',
    type: 'item',
    attributes,
    relationships: { item_type: { data: { id: modelId, type: 'item_type' } } },
    meta: { upload_id: 'not-a-reference' },
  };
}

function document(children: unknown[]) {
  return { schema: 'dast', document: { type: 'root', children } };
}

describe('createUploadCollector', () => {
  it('streams unique discoveries within a record', async () => {
    const onUploadId = vi.fn();
    const collect = createUploadCollector(
      async () => [field('gallery', 'gallery')],
      { onUploadId },
    );
    expect(
      await collect(
        record('page', {
          gallery: [
            { upload_id: 'one' },
            { upload_id: 'one' },
            { upload_id: 'two' },
          ],
        }),
      ),
    ).toEqual(['one', 'two']);
    expect(onUploadId.mock.calls).toEqual([['one'], ['two']]);
  });

  it('stops before any schema read when cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    const loadFields = vi.fn(async () => [field('image', 'file')]);
    const collect = createUploadCollector(loadFields, { signal: abort.signal });
    await expect(
      collect(record('page', { image: { upload_id: 'asset' } })),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadFields).not.toHaveBeenCalled();
  });

  it('detects cancellation during the final field before returning candidates', async () => {
    const abort = new AbortController();
    const collect = createUploadCollector(
      async () => [field('image', 'file')],
      {
        signal: abort.signal,
        onUploadId: () => abort.abort(),
      },
    );
    await expect(
      collect(record('page', { image: { upload_id: 'asset' } })),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('collects every locale and nested field type, including SEO image IDs', async () => {
    const fields: Record<string, UploadFieldDescriptor[]> = {
      page: [
        field('cover', 'file', true),
        field('gallery', 'gallery', true),
        field('seo', 'seo', true),
        field('blocks', 'rich_text', true),
        field('block', 'single_block'),
        field('body', 'structured_text', true),
      ],
      block: [field('image', 'file'), field('child', 'single_block')],
    };
    const collect = createUploadCollector(async (modelId) => fields[modelId]);
    const shared = record('block', { image: { upload_id: 'shared' } });

    expect(
      await collect(
        record('page', {
          cover: { en: { upload_id: 'cover' }, fr: null },
          gallery: {
            en: [{ upload_id: 'gallery-en' }, { upload_id: 'cover' }],
            'pt-BR': [{ upload_id: 'gallery-pt' }],
          },
          seo: { en: { image: 'seo-en' }, de: { image: 'seo-de' } },
          blocks: { en: [shared], fr: [shared] },
          block: record('block', {
            image: { upload_id: 'single-block' },
            child: shared,
          }),
          body: {
            en: document([
              { type: 'block', item: shared },
              {
                type: 'paragraph',
                children: [
                  {
                    type: 'inlineBlock',
                    item: record('block', { image: { upload_id: 'inline' } }),
                  },
                ],
              },
            ]),
            fr: document([
              {
                type: 'block',
                item: record('block', { image: { upload_id: 'body-fr' } }),
              },
            ]),
          },
        }),
      ),
    ).toEqual([
      'cover',
      'gallery-en',
      'gallery-pt',
      'seo-en',
      'seo-de',
      'shared',
      'single-block',
      'inline',
      'body-fr',
    ]);
  });

  it('ignores JSON, metadata, SEO text and links to other records', async () => {
    const loadFields = vi.fn(async () => [
      field('cover', 'file'),
      field('gallery', 'gallery'),
      field('seo', 'seo'),
      field('body', 'structured_text'),
      field('json', 'json'),
      field('link', 'link'),
      field('links', 'links'),
      field('markdown', 'text'),
    ]);
    const collect = createUploadCollector(loadFields);
    const falseBlock = record('linked-model', {
      cover: { upload_id: 'linked-record-asset' },
    });

    expect(
      await collect(
        record('page', {
          cover: {
            upload_id: 'cover',
            custom_data: { upload_id: 'custom-data' },
            nested: { upload_id: 'file-metadata' },
          },
          gallery: [{ upload_id: 'gallery', alt: { upload_id: 'alt-text' } }],
          seo: {
            image: 'seo-image',
            title: { upload_id: 'seo-title' },
            description: { upload_id: 'seo-description' },
          },
          json: { upload_id: 'json', nested: falseBlock },
          link: falseBlock,
          links: [falseBlock],
          markdown: '![image](https://www.datocms-assets.com/123/image.jpg)',
          body: document([
            { type: 'itemSpan', item: 'linked-record-id' },
            { type: 'itemSpan', item: falseBlock },
            {
              type: 'itemLink',
              item: falseBlock,
              children: [{ type: 'span', value: 'Link', upload_id: 'span' }],
            },
            {
              type: 'link',
              url: 'https://www.datocms-assets.com/123/image.jpg',
              children: [{ type: 'span', value: 'Link' }],
              extra: { type: 'block', item: falseBlock },
            },
          ]),
        }),
      ),
    ).toEqual(['cover', 'gallery', 'seo-image']);
    expect(loadFields).toHaveBeenCalledTimes(1);
  });

  it('returns no candidates for null, missing and empty fields', async () => {
    const collect = createUploadCollector(async () => [
      field('cover', 'file'),
      field('gallery', 'gallery'),
      field('seo', 'seo'),
      field('blocks', 'rich_text'),
      field('block', 'single_block'),
      field('body', 'structured_text'),
      field('localized', 'file', true),
      field('missing', 'file'),
    ]);

    expect(
      await collect(
        record('page', {
          cover: null,
          gallery: [],
          seo: { image: null, title: 'text' },
          blocks: [],
          block: null,
          body: null,
          localized: { en: null, fr: { upload_id: ' \t\n' } },
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ['rich_text', ['block-id']],
    ['single_block', 'block-id'],
    ['structured_text', document([{ type: 'block', item: 'block-id' }])],
    ['structured_text', document([{ type: 'inlineBlock', item: 'block-id' }])],
    ['single_block', { type: 'item', attributes: {} }],
  ])('rejects unresolved or incomplete %s blocks', async (fieldType, value) => {
    const collect = createUploadCollector(async () => [
      field('image', 'file'),
      field('content', fieldType),
    ]);

    // A scan cannot return even the valid candidate if another field could
    // hide assets in unresolved blocks. The caller must preserve those assets.
    await expect(
      collect(
        record('page', { image: { upload_id: 'valid' }, content: value }),
      ),
    ).rejects.toThrow('Cannot inspect field "content"');
  });

  it.each([
    ['file', 'upload-id'],
    ['file', { upload_id: 42 }],
    ['gallery', { upload_id: 'upload-id' }],
    ['seo', { image: { upload_id: 'upload-id' } }],
    ['rich_text', { type: 'item', attributes: {} }],
    ['structured_text', { schema: 'other', document: {} }],
    ['structured_text', { schema: 'dast', document: { type: 'span' } }],
    ['structured_text', document([{ type: 'paragraph', children: {} }])],
    ['structured_text', document([{ type: 'unsupported', children: [] }])],
    ['structured_text', document([{ type: 'span', children: [] }])],
  ])('rejects an unsupported shape in %s fields', async (fieldType, value) => {
    const collect = createUploadCollector(async () => [
      field('content', fieldType),
    ]);

    await expect(collect(record('page', { content: value }))).rejects.toThrow(
      'Cannot inspect field "content"',
    );
  });

  it('rejects an unsupported localized value and invalid root records', async () => {
    const collect = createUploadCollector(async () => [
      field('image', 'file', true),
    ]);

    await expect(collect(record('page', { image: [] }))).rejects.toThrow(
      'a map of localized values',
    );
    await expect(collect({ image: { upload_id: 'asset' } })).rejects.toThrow(
      'a raw nested CMA item',
    );
    await expect(collect(record('', {}))).rejects.toThrow('an item_type ID');
  });

  it('shares model promises between concurrent and repeated records', async () => {
    const loadFields = vi.fn(async () => [field('image', 'file')]);
    const collect = createUploadCollector(loadFields);
    const first = record('page', { image: { upload_id: 'first' } });
    const second = record('page', { image: { upload_id: 'second' } });

    expect(await Promise.all([collect(first), collect(second)])).toEqual([
      ['first'],
      ['second'],
    ]);
    first.attributes.image = { upload_id: 'changed' };
    expect(await collect(first)).toEqual(['changed']);
    expect(loadFields).toHaveBeenCalledTimes(1);
  });

  it('caches only copied relevant descriptors and never reads irrelevant data', async () => {
    const relevant = field('image', 'file');
    const fields = [relevant, field('json', 'json')];
    const collect = createUploadCollector(async () => fields);
    const attributes: Record<string, unknown> = {
      image: { upload_id: 'asset' },
    };
    Object.defineProperty(attributes, 'json', {
      get() {
        throw new Error('Unrelated JSON must not be read');
      },
    });

    expect(await collect(record('page', attributes))).toEqual(['asset']);
    relevant.api_key = 'json';
    fields.length = 0;
    expect(await collect(record('page', attributes))).toEqual(['asset']);
  });

  it('propagates a failed schema read and allows a subsequent automatic retry', async () => {
    const loadFields = vi
      .fn<() => Promise<UploadFieldDescriptor[]>>()
      .mockRejectedValueOnce(new Error('Schema is unavailable'))
      .mockResolvedValue([field('image', 'file')]);
    const collect = createUploadCollector(loadFields);
    const item = record('page', { image: { upload_id: 'asset' } });

    await expect(collect(item)).rejects.toThrow('Schema is unavailable');
    expect(await collect(item)).toEqual(['asset']);
    expect(loadFields).toHaveBeenCalledTimes(2);
  });

  it('supports own properties on null-prototype objects and rejects inherited files', async () => {
    const collect = createUploadCollector(async () => [field('image', 'file')]);
    const image: Record<string, unknown> = Object.create(null);
    image.upload_id = 'asset';
    Object.defineProperty(image, 'hasOwnProperty', { value: null });
    expect(await collect(record('page', { image }))).toEqual(['asset']);

    const inherited: Record<string, unknown> = Object.create({
      upload_id: 'false',
    });
    await expect(collect(record('page', { image: inherited }))).rejects.toThrow(
      'a file with upload_id',
    );
  });

  it('visits shared blocks once and terminates on block and DAST cycles', async () => {
    let visits = 0;
    const attributes: Record<string, unknown> = {};
    Object.defineProperty(attributes, 'image', {
      get() {
        visits += 1;
        return { upload_id: 'shared' };
      },
    });
    const shared = record('block', attributes);
    attributes.child = shared;
    const cycle: Record<string, unknown> = { type: 'paragraph', children: [] };
    cycle.children = [cycle, { type: 'inlineBlock', item: shared }];
    const loadFields = vi.fn(async (modelId: string) =>
      modelId === 'page'
        ? [field('blocks', 'rich_text'), field('body', 'structured_text')]
        : [field('image', 'file'), field('child', 'single_block')],
    );
    const collect = createUploadCollector(loadFields);

    expect(
      await collect(
        record('page', {
          blocks: Array(10_000).fill(shared),
          body: document([cycle]),
        }),
      ),
    ).toEqual(['shared']);
    expect(visits).toBe(1);
    expect(loadFields).toHaveBeenCalledTimes(2);
  });

  it('handles 30,000 nested block levels without recursion', async () => {
    let nested = record('block', { image: { upload_id: 'deep' } });
    for (let index = 0; index < 30_000; index += 1) {
      nested = record('block', { child: nested });
    }
    const loadFields = vi.fn(async () => [
      field('image', 'file'),
      field('child', 'single_block'),
    ]);
    const collect = createUploadCollector(loadFields);

    expect(await collect(nested)).toEqual(['deep']);
    expect(loadFields).toHaveBeenCalledTimes(1);
  });

  it('handles 30,000 DAST children levels without recursion', async () => {
    let node: Record<string, unknown> = {
      type: 'inlineBlock',
      item: record('block', { image: { upload_id: 'deep' } }),
    };
    for (let index = 0; index < 30_000; index += 1) {
      node = { type: 'paragraph', children: [node] };
    }
    const collect = createUploadCollector(async (modelId) =>
      modelId === 'page'
        ? [field('body', 'structured_text')]
        : [field('image', 'file')],
    );

    expect(await collect(record('page', { body: document([node]) }))).toEqual([
      'deep',
    ]);
  });

  it('collects 10,000 assets across 200,000 localized gallery references', async () => {
    const assets = Array.from({ length: 10_000 }, (_, index) => ({
      upload_id: `asset-${index}`,
    }));
    const locales: Record<string, unknown> = {};
    for (let index = 0; index < 20; index += 1) {
      locales[`locale-${index}`] = assets;
    }
    const collect = createUploadCollector(async () => [
      field('gallery', 'gallery', true),
    ]);

    expect(await collect(record('page', { gallery: locales }))).toEqual(
      assets.map((asset) => asset.upload_id),
    );
  });

  it('inspects 200,000 synthetic records incrementally with one schema load', async () => {
    const loadFields = vi.fn(async () => [field('image', 'file')]);
    const collect = createUploadCollector(loadFields);
    const image = { upload_id: '' };
    const template = record('page', { image });
    const assets = new Set<string>();

    // Reuse one record fixture instead of allocating 200,000 entities. The
    // schema cache must hold no record data, even across this many calls.
    for (let index = 0; index < 200_000; index += 1) {
      image.upload_id = `asset-${index % 10_000}`;
      for (const id of await collect(template)) assets.add(id);
    }

    expect(assets.size).toBe(10_000);
    expect(loadFields).toHaveBeenCalledTimes(1);
  });
});
