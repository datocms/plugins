import { describe, expect, it } from 'vitest';
import {
  adminUrl,
  adminUrlForNode,
  availability,
  formatMoney,
  formatPriceRange,
  hasCompareAtPrice,
  nodeImage,
  nodeKind,
  nodeMeta,
  nodeTitle,
  pluralize,
  shopSubdomain,
  storefrontUrl,
  toShopifyLanguageCode,
  truncateMiddle,
} from '../src/lib/format';
import type {
  CollectionSummary,
  Money,
  ProductSummary,
  VariantSummary,
} from '../src/types';

// Shapes recorded from the demo store (Storefront API 2026-10).

const productImage = {
  url: 'https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_400x400.jpg',
  altText: 'A snowboard',
};

const product: ProductSummary = {
  __typename: 'Product',
  id: 'gid://shopify/Product/10080752009562',
  handle: 'the-complete-snowboard',
  title: 'The Complete Snowboard',
  vendor: 'Snowboard Vendor',
  productType: 'snowboard',
  availableForSale: true,
  onlineStoreUrl: null,
  updatedAt: '2026-07-18T23:38:42Z',
  featuredImage: productImage,
  priceRange: {
    minVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
    maxVariantPrice: { amount: '699.95', currencyCode: 'EUR' },
  },
  compareAtPriceRange: {
    maxVariantPrice: { amount: '0.0', currencyCode: 'EUR' },
  },
  variantsCount: { count: 5 },
  sku: null,
};

const variant: VariantSummary = {
  __typename: 'ProductVariant',
  id: 'gid://shopify/ProductVariant/50698337681754',
  title: 'Ice',
  sku: 'SB-ICE',
  barcode: null,
  availableForSale: true,
  currentlyNotInStock: false,
  selectedOptions: [{ name: 'Color', value: 'Ice' }],
  price: { amount: '699.95', currencyCode: 'EUR' },
  compareAtPrice: null,
  image: {
    url: 'https://cdn.shopify.com/s/files/ice_200x200.jpg',
    altText: null,
  },
  product: {
    id: 'gid://shopify/Product/10080752009562',
    handle: 'the-complete-snowboard',
    title: 'The Complete Snowboard',
    vendor: 'Snowboard Vendor',
    onlineStoreUrl: null,
    featuredImage: productImage,
  },
};

const collection: CollectionSummary = {
  __typename: 'Collection',
  id: 'gid://shopify/Collection/645261099354',
  handle: 'automated-collection',
  title: 'Automated Collection',
  updatedAt: '2026-07-18T23:38:45Z',
  onlineStoreUrl: null,
  image: null,
};

const money = (amount: string, currencyCode: string): Money => ({
  amount,
  currencyCode,
});

const intl = (locale: string, currency: string, value: number) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);

describe('formatMoney', () => {
  it('formats with Intl for the editor locale', () => {
    expect(formatMoney(money('40.0', 'CAD'), 'en')).toBe(intl('en', 'CAD', 40));
    expect(formatMoney(money('1234.5', 'EUR'), 'it')).toBe(
      intl('it', 'EUR', 1234.5),
    );
    expect(formatMoney(money('40.0', 'BRL'), 'pt-BR')).toBe(
      intl('pt-BR', 'BRL', 40),
    );
    expect(formatMoney(money('699.95', 'CNY'), 'zh-CN')).toBe(
      intl('zh-CN', 'CNY', 699.95),
    );
    expect(formatMoney(money('10.0', 'USD'), 'de')).toBe(intl('de', 'USD', 10));
  });

  it('respects the currency’s own decimals', () => {
    expect(formatMoney(money('1234.5', 'JPY'), 'en')).toBe(
      intl('en', 'JPY', 1234.5),
    );
    expect(formatMoney(money('1234.5', 'JPY'), 'en')).not.toContain('.');
  });

  it('pads Shopify’s one-decimal amounts', () => {
    expect(formatMoney(money('40.0', 'USD'), 'en')).toContain('40.00');
    expect(formatMoney(money('40.0', 'EUR'), 'it')).toContain('40,00');
  });

  it('accepts underscore locales and lowercase currencies', () => {
    expect(formatMoney(money('4', 'usd'), 'en_US')).toBe(
      intl('en-US', 'USD', 4),
    );
  });

  it('falls back to English for an invalid locale', () => {
    expect(formatMoney(money('40.0', 'CAD'), 'xx-invalid-!!')).toBe(
      intl('en', 'CAD', 40),
    );
    expect(formatMoney(money('40.0', 'CAD'), '')).toBe(intl('en', 'CAD', 40));
  });

  it('falls back to "amount CODE" for an invalid currency', () => {
    expect(formatMoney(money('40.0', 'EURO'), 'en')).toBe('40.00 EURO');
    expect(formatMoney(money('40', '€'), 'it')).toBe('40.00 €');
    expect(formatMoney(money('40.0', ''), 'en')).toBe('40.00');
  });

  it('keeps a non-numeric amount as it is', () => {
    expect(formatMoney(money('abc', 'CAD'), 'en')).toBe('abc CAD');
    expect(formatMoney(money('', 'CAD'), 'en')).toBe('CAD');
  });

  it('formats zero and large amounts', () => {
    expect(formatMoney(money('0.0', 'EUR'), 'en')).toBe(intl('en', 'EUR', 0));
    expect(formatMoney(money('2629.95', 'EUR'), 'en')).toBe(
      intl('en', 'EUR', 2629.95),
    );
  });
});

describe('formatPriceRange', () => {
  it('shows one price when min and max are equal', () => {
    expect(
      formatPriceRange(money('699.95', 'EUR'), money('699.95', 'EUR'), 'en'),
    ).toBe(intl('en', 'EUR', 699.95));
    expect(
      formatPriceRange(money('40.0', 'CAD'), money('40.00', 'CAD'), 'en'),
    ).toBe(intl('en', 'CAD', 40));
  });

  it('shows "from – to" with an en dash otherwise', () => {
    expect(
      formatPriceRange(money('10.0', 'EUR'), money('100.0', 'EUR'), 'it'),
    ).toBe(`${intl('it', 'EUR', 10)} – ${intl('it', 'EUR', 100)}`);
  });

  it('keeps each currency when they differ', () => {
    const range = formatPriceRange(
      money('10.0', 'EUR'),
      money('10.0', 'USD'),
      'en',
    );
    expect(range).toBe(`${intl('en', 'EUR', 10)} – ${intl('en', 'USD', 10)}`);
  });

  it('falls back per side', () => {
    expect(formatPriceRange(money('1', 'EURO'), money('2', 'EURO'), 'en')).toBe(
      '1.00 EURO – 2.00 EURO',
    );
  });
});

describe('hasCompareAtPrice', () => {
  it('is true only when compare-at is strictly greater', () => {
    expect(
      hasCompareAtPrice(money('785.95', 'EUR'), money('885.95', 'EUR')),
    ).toBe(true);
    expect(hasCompareAtPrice(money('10.0', 'EUR'), money('10.00', 'EUR'))).toBe(
      false,
    );
    expect(hasCompareAtPrice(money('10.0', 'EUR'), money('9.0', 'EUR'))).toBe(
      false,
    );
  });

  it('is false for Shopify’s "0.0" placeholder and missing values', () => {
    expect(
      hasCompareAtPrice(
        product.priceRange.minVariantPrice,
        product.compareAtPriceRange.maxVariantPrice,
      ),
    ).toBe(false);
    expect(hasCompareAtPrice(money('10.0', 'EUR'), null)).toBe(false);
    expect(hasCompareAtPrice(money('10.0', 'EUR'), undefined)).toBe(false);
  });

  it('is false across currencies and for unparseable amounts', () => {
    expect(hasCompareAtPrice(money('10.0', 'EUR'), money('20.0', 'USD'))).toBe(
      false,
    );
    expect(hasCompareAtPrice(money('', 'EUR'), money('20.0', 'EUR'))).toBe(
      false,
    );
    expect(hasCompareAtPrice(money('10', 'EUR'), money('x', 'EUR'))).toBe(
      false,
    );
  });
});

describe('shopSubdomain', () => {
  it('strips the myshopify suffix', () => {
    expect(shopSubdomain('acme.myshopify.com')).toBe('acme');
    expect(shopSubdomain('datocms-demo.myshopify.com')).toBe('datocms-demo');
    expect(shopSubdomain('  ACME.myshopify.com ')).toBe('acme');
  });

  it('tolerates a protocol, a path and a bare subdomain', () => {
    expect(shopSubdomain('https://acme.myshopify.com/admin')).toBe('acme');
    expect(shopSubdomain('acme')).toBe('acme');
  });

  it('returns an empty string for custom and empty domains', () => {
    expect(shopSubdomain('www.acme.com')).toBe('');
    expect(shopSubdomain('')).toBe('');
    expect(shopSubdomain('.myshopify.com')).toBe('');
  });
});

describe('adminUrl', () => {
  const shop = 'datocms-demo.myshopify.com';
  const base = 'https://admin.shopify.com/store/datocms-demo';

  it('links products', () => {
    expect(
      adminUrl(shop, { kind: 'product', id: 'gid://shopify/Product/123' }),
    ).toBe(`${base}/products/123`);
  });

  it('links variants under their product', () => {
    expect(
      adminUrl(shop, {
        kind: 'variant',
        id: 'gid://shopify/ProductVariant/456',
        productId: 'gid://shopify/Product/123',
      }),
    ).toBe(`${base}/products/123/variants/456`);
  });

  it('needs a product ID for variants', () => {
    expect(
      adminUrl(shop, {
        kind: 'variant',
        id: 'gid://shopify/ProductVariant/456',
      }),
    ).toBeNull();
    expect(
      adminUrl(shop, {
        kind: 'variant',
        id: 'gid://shopify/ProductVariant/456',
        productId: null,
      }),
    ).toBeNull();
    expect(
      adminUrl(shop, {
        kind: 'variant',
        id: 'gid://shopify/ProductVariant/456',
        productId: 'gid://shopify/Collection/1',
      }),
    ).toBeNull();
  });

  it('links collections', () => {
    expect(
      adminUrl(shop, {
        kind: 'collection',
        id: 'gid://shopify/Collection/789',
      }),
    ).toBe(`${base}/collections/789`);
  });

  it('keeps numeric IDs beyond Number.MAX_SAFE_INTEGER intact', () => {
    expect(
      adminUrl(shop, {
        kind: 'product',
        id: 'gid://shopify/Product/90071992547409931',
      }),
    ).toBe(`${base}/products/90071992547409931`);
  });

  it('accepts base64-encoded GIDs from 1.x values', () => {
    expect(
      adminUrl(shop, {
        kind: 'product',
        id: 'Z2lkOi8vc2hvcGlmeS9Qcm9kdWN0LzE=',
      }),
    ).toBe(`${base}/products/1`);
  });

  it('rejects IDs of another kind, non-GIDs and custom domains', () => {
    expect(
      adminUrl(shop, { kind: 'product', id: 'gid://shopify/Collection/789' }),
    ).toBeNull();
    expect(adminUrl(shop, { kind: 'product', id: 'classic-tee' })).toBeNull();
    expect(
      adminUrl('www.acme.com', {
        kind: 'product',
        id: 'gid://shopify/Product/1',
      }),
    ).toBeNull();
  });

  it('builds URLs from hydrated nodes', () => {
    expect(nodeKind(product)).toBe('product');
    expect(nodeKind(variant)).toBe('variant');
    expect(nodeKind(collection)).toBe('collection');
    expect(adminUrlForNode(shop, product)).toBe(
      `${base}/products/10080752009562`,
    );
    expect(adminUrlForNode(shop, variant)).toBe(
      `${base}/products/10080752009562/variants/50698337681754`,
    );
    expect(adminUrlForNode(shop, collection)).toBe(
      `${base}/collections/645261099354`,
    );
  });
});

describe('storefrontUrl', () => {
  const productUrl = 'https://acme.com/products/the-complete-snowboard';

  it('returns null without an online store URL (headless stores)', () => {
    expect(storefrontUrl(product)).toBeNull();
    expect(storefrontUrl(variant)).toBeNull();
    expect(storefrontUrl(collection)).toBeNull();
    expect(storefrontUrl({ ...product, onlineStoreUrl: '  ' })).toBeNull();
  });

  it('returns product and collection URLs as they are', () => {
    expect(storefrontUrl({ ...product, onlineStoreUrl: productUrl })).toBe(
      productUrl,
    );
    expect(
      storefrontUrl({
        ...collection,
        onlineStoreUrl: 'https://acme.com/collections/summer',
      }),
    ).toBe('https://acme.com/collections/summer');
  });

  it('adds ?variant= to the product URL for variants', () => {
    const withUrl = (onlineStoreUrl: string): VariantSummary => ({
      ...variant,
      product: { ...variant.product, onlineStoreUrl },
    });
    expect(storefrontUrl(withUrl(productUrl))).toBe(
      `${productUrl}?variant=50698337681754`,
    );
    expect(storefrontUrl(withUrl(`${productUrl}?ref=dato`))).toBe(
      `${productUrl}?ref=dato&variant=50698337681754`,
    );
    expect(storefrontUrl(withUrl(`${productUrl}?`))).toBe(
      `${productUrl}?variant=50698337681754`,
    );
    expect(storefrontUrl(withUrl(`${productUrl}#reviews`))).toBe(
      `${productUrl}?variant=50698337681754#reviews`,
    );
  });

  it('drops anything but absolute http(s) URLs', () => {
    const unsafe = [
      'javascript:alert(1)',
      ' JavaScript:alert(document.domain)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'blob:https://acme.com/1234',
      'ftp://acme.com/products/board',
      '/products/the-complete-snowboard',
      'acme.com/products/the-complete-snowboard',
    ];
    for (const onlineStoreUrl of unsafe) {
      expect(storefrontUrl({ ...product, onlineStoreUrl })).toBeNull();
      expect(storefrontUrl({ ...collection, onlineStoreUrl })).toBeNull();
      expect(
        storefrontUrl({
          ...variant,
          product: { ...variant.product, onlineStoreUrl },
        }),
      ).toBeNull();
    }
    expect(
      storefrontUrl({ ...product, onlineStoreUrl: ' http://acme.com/p/x ' }),
    ).toBe('http://acme.com/p/x');
  });

  it('falls back to the product URL when the variant ID is unusable', () => {
    expect(
      storefrontUrl({
        ...variant,
        id: 'not-a-gid',
        product: { ...variant.product, onlineStoreUrl: productUrl },
      }),
    ).toBe(productUrl);
  });
});

describe('nodeTitle', () => {
  it('uses the title for products and collections', () => {
    expect(nodeTitle(product)).toBe('The Complete Snowboard');
    expect(nodeTitle(collection)).toBe('Automated Collection');
  });

  it('prefixes variants with their product', () => {
    expect(nodeTitle(variant)).toBe('The Complete Snowboard — Ice');
    expect(nodeTitle({ ...variant, title: 'Black / M' })).toBe(
      'The Complete Snowboard — Black / M',
    );
    expect(nodeTitle({ ...variant, title: 'Default Title' })).toBe(
      'The Complete Snowboard',
    );
  });
});

describe('nodeImage', () => {
  it('returns each kind’s image', () => {
    expect(nodeImage(product)).toEqual(productImage);
    expect(nodeImage(variant)).toEqual(variant.image);
    expect(nodeImage(collection)).toBeNull();
    expect(
      nodeImage({ ...collection, image: { url: 'c.jpg', altText: null } }),
    ).toEqual({ url: 'c.jpg', altText: null });
  });

  it('falls back from the variant image to the product image', () => {
    expect(nodeImage({ ...variant, image: null })).toEqual(productImage);
    expect(
      nodeImage({
        ...variant,
        image: null,
        product: { ...variant.product, featuredImage: null },
      }),
    ).toBeNull();
    expect(nodeImage({ ...product, featuredImage: null })).toBeNull();
  });
});

describe('nodeMeta', () => {
  it('shows vendor · product type, skipping empties', () => {
    expect(nodeMeta(product)).toBe('Snowboard Vendor · snowboard');
    expect(nodeMeta({ ...product, productType: '' })).toBe('Snowboard Vendor');
    expect(nodeMeta({ ...product, vendor: ' ' })).toBe('snowboard');
    expect(nodeMeta({ ...product, vendor: '', productType: '' })).toBe('');
  });

  it('shows option values and the SKU for variants', () => {
    expect(nodeMeta(variant)).toBe('Ice · SKU SB-ICE');
    expect(
      nodeMeta({
        ...variant,
        sku: 'TEE-BLK-M',
        selectedOptions: [
          { name: 'Color', value: 'Black' },
          { name: 'Size', value: 'M' },
        ],
      }),
    ).toBe('Black / M · SKU TEE-BLK-M');
    expect(nodeMeta({ ...variant, sku: null })).toBe('Ice');
    expect(nodeMeta({ ...variant, sku: '  ' })).toBe('Ice');
  });

  it('skips Shopify’s "Default Title" option', () => {
    const defaultVariant: VariantSummary = {
      ...variant,
      title: 'Default Title',
      sku: 'sku-managed-1',
      selectedOptions: [{ name: 'Title', value: 'Default Title' }],
    };
    expect(nodeMeta(defaultVariant)).toBe('SKU sku-managed-1');
    expect(nodeMeta({ ...defaultVariant, sku: null })).toBe('');
  });

  it('shows the handle for collections, as the picker does', () => {
    expect(nodeMeta(collection)).toBe('automated-collection');
    expect(nodeMeta({ ...collection, handle: ' frontpage ' })).toBe(
      'frontpage',
    );
    expect(nodeMeta({ ...collection, handle: '' })).toBe('');
  });
});

describe('availability', () => {
  it('reads Available / Sold out for products', () => {
    expect(availability(product)).toEqual({
      label: 'Available',
      tone: 'success',
      quantity: null,
    });
    expect(availability({ ...product, availableForSale: false })).toEqual({
      label: 'Sold out',
      tone: 'danger',
      quantity: null,
    });
  });

  it('reads Available / Sold out / Available to order for variants', () => {
    expect(availability(variant)).toMatchObject({
      label: 'Available',
      tone: 'success',
    });
    expect(availability({ ...variant, availableForSale: false })).toMatchObject(
      {
        label: 'Sold out',
        tone: 'danger',
      },
    );
    expect(
      availability({ ...variant, currentlyNotInStock: true }),
    ).toMatchObject({ label: 'Available to order', tone: 'neutral' });
    expect(
      availability({
        ...variant,
        availableForSale: false,
        currentlyNotInStock: true,
      }),
    ).toMatchObject({ label: 'Sold out', tone: 'danger' });
  });

  it('shows quantities only with the inventory capability', () => {
    const stocked = { ...product, totalInventory: 12 };
    expect(availability(stocked).quantity).toBeNull();
    expect(availability(stocked, { inventory: false }).quantity).toBeNull();
    expect(availability(stocked, { inventory: true }).quantity).toBe(12);
    expect(
      availability({ ...variant, quantityAvailable: 0 }, { inventory: true }),
    ).toEqual({ label: 'Available', tone: 'success', quantity: 0 });
    expect(
      availability({ ...variant, quantityAvailable: null }, { inventory: true })
        .quantity,
    ).toBeNull();
    expect(availability(product, { inventory: true }).quantity).toBeNull();
  });

  it('is neutral and empty for collections', () => {
    expect(availability(collection, { inventory: true })).toEqual({
      label: '',
      tone: 'neutral',
      quantity: null,
    });
  });
});

describe('toShopifyLanguageCode', () => {
  const ALL = [
    'EN',
    'IT',
    'DE',
    'PT',
    'PT_BR',
    'PT_PT',
    'ZH',
    'ZH_CN',
    'ZH_TW',
    'NB',
    'NO',
    'NN',
    'HE',
    'FIL',
  ];

  it('maps base languages', () => {
    expect(toShopifyLanguageCode('en', ALL)).toBe('EN');
    expect(toShopifyLanguageCode('it', ALL)).toBe('IT');
    expect(toShopifyLanguageCode('nb', ALL)).toBe('NB');
    expect(toShopifyLanguageCode('no', ALL)).toBe('NO');
    expect(toShopifyLanguageCode('nn', ALL)).toBe('NN');
    expect(toShopifyLanguageCode('fil', ALL)).toBe('FIL');
  });

  it('maps regional locales to Shopify’s regional codes', () => {
    expect(toShopifyLanguageCode('pt-BR', ALL)).toBe('PT_BR');
    expect(toShopifyLanguageCode('pt-PT', ALL)).toBe('PT_PT');
    expect(toShopifyLanguageCode('zh-CN', ALL)).toBe('ZH_CN');
    expect(toShopifyLanguageCode('zh-TW', ALL)).toBe('ZH_TW');
    expect(toShopifyLanguageCode('pt_BR', ALL)).toBe('PT_BR');
  });

  it('maps Chinese scripts and regions', () => {
    expect(toShopifyLanguageCode('zh-Hant', ALL)).toBe('ZH_TW');
    expect(toShopifyLanguageCode('zh-Hans', ALL)).toBe('ZH_CN');
    expect(toShopifyLanguageCode('zh-Hant-HK', ALL)).toBe('ZH_TW');
    expect(toShopifyLanguageCode('zh-HK', ALL)).toBe('ZH_TW');
    expect(toShopifyLanguageCode('zh-SG', ALL)).toBe('ZH_CN');
    expect(toShopifyLanguageCode('zh', ALL)).toBe('ZH');
  });

  it('falls back from region-specific to the base language', () => {
    expect(toShopifyLanguageCode('en-US', ALL)).toBe('EN');
    expect(toShopifyLanguageCode('en-GB', ['EN'])).toBe('EN');
    expect(toShopifyLanguageCode('de-AT', ALL)).toBe('DE');
    expect(toShopifyLanguageCode('pt-BR', ['EN', 'PT'])).toBe('PT');
    expect(toShopifyLanguageCode('zh-Hant', ['ZH'])).toBe('ZH');
  });

  it('bridges Norwegian and legacy codes', () => {
    expect(toShopifyLanguageCode('no', ['NB'])).toBe('NB');
    expect(toShopifyLanguageCode('nb', ['NO'])).toBe('NO');
    expect(toShopifyLanguageCode('nb-NO', ['NB'])).toBe('NB');
    expect(toShopifyLanguageCode('iw', ['HE'])).toBe('HE');
    expect(toShopifyLanguageCode('tl', ['FIL'])).toBe('FIL');
  });

  it('picks the only regional code for a bare language', () => {
    expect(toShopifyLanguageCode('pt', ['EN', 'PT_PT'])).toBe('PT_PT');
    expect(toShopifyLanguageCode('zh', ['ZH_TW'])).toBe('ZH_TW');
    expect(toShopifyLanguageCode('pt', ['PT_BR', 'PT_PT'])).toBeUndefined();
  });

  it('never swaps one region for another', () => {
    expect(toShopifyLanguageCode('pt-BR', ['EN', 'PT_PT'])).toBeUndefined();
    expect(toShopifyLanguageCode('zh-CN', ['ZH_TW'])).toBeUndefined();
  });

  it('only returns languages the store offers', () => {
    expect(toShopifyLanguageCode('it', ['EN'])).toBeUndefined();
    expect(toShopifyLanguageCode('en', [])).toBeUndefined();
  });

  it('matches available codes case-insensitively', () => {
    expect(toShopifyLanguageCode('pt-BR', ['pt_br'])).toBe('PT_BR');
  });

  it('rejects malformed locales', () => {
    expect(toShopifyLanguageCode('', ALL)).toBeUndefined();
    expect(toShopifyLanguageCode('english', ALL)).toBeUndefined();
    expect(toShopifyLanguageCode('-', ALL)).toBeUndefined();
  });
});

describe('pluralize', () => {
  it('uses the singular only for one', () => {
    expect(pluralize(1, 'variant')).toBe('1 variant');
    expect(pluralize(3, 'variant')).toBe('3 variants');
    expect(pluralize(0, 'variant')).toBe('0 variants');
  });

  it('accepts an irregular plural', () => {
    expect(pluralize(2, 'match', 'matches')).toBe('2 matches');
    expect(pluralize(1, 'match', 'matches')).toBe('1 match');
  });
});

describe('truncateMiddle', () => {
  it('leaves short values alone', () => {
    expect(truncateMiddle('classic-tee', 20)).toBe('classic-tee');
    expect(truncateMiddle('classic-tee', 11)).toBe('classic-tee');
  });

  it('keeps the start and slightly more of the end', () => {
    const gid = 'gid://shopify/ProductVariant/50698337681754';
    const truncated = truncateMiddle(gid, 24);
    expect(Array.from(truncated)).toHaveLength(24);
    expect(truncated).toBe('gid://shopi…698337681754');
    expect(truncateMiddle('abcdefghij', 5)).toBe('ab…ij');
    expect(truncateMiddle('abcdefghij', 4)).toBe('a…ij');
  });

  it('handles tiny limits', () => {
    expect(truncateMiddle('abcdef', 1)).toBe('…');
    expect(truncateMiddle('abcdef', 0)).toBe('');
    expect(truncateMiddle('abcdef', 2)).toBe('…f');
  });

  it('does not split surrogate pairs', () => {
    expect(truncateMiddle('🏂🏂🏂🏂🏂🏂', 4)).toBe('🏂…🏂🏂');
  });
});
