import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import {
  collectAssets,
  createUploadCollector,
  deleteAssets,
  type FieldInfo,
  waitForRecordDeletion,
} from './assetCleanup';

function field(api_key: string, field_type: string, localized = false) {
  return { api_key, field_type, localized };
}

function record(modelId: string, attributes: Record<string, unknown>) {
  return {
    id: 'record',
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
  it('collects every locale and nested field type, including SEO images', async () => {
    const fields: Record<string, FieldInfo[]> = {
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
    ]);
    const collect = createUploadCollector(loadFields);
    const linked = record('page', { cover: { upload_id: 'linked-asset' } });

    expect(
      await collect(
        record('page', {
          cover: { upload_id: 'cover', custom_data: { upload_id: 'custom' } },
          gallery: [{ upload_id: 'gallery', alt: { upload_id: 'alt' } }],
          seo: { image: 'seo-image', title: { upload_id: 'seo-title' } },
          json: { upload_id: 'json', nested: linked },
          link: linked,
          links: [linked],
          body: document([
            { type: 'itemSpan', item: linked },
            { type: 'itemLink', item: linked, children: [] },
          ]),
        }),
      ),
    ).toEqual(['cover', 'gallery', 'seo-image']);
    expect(loadFields).toHaveBeenCalledTimes(1);
  });
});

describe('collectAssets', () => {
  it('reads both the current and the published version of the records', async () => {
    const versions: Record<string, unknown[]> = {
      current: [record('page', { cover: { upload_id: 'new' } })],
      published: [record('page', { cover: { upload_id: 'old' } })],
    };
    const client = {
      fields: { list: async () => [field('cover', 'file')] },
      items: {
        async *rawListPagedIterator(query: { version: string }) {
          yield* versions[query.version];
        },
      },
    } as unknown as Client;

    expect(await collectAssets(client, ['record'])).toEqual(['new', 'old']);
  });
});

describe('waitForRecordDeletion', () => {
  it('polls until none of the records can be found', async () => {
    const counts = [2, 1, 0];
    const rawList = vi.fn(async () => ({
      data: [],
      meta: { total_count: counts.shift() },
    }));
    const wait = vi.fn(async () => {});
    const client = { items: { rawList } } as unknown as Client;

    await waitForRecordDeletion(client, ['a', 'b'], wait);

    expect(rawList).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[1000], [2000], [4000]]);
  });
});

describe('deleteAssets', () => {
  it('deletes in batches of 100 and counts the assets the server kept', async () => {
    const rawBulkDestroy = vi.fn(
      async (body: {
        data: { relationships: { uploads: { data: unknown[] } } };
      }) => {
        const count = body.data.relationships.uploads.data.length;
        return { data: [], meta: { successful: count - 1, failed: 1 } };
      },
    );
    const client = { uploads: { rawBulkDestroy } } as unknown as Client;
    const ids = Array.from({ length: 150 }, (_, i) => `asset-${i}`);

    expect(await deleteAssets(client, ids)).toEqual({ deleted: 148, kept: 2 });
    expect(rawBulkDestroy).toHaveBeenCalledTimes(2);
  });
});
