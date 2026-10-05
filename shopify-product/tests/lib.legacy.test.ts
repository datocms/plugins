import { describe, expect, it } from 'vitest';
import {
  fullSizeShopifyImageUrl,
  buildLegacyProductJson,
  legacyJsonDrift,
  normalizeShopifyImageUrl,
  sameShopifyHandle,
  serializeLegacyProductJson,
} from '../src/lib/legacy';
import type { LegacyProductJson, LegacyProductNode } from '../src/types';
import recorded1xText from './fixtures/legacy-1x-product.json?raw';
import recordedNode from './fixtures/legacy-product-node-2026-10.json';
import base64IdText from './fixtures/legacy-base64-id.json?raw';
import cropCenterText from './fixtures/legacy-crop-center-image.json?raw';
import twoHundredText from './fixtures/legacy-200x200-image.json?raw';

/**
 * Golden fixtures, recorded from the demo store on 2026-10-03:
 * - legacy-1x-product.json: the exact 1.x query (productByHandle,
 *   transformedSrc) on the unversioned endpoint (answered by 2025-10), run
 *   through 1.x `normalizeProduct` and `JSON.stringify`, byte for byte.
 * - legacy-product-node-2026-10.json: the raw `LegacyProduct` fragment node
 *   for the same product id on 2026-10.
 * The other legacy-*.json fixtures are hand-made from the recording.
 */
const recorded1x = JSON.parse(recorded1xText) as LegacyProductJson;
/**
 * The recorded value as 1.x wrote it: compact `JSON.stringify`. Re-serializing
 * keeps key order and values, so this survives a formatter touching the file.
 */
const recorded1xCompact = JSON.stringify(recorded1x);
const node = recordedNode as LegacyProductNode;

/** Every key path in document order, recursively (array items by index). */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => keyPaths(item, `${prefix}${index}.`));
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    `${prefix}${key}`,
    ...keyPaths(child, `${prefix}${key}.`),
  ]);
}

function freshJson(
  overrides: Partial<LegacyProductJson> = {},
): LegacyProductJson {
  return { ...buildLegacyProductJson(node), ...overrides };
}

describe('buildLegacyProductJson (golden test against 1.x)', () => {
  const built = buildLegacyProductJson(node);

  it('has the same keys in the same order, recursively', () => {
    expect(keyPaths(built)).toEqual(keyPaths(recorded1x));
    expect(Object.keys(built)).toEqual([
      'id',
      'title',
      'handle',
      'description',
      'onlineStoreUrl',
      'availableForSale',
      'productType',
      'priceRange',
      'images',
      'imageUrl',
      'previewImageUrl',
    ]);
    expect(Object.keys(built.priceRange)).toEqual([
      'maxVariantPrice',
      'minVariantPrice',
    ]);
  });

  it('has identical image URLs', () => {
    const builtImage = built.images.edges[0]?.node;
    const recordedImage = recorded1x.images.edges[0]?.node;
    expect(builtImage?.src).toBe(recordedImage?.src);
    expect(builtImage?.previewSrc).toBe(recordedImage?.previewSrc);
    expect(built.imageUrl).toBe(recorded1x.imageUrl);
    expect(built.previewImageUrl).toBe(recorded1x.previewImageUrl);
    expect(built.previewImageUrl).toMatch(/_200x200\.jpg\?v=\d+$/);
  });

  it('has identical values and serializes byte for byte like 1.x', () => {
    expect(built).toEqual(recorded1x);
    expect(serializeLegacyProductJson(built)).toBe(recorded1xCompact);
  });

  it('keeps fields 1.x never stored out of the value', () => {
    const withTypename = {
      __typename: 'Product',
      ...node,
    } as LegacyProductNode;
    expect(keyPaths(buildLegacyProductJson(withTypename))).toEqual(
      keyPaths(recorded1x),
    );
  });

  it('applies the 1.x image fallbacks', () => {
    const noImages = buildLegacyProductJson({ ...node, images: { edges: [] } });
    expect(noImages.imageUrl).toBe('');
    expect(noImages.previewImageUrl).toBe('');
    expect(noImages.images).toEqual({ edges: [] });

    const noPreview = buildLegacyProductJson({
      ...node,
      images: {
        edges: [{ node: { src: 'https://cdn/a.jpg', previewSrc: '' } }],
      },
    });
    expect(noPreview.imageUrl).toBe('https://cdn/a.jpg');
    expect(noPreview.previewImageUrl).toBe('https://cdn/a.jpg');
  });

  it('does not share nested objects with the node', () => {
    const built2 = buildLegacyProductJson(node);
    expect(built2.priceRange.minVariantPrice).not.toBe(
      node.priceRange.minVariantPrice,
    );
    expect(built2.images.edges[0]).not.toBe(node.images.edges[0]);
  });
});

describe('serializeLegacyProductJson', () => {
  it('writes compact JSON like 1.x', () => {
    const serialized = serializeLegacyProductJson(recorded1x);
    expect(serialized).not.toContain('\n');
    expect(serialized.startsWith('{"id":"gid://shopify/Product/')).toBe(true);
    expect(JSON.parse(serialized)).toEqual(recorded1x);
  });
});

describe('normalizeShopifyImageUrl', () => {
  const base =
    'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d';

  it.each([
    [`${base}.jpg?v=1741717811`],
    [`${base}_200x200.jpg?v=1741717811`],
    [`${base}_200x200_crop_center.jpg?v=1741717811`],
    [`${base}_crop_center.jpg`],
    [`${base}_400x400.jpg?v=1`],
    [`${base}_200x.jpg?v=1`],
    [`${base}_x200.jpg`],
    [`${base}_200x200@2x.jpg?v=1`],
    [`${base}.jpg#top`],
  ])('normalizes %s to the source image', (url) => {
    expect(normalizeShopifyImageUrl(url)).toBe(`${base}.jpg`);
  });

  it('keeps different images apart', () => {
    expect(normalizeShopifyImageUrl(`${base}.png`)).not.toBe(
      normalizeShopifyImageUrl(`${base}.jpg`),
    );
    expect(normalizeShopifyImageUrl('https://cdn/other_200x200.jpg')).toBe(
      'https://cdn/other.jpg',
    );
    expect(normalizeShopifyImageUrl('')).toBe('');
  });
});

describe('fullSizeShopifyImageUrl', () => {
  const base =
    'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_abc';

  it('drops the transform suffix and keeps the cache key', () => {
    expect(fullSizeShopifyImageUrl(`${base}_400x400.jpg?v=17`)).toBe(
      `${base}.jpg?v=17`,
    );
    expect(fullSizeShopifyImageUrl(`${base}_200x200_crop_center.png`)).toBe(
      `${base}.png`,
    );
    expect(fullSizeShopifyImageUrl(`${base}_x200@2x.webp?v=1#x`)).toBe(
      `${base}.webp?v=1#x`,
    );
  });

  it('leaves full-size and non-Shopify URLs alone', () => {
    expect(fullSizeShopifyImageUrl(`${base}.jpg?v=17`)).toBe(
      `${base}.jpg?v=17`,
    );
    expect(
      fullSizeShopifyImageUrl('https://example.com/image_400x400.jpg'),
    ).toBe('https://example.com/image_400x400.jpg');
  });

  it('keeps underscores that are part of the file name', () => {
    expect(fullSizeShopifyImageUrl(`${base}_final_v2.jpg`)).toBe(
      `${base}_final_v2.jpg`,
    );
  });
});

describe('sameShopifyHandle', () => {
  it('compares handles the way the Storefront API resolves them', () => {
    expect(sameShopifyHandle('the-board', 'the-board')).toBe(true);
    expect(sameShopifyHandle('The-Board', 'the-board')).toBe(true);
    expect(sameShopifyHandle(' the-board ', 'the-board')).toBe(true);
    expect(sameShopifyHandle('the-board-2', 'the-board')).toBe(false);
  });
});

describe('legacyJsonDrift', () => {
  it('reports nothing for an unchanged value', () => {
    expect(legacyJsonDrift(recorded1x, freshJson())).toEqual({
      changed: false,
      fields: [],
    });
  });

  it.each([
    ['pre-1.0.1 _crop_center thumbnails', cropCenterText],
    ['pre-1.0.10 200x200 thumbnails', twoHundredText],
    ['base64 ids', base64IdText],
  ])('does not report drift for %s by themselves', (_label, text) => {
    const stored = JSON.parse(text) as Partial<LegacyProductJson>;
    expect(legacyJsonDrift(stored, freshJson())).toEqual({
      changed: false,
      fields: [],
    });
  });

  it('reports each changed field', () => {
    const fresh = freshJson({
      title: 'Renamed',
      handle: 'renamed',
      priceRange: {
        maxVariantPrice: { amount: '799.95', currencyCode: 'EUR' },
        minVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
      },
      imageUrl: 'https://cdn.shopify.com/s/files/1/new-image.jpg?v=2',
    });
    expect(legacyJsonDrift(recorded1x, fresh)).toEqual({
      changed: true,
      fields: ['title', 'price', 'image', 'handle'],
    });
  });

  it('compares currency codes and amounts numerically', () => {
    const otherCurrency = freshJson({
      priceRange: {
        maxVariantPrice: { amount: '699.95', currencyCode: 'USD' },
        minVariantPrice: { amount: '699.95', currencyCode: 'USD' },
      },
    });
    expect(legacyJsonDrift(recorded1x, otherCurrency).fields).toEqual([
      'price',
    ]);

    const sameNumber = freshJson({
      priceRange: {
        maxVariantPrice: { amount: '699.950', currencyCode: 'EUR' },
        minVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
      },
    });
    expect(legacyJsonDrift(recorded1x, sameNumber).changed).toBe(false);
  });

  it('compares handles case-insensitively and ignoring padding', () => {
    for (const handle of [
      'The-Complete-Snowboard',
      ' the-complete-snowboard ',
    ]) {
      expect(legacyJsonDrift({ ...recorded1x, handle }, freshJson())).toEqual({
        changed: false,
        fields: [],
      });
    }
    expect(
      legacyJsonDrift({ ...recorded1x, handle: 'complete-board' }, freshJson())
        .fields,
    ).toEqual(['handle']);
  });

  it('treats missing stored keys as changed', () => {
    expect(
      legacyJsonDrift({ handle: 'the-complete-snowboard' }, freshJson()),
    ).toEqual({ changed: true, fields: ['title', 'price', 'image'] });
  });

  it('falls back to the first edge when imageUrl is missing', () => {
    const { imageUrl: _imageUrl, ...withoutImageUrl } = JSON.parse(
      cropCenterText,
    ) as LegacyProductJson;
    expect(legacyJsonDrift(withoutImageUrl, freshJson()).changed).toBe(false);
  });

  it('reports an image that was added or removed', () => {
    const noImage = freshJson({ imageUrl: '', previewImageUrl: '' });
    expect(legacyJsonDrift(recorded1x, noImage).fields).toEqual(['image']);
    expect(legacyJsonDrift(noImage, freshJson()).fields).toEqual(['image']);
  });

  it('survives untrusted stored values', () => {
    const garbage = {
      title: 42,
      priceRange: 'free',
      images: { edges: 'none' },
    } as unknown as Partial<LegacyProductJson>;
    expect(legacyJsonDrift(garbage, freshJson()).fields).toEqual([
      'title',
      'price',
      'image',
      'handle',
    ]);
  });
});
