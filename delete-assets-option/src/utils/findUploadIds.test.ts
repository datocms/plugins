import { describe, expect, it } from 'vitest';
import findUploadIds from './findUploadIds';

describe('findUploadIds', () => {
  it('collects assets in localized galleries and hydrated nested blocks', () => {
    const imageBlock = {
      id: 'block-record',
      type: 'item',
      attributes: {
        image: { upload_id: 'block-asset' },
        gallery: {
          en: [{ upload_id: 'gallery-asset' }],
          'pt-BR': [{ upload_id: 'localized-asset' }],
        },
      },
    };
    const structuredText = {
      schema: 'dast',
      document: {
        type: 'root',
        children: [
          { type: 'block', item: imageBlock },
          {
            type: 'paragraph',
            children: [
              {
                type: 'inlineBlock',
                item: {
                  type: 'item',
                  attributes: { image: { upload_id: 'inline-asset' } },
                },
              },
            ],
          },
        ],
      },
    };

    expect(
      findUploadIds({
        cover: { en: { upload_id: 'cover-asset' }, fr: null },
        body: { en: structuredText, 'pt-BR': structuredText },
        blocks: [imageBlock],
      }),
    ).toEqual([
      'cover-asset',
      'block-asset',
      'gallery-asset',
      'localized-asset',
      'inline-asset',
    ]);
  });

  it('deduplicates IDs while retaining the first depth-first discovery order', () => {
    expect(
      findUploadIds({
        upload_id: 'root-asset',
        first: {
          upload_id: 'first-asset',
          child: { upload_id: 'nested-asset' },
        },
        second: [{ upload_id: 'last-asset' }, { upload_id: 'first-asset' }],
      }),
    ).toEqual(['root-asset', 'first-asset', 'nested-asset', 'last-asset']);
  });

  it('does not collect inherited upload IDs or traverse inherited children', () => {
    const inheritedAsset: Record<string, unknown> = Object.create({
      upload_id: 'inherited-asset',
      inheritedChild: { upload_id: 'inherited-child-asset' },
    });
    inheritedAsset.ownChild = { upload_id: 'own-asset' };

    expect(findUploadIds({ inheritedAsset })).toEqual(['own-asset']);
  });

  it('supports null-prototype payloads and an overridden hasOwnProperty key', () => {
    const asset: Record<string, unknown> = Object.create(null);
    asset.upload_id = 'own-asset';
    Object.defineProperty(asset, 'hasOwnProperty', {
      value: null,
      enumerable: true,
    });

    expect(findUploadIds({ asset })).toEqual(['own-asset']);
  });

  it('ignores empty IDs, other ID properties, and unstructured rich text URLs', () => {
    expect(
      findUploadIds({
        invalid: [
          { upload_id: '' },
          { upload_id: ' \n\t' },
          { upload_id: 42 },
          { upload_id: null },
          { uploadId: 'camel-case' },
          { image: 'seo-image-id' },
          { id: 'item-id', item: 'linked-record-id' },
        ],
        markdown: '![image](https://www.datocms-assets.com/123/image.jpg)',
        html: '<img src="https://www.datocms-assets.com/123/image.jpg">',
      }),
    ).toBeNull();
  });

  it('returns null for empty payloads and absent assets', () => {
    expect(findUploadIds({})).toBeNull();
    expect(findUploadIds({ absent: null, title: 'text', count: 1 })).toBeNull();
  });

  it('terminates on object and array cycles', () => {
    const record: Record<string, unknown> = {
      image: { upload_id: 'image-asset' },
    };
    const children: unknown[] = [record, { upload_id: 'array-asset' }];
    record.self = record;
    record.children = children;
    children.push(children);

    expect(findUploadIds(record)).toEqual(['image-asset', 'array-asset']);
  });

  it('visits a shared subtree once even when it has many incoming references', () => {
    let visits = 0;
    const shared = {
      get child() {
        visits += 1;
        return { upload_id: 'shared-asset' };
      },
    };

    expect(findUploadIds({ references: Array(1_000).fill(shared) })).toEqual([
      'shared-asset',
    ]);
    expect(visits).toBe(1);
  });

  it('handles 30,000 nested object and array levels without a call stack overflow', () => {
    let nested: unknown = { upload_id: 'deep-asset' };
    for (let level = 0; level < 30_000; level += 1) {
      nested = level % 2 === 0 ? [nested] : { child: nested };
    }

    expect(findUploadIds({ nested })).toEqual(['deep-asset']);
  });

  it('collects 10,000 unique assets across 200,000 shared references', () => {
    const assets = Array.from({ length: 10_000 }, (_, index) => ({
      upload_id: `asset-${index}`,
    }));
    const locales: Record<string, unknown> = {};
    for (let locale = 0; locale < 20; locale += 1) {
      locales[`locale-${locale}`] = [...assets];
    }

    expect(findUploadIds({ gallery: locales })).toEqual(
      assets.map((asset) => asset.upload_id),
    );
  });
});
