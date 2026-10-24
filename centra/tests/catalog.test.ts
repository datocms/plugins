import { describe, expect, it } from 'vitest';
import type { CentraDisplayItem, CentraItem } from '../src/lib/centraClient';
import {
  availabilityLabel,
  countLabel,
  fallbackIdentity,
  hasExactItemMatch,
  imageUrl,
  itemDetail,
  itemTitle,
  KIND_NOUNS,
  productTitle,
  rankItems,
  referenceStatus,
} from '../src/utils/catalog';

function displayItem(
  overrides: Partial<CentraDisplayItem> = {},
): CentraDisplayItem {
  return { id: 2752, media: [], items: [], ...overrides };
}

function item(overrides: Partial<CentraItem> = {}): CentraItem {
  return { id: 'item-1', ...overrides };
}

describe('titles', () => {
  it('falls back from the name to the variant, product number and ID', () => {
    expect(productTitle(displayItem({ name: ' Elina ' }))).toBe('Elina');
    expect(
      productTitle(
        displayItem({ name: ' ', productVariant: { name: 'Black' } }),
      ),
    ).toBe('Black');
    expect(productTitle(displayItem({ productNumber: 'P-100' }))).toBe(
      'Product P-100',
    );
    expect(productTitle(displayItem())).toBe('DisplayItem 2752');
  });

  it('falls back from the SKU name to its size, SKU and item ID', () => {
    expect(itemTitle(item({ name: 'Small' }))).toBe('Small');
    expect(itemTitle(item({ productSizeId: 4, sku: 'S-1' }))).toBe('Size 4');
    expect(itemTitle(item({ sku: 'S-1' }))).toBe('S-1');
    expect(itemTitle(item())).toBe('Item item-1');
  });

  it('keeps the saved IDs as the fallback identity', () => {
    expect(fallbackIdentity({ displayItemId: 558 })).toBe('DisplayItem 558');
    expect(fallbackIdentity({ displayItemId: 558, itemId: 'item-2' })).toBe(
      'Item item-2 · DisplayItem 558',
    );
  });

  it('leaves the size label out of a SKU detail when it is the SKU', () => {
    const product = displayItem({
      productVariant: { name: 'Black' },
      price: {
        value: 120,
        formattedValue: '£120.00',
        currency: { code: 'GBP' },
      },
    });
    expect(
      itemDetail(product, item({ name: 'S', sku: 'ELINA-BLACK' })).join(' · '),
    ).toBe('S · Black · SKU ELINA-BLACK · £120.00');
    expect(itemDetail(product, item({ sku: 'ELINA-BLACK' }))).toEqual([
      'Black',
      'SKU ELINA-BLACK',
      '£120.00',
    ]);
  });
});

describe('imageUrl', () => {
  it('is null without a display item or media', () => {
    expect(imageUrl(undefined)).toBeNull();
    expect(imageUrl(displayItem())).toBeNull();
  });

  it('prefers the first image, else the first media', () => {
    const video = { id: 1, source: { url: 'video.mp4', type: 'video' } };
    const image = { id: 2, source: { url: 'photo.jpg', type: 'IMAGE/jpeg' } };
    expect(imageUrl(displayItem({ media: [video, image] }))).toBe('photo.jpg');
    expect(imageUrl(displayItem({ media: [video] }))).toBe('video.mp4');
  });
});

describe('availability', () => {
  it('reads a picker card by the card rule', () => {
    expect(availabilityLabel(false, true)).toBe('Unavailable');
    expect(availabilityLabel(true, false)).toBe('Out of stock');
    expect(availabilityLabel(true, true)).toBe('Available');
    expect(availabilityLabel(true, undefined)).toBeNull();
  });

  it('reads a saved SKU by its own stock', () => {
    const product = displayItem({ available: true, hasStock: false });
    expect(referenceStatus(product, item({ stock: { available: true } }))).toBe(
      null,
    );
    expect(referenceStatus(product, undefined)).toBe('Out of stock');
    expect(referenceStatus(displayItem({ available: false }), undefined)).toBe(
      'Unavailable',
    );
  });
});

describe('rankItems', () => {
  const product = displayItem({
    items: [
      item({ id: 'a', sku: 'ELINA-S' }),
      item({ id: 'b', sku: 'ELINA-M' }),
      item({ id: 'c', sku: 'ELINA-L', GTIN: '7350' }),
    ],
  });

  it('puts exact SKU or GTIN matches first and keeps the rest in order', () => {
    expect(rankItems(product, ' elina-m ').map(({ id }) => id)).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(rankItems(product, '7350').map(({ id }) => id)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(rankItems(product, '').map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });

  it('matches only whole SKUs', () => {
    expect(hasExactItemMatch(product, 'ELINA-L')).toBe(true);
    expect(hasExactItemMatch(product, 'ELINA')).toBe(false);
    expect(hasExactItemMatch(product, '  ')).toBe(false);
  });
});

describe('countLabel', () => {
  it('names the thing counted, singular or plural', () => {
    expect(countLabel(1, KIND_NOUNS.primaryProduct, 'en')).toBe('1 product');
    expect(countLabel(0, KIND_NOUNS.item, 'en')).toBe('0 SKUs');
    expect(countLabel(2048, KIND_NOUNS.variant, 'en')).toBe(
      '2,048 product variants',
    );
  });

  it('formats the number for the locale, else in English', () => {
    expect(countLabel(2048, KIND_NOUNS.item, 'de')).toBe('2.048 SKUs');
    expect(countLabel(2048, KIND_NOUNS.item, 'not a locale!')).toBe(
      '2,048 SKUs',
    );
    expect(countLabel(2048, KIND_NOUNS.item)).toBe('2,048 SKUs');
  });
});
