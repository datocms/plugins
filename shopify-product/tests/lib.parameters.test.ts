import { describe, expect, it } from 'vitest';
import {
  ADMIN_TOKEN_ERROR,
  allowedCardinalities,
  allowedFormats,
  allowedKinds,
  CUSTOM_DOMAIN_ERROR,
  defaultFieldParameters,
  EMPTY_SHOP_DOMAIN_ERROR,
  EMPTY_TOKEN_ERROR,
  getActiveStores,
  INVALID_SHOP_DOMAIN_ERROR,
  isCurrentPluginParameters,
  isEmptyFieldParameters,
  isPluginConfigured,
  isStoreUsable,
  isValidCombination,
  LEGACY_FIELD_PARAMETERS,
  normalizeFieldParameters,
  normalizePluginParameters,
  normalizeShopDomain,
  normalizeStoreConnection,
  resolveFieldStore,
  storeLabel,
  TOKEN_WHITESPACE_ERROR,
  validateFieldParameters,
  validateStorefrontToken,
} from '../src/lib/parameters';
import {
  type Cardinality,
  DEMO_STORE,
  type FieldType,
  type PluginParametersV3,
  type ShopifyKind,
  type StorageFormat,
  type StoreConnection,
} from '../src/types';

const ACME: StoreConnection = {
  shopDomain: 'acme.myshopify.com',
  storefrontAccessToken: 'acme-token',
  tokenless: false,
};

const BETA: StoreConnection = {
  shopDomain: 'beta.myshopify.com',
  storefrontAccessToken: '',
  tokenless: true,
  label: 'Beta EU',
};

function params(
  overrides: Partial<PluginParametersV3> = {},
): PluginParametersV3 {
  return {
    paramsVersion: '3',
    stores: [ACME, BETA],
    useDemoStore: false,
    autoApplyToFieldsWithApiKey: '',
    ...overrides,
  };
}

const EMPTY_PARAMETERS: PluginParametersV3 = {
  paramsVersion: '3',
  stores: [],
  useDemoStore: false,
  autoApplyToFieldsWithApiKey: '',
};

describe('normalizeShopDomain', () => {
  it.each([
    'acme',
    'acme.myshopify.com',
    'ACME.myshopify.com ',
    '  Acme  ',
    'https://acme.myshopify.com/anything?x',
    'http://acme.myshopify.com',
    'acme.myshopify.com/admin',
    'https://acme.myshopify.com:443/products/tee#reviews',
    'https://acme.myshopify.com.',
    'https:///acme.myshopify.com',
    'acme.myshopify.com:443',
    'acme.myshopify.com?utm_source=x',
    'https://admin.shopify.com/store/acme/products/1',
    'admin.shopify.com/store/acme',
    'HTTPS://ADMIN.SHOPIFY.COM/store/ACME',
  ])('accepts %j', (input) => {
    expect(normalizeShopDomain(input)).toEqual({
      ok: true,
      domain: 'acme.myshopify.com',
    });
  });

  it('keeps digits and inner hyphens', () => {
    expect(normalizeShopDomain('datocms-demo')).toEqual({
      ok: true,
      domain: 'datocms-demo.myshopify.com',
    });
    expect(normalizeShopDomain('123-shop-9.myshopify.com')).toEqual({
      ok: true,
      domain: '123-shop-9.myshopify.com',
    });
  });

  // The WHATWG URL parser reads these as IPv4 addresses (`12345` becomes
  // `0.0.48.57`), but they are valid shop names that 1.x saved bare.
  it.each([
    ['12345', '12345'],
    ['12345.myshopify.com', '12345'],
    ['https://12345', '12345'],
    ['https://12345.myshopify.com/products/tee', '12345'],
    ['12345/admin', '12345'],
    ['admin.shopify.com/store/12345', '12345'],
    ['0x1f', '0x1f'],
    ['0x1f.myshopify.com', '0x1f'],
    ['0777', '0777'],
  ])('keeps the numeric-looking shop name %j', (input, name) => {
    expect(normalizeShopDomain(input)).toEqual({
      ok: true,
      domain: `${name}.myshopify.com`,
    });
  });

  it.each(['', '   ', '\n'])('asks for a domain when given %j', (input) => {
    expect(normalizeShopDomain(input)).toEqual({
      ok: false,
      error: EMPTY_SHOP_DOMAIN_ERROR,
    });
  });

  it.each([
    'www.acme.com',
    'acme.com',
    'https://shop.acme.co.uk',
    'https://www.acme.com/products/tee',
    'acme.shopify.com',
    'myshopify.com',
  ])('rejects the custom domain %j', (input) => {
    expect(normalizeShopDomain(input)).toEqual({
      ok: false,
      error: CUSTOM_DOMAIN_ERROR,
    });
  });

  it('uses the exact custom domain copy', () => {
    expect(CUSTOM_DOMAIN_ERROR).toBe(
      'Enter your .myshopify.com domain (Shopify admin → Settings → Domains)',
    );
  });

  it.each([
    'acme store',
    'acme_store',
    '-acme',
    'acme-',
    'acme!',
    'ácme',
    'shop.acme.myshopify.com',
    '.myshopify.com',
    'https://admin.shopify.com',
    'https://admin.shopify.com/store/',
    'https://admin.shopify.com/products/1',
    'ftp://acme.myshopify.com',
    'https://',
    `${'a'.repeat(64)}.myshopify.com`,
    // Mistyped schemes must not turn into a shop called `https`.
    'https:/acme.myshopify.com',
    'https//acme.myshopify.com',
    'https:\\\\acme.myshopify.com',
    'https:acme.myshopify.com',
    'http:/acme.myshopify.com',
    'http//acme.myshopify.com',
    'htps:/acme.myshopify.com',
    'https:',
    'acme.myshopify.com//admin',
    'mailto:acme',
    'user@acme.myshopify.com',
  ])('rejects the invalid domain %j', (input) => {
    expect(normalizeShopDomain(input)).toEqual({
      ok: false,
      error: INVALID_SHOP_DOMAIN_ERROR,
    });
  });
});

describe('validateStorefrontToken', () => {
  it('accepts a public Storefront token, trimming the edges', () => {
    expect(
      validateStorefrontToken('6f39fb123179b7d636d84d833d3d3adf', false),
    ).toBeNull();
    expect(validateStorefrontToken('  abc123  ', false)).toBeNull();
  });

  it.each([
    'shpat_0123456789abcdef',
    'shpca_0123456789abcdef',
    'shppa_0123456789abcdef',
    '  SHPAT_0123456789abcdef',
    'shpat_with spaces',
  ])('rejects the Admin API token %j', (token) => {
    expect(validateStorefrontToken(token, false)).toBe(ADMIN_TOKEN_ERROR);
  });

  it('uses the exact Admin token copy', () => {
    expect(ADMIN_TOKEN_ERROR).toBe(
      "This is an Admin API token. Never paste it here: every editor's browser can read plugin settings. Use the public token from the Headless channel.",
    );
  });

  it('asks for a token unless the store is tokenless', () => {
    expect(validateStorefrontToken('', false)).toBe(EMPTY_TOKEN_ERROR);
    expect(validateStorefrontToken('   ', false)).toBe(EMPTY_TOKEN_ERROR);
    expect(EMPTY_TOKEN_ERROR).toBe(
      'Enter the Storefront access token, or connect without a token',
    );
  });

  it('rejects whitespace inside the token', () => {
    expect(validateStorefrontToken('abc def', false)).toBe(
      TOKEN_WHITESPACE_ERROR,
    );
    expect(validateStorefrontToken('abc\ndef', false)).toBe(
      TOKEN_WHITESPACE_ERROR,
    );
  });

  it('ignores the token entirely in tokenless mode', () => {
    expect(validateStorefrontToken('', true)).toBeNull();
    expect(validateStorefrontToken('shpat_secret', true)).toBeNull();
    expect(validateStorefrontToken('a b', true)).toBeNull();
  });
});

describe('normalizeStoreConnection', () => {
  it('returns null without a usable domain', () => {
    expect(normalizeStoreConnection(undefined)).toBeNull();
    expect(normalizeStoreConnection('acme')).toBeNull();
    expect(normalizeStoreConnection([])).toBeNull();
    expect(normalizeStoreConnection({})).toBeNull();
    expect(normalizeStoreConnection({ shopDomain: '' })).toBeNull();
    expect(normalizeStoreConnection({ shopDomain: 42 })).toBeNull();
    expect(normalizeStoreConnection({ shopDomain: 'www.acme.com' })).toBeNull();
  });

  it('normalizes the domain and trims the token', () => {
    expect(
      normalizeStoreConnection({
        shopDomain: ' https://ACME.myshopify.com/ ',
        storefrontAccessToken: '  acme-token ',
      }),
    ).toEqual(ACME);
  });

  it('defaults to a token, and empties the token when tokenless', () => {
    expect(normalizeStoreConnection({ shopDomain: 'acme' })).toEqual({
      shopDomain: 'acme.myshopify.com',
      storefrontAccessToken: '',
      tokenless: false,
    });
    expect(
      normalizeStoreConnection({
        shopDomain: 'acme',
        storefrontAccessToken: 'leftover',
        tokenless: true,
      }),
    ).toEqual({
      shopDomain: 'acme.myshopify.com',
      storefrontAccessToken: '',
      tokenless: true,
    });
    expect(
      normalizeStoreConnection({ shopDomain: 'acme', tokenless: 'yes' })
        ?.tokenless,
    ).toBe(false);
  });

  it('keeps well-formed optional settings, in a stable key order', () => {
    const store = normalizeStoreConnection({
      capabilities: {
        tags: true,
        inventory: false,
        metafields: true,
        checkedAt: '2026-10-03T10:00:00.000Z',
        extra: 'dropped',
      },
      defaultLanguage: 'pt-br',
      defaultCountry: ' us ',
      label: '  Main store ',
      tokenless: false,
      storefrontAccessToken: 'tok',
      shopDomain: 'acme',
      unknown: 'dropped',
    });
    expect(store).toEqual({
      shopDomain: 'acme.myshopify.com',
      storefrontAccessToken: 'tok',
      tokenless: false,
      label: 'Main store',
      defaultCountry: 'US',
      defaultLanguage: 'PT_BR',
      capabilities: {
        tags: true,
        inventory: false,
        metafields: true,
        checkedAt: '2026-10-03T10:00:00.000Z',
      },
    });
    expect(Object.keys(store ?? {})).toEqual([
      'shopDomain',
      'storefrontAccessToken',
      'tokenless',
      'label',
      'defaultCountry',
      'defaultLanguage',
      'capabilities',
    ]);
  });

  it('drops malformed optional settings', () => {
    const store = normalizeStoreConnection({
      shopDomain: 'acme',
      storefrontAccessToken: 'tok',
      label: '   ',
      defaultCountry: 'USA',
      defaultLanguage: 'english',
      capabilities: { tags: true, inventory: false, metafields: true },
    });
    expect(store).toEqual({
      shopDomain: 'acme.myshopify.com',
      storefrontAccessToken: 'tok',
      tokenless: false,
    });
    expect(store && 'label' in store).toBe(false);
  });

  it('requires every capability with the right type', () => {
    const base = {
      tags: true,
      inventory: true,
      metafields: false,
      checkedAt: '2026-10-03T10:00:00.000Z',
    };
    const withCapabilities = (capabilities: unknown) =>
      normalizeStoreConnection({ shopDomain: 'acme', capabilities })
        ?.capabilities;

    expect(withCapabilities(base)).toEqual(base);
    expect(withCapabilities({ ...base, tags: 'true' })).toBeUndefined();
    expect(withCapabilities({ ...base, inventory: 1 })).toBeUndefined();
    expect(withCapabilities({ ...base, checkedAt: 0 })).toBeUndefined();
    expect(withCapabilities('all')).toBeUndefined();
  });

  it('accepts three-letter and regional language codes', () => {
    const language = (defaultLanguage: string) =>
      normalizeStoreConnection({ shopDomain: 'acme', defaultLanguage })
        ?.defaultLanguage;
    expect(language('en')).toBe('EN');
    expect(language('fil')).toBe('FIL');
    expect(language('ZH_TW')).toBe('ZH_TW');
    expect(language('e')).toBeUndefined();
  });
});

describe('normalizePluginParameters', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty object', {}],
    ['a string', 'acme'],
    ['a number', 42],
    ['an array', [{ shopDomain: 'acme' }]],
    ['unknown keys', { foo: 'bar' }],
  ])('turns %s into empty v3 parameters', (_label, raw) => {
    expect(normalizePluginParameters(raw)).toEqual(EMPTY_PARAMETERS);
  });

  it('migrates v1 with a bare subdomain', () => {
    expect(
      normalizePluginParameters({
        shopifyDomain: 'acme',
        storefrontAccessToken: 'acme-token',
      }),
    ).toEqual({ ...EMPTY_PARAMETERS, stores: [ACME] });
  });

  it('migrates v1 with a full domain', () => {
    expect(
      normalizePluginParameters({
        shopifyDomain: 'https://Acme.myshopify.com/',
        storefrontAccessToken: ' acme-token ',
      }),
    ).toEqual({ ...EMPTY_PARAMETERS, stores: [ACME] });
  });

  it('migrates v1 with a numeric bare subdomain', () => {
    const raw = { shopifyDomain: '12345', storefrontAccessToken: 'tok' };
    const migrated = normalizePluginParameters(raw);
    expect(migrated).toEqual({
      ...EMPTY_PARAMETERS,
      stores: [
        {
          shopDomain: '12345.myshopify.com',
          storefrontAccessToken: 'tok',
          tokenless: false,
        },
      ],
    });
    expect(isCurrentPluginParameters(migrated)).toBe(true);
  });

  it('keeps a v1 domain whose token is missing', () => {
    expect(normalizePluginParameters({ shopifyDomain: 'acme' })).toEqual({
      ...EMPTY_PARAMETERS,
      stores: [{ ...ACME, storefrontAccessToken: '' }],
    });
  });

  it('drops a legacy domain that can never have worked', () => {
    expect(
      normalizePluginParameters({
        shopifyDomain: 'www.acme.com',
        storefrontAccessToken: 'tok',
      }).stores,
    ).toEqual([]);
  });

  it('migrates v2 with the demo store and auto-apply', () => {
    expect(
      normalizePluginParameters({
        paramsVersion: '2',
        shopifyDomain: 'acme',
        storefrontAccessToken: 'acme-token',
        autoApplyToFieldsWithApiKey: '^shopify_',
        useDemoStore: true,
      }),
    ).toEqual({
      paramsVersion: '3',
      stores: [ACME],
      useDemoStore: true,
      autoApplyToFieldsWithApiKey: '^shopify_',
    });
  });

  it('migrates v2 with an empty domain to no stores', () => {
    expect(
      normalizePluginParameters({
        paramsVersion: '2',
        shopifyDomain: '',
        storefrontAccessToken: '',
        autoApplyToFieldsWithApiKey: '',
        useDemoStore: false,
      }),
    ).toEqual(EMPTY_PARAMETERS);
    expect(
      normalizePluginParameters({
        paramsVersion: '2',
        shopifyDomain: '',
        storefrontAccessToken: '',
        autoApplyToFieldsWithApiKey: '',
        useDemoStore: true,
      }),
    ).toEqual({ ...EMPTY_PARAMETERS, useDemoStore: true });
  });

  it('only accepts boolean true and strings for the flags', () => {
    expect(
      normalizePluginParameters({
        paramsVersion: '2',
        shopifyDomain: 'acme',
        storefrontAccessToken: 'acme-token',
        autoApplyToFieldsWithApiKey: 42,
        useDemoStore: 'true',
      }),
    ).toEqual({ ...EMPTY_PARAMETERS, stores: [ACME] });
  });

  it('round-trips v3 parameters unchanged', () => {
    const v3: PluginParametersV3 = {
      paramsVersion: '3',
      stores: [
        {
          ...ACME,
          label: 'Main',
          defaultCountry: 'US',
          defaultLanguage: 'EN',
          capabilities: {
            tags: true,
            inventory: false,
            metafields: false,
            checkedAt: '2026-10-03T10:00:00.000Z',
          },
        },
        BETA,
      ],
      useDemoStore: false,
      autoApplyToFieldsWithApiKey: 'product',
    };
    const normalized = normalizePluginParameters(v3);
    expect(normalized).toEqual(v3);
    expect(normalizePluginParameters(normalized)).toEqual(normalized);
  });

  it('cleans v3 stores and dedupes them by domain (first wins)', () => {
    expect(
      normalizePluginParameters({
        paramsVersion: '3',
        stores: [
          { shopDomain: 'ACME', storefrontAccessToken: 'acme-token' },
          null,
          'beta',
          { shopDomain: 'www.custom.com', storefrontAccessToken: 'x' },
          { shopDomain: 'acme.myshopify.com', storefrontAccessToken: 'other' },
          { shopDomain: 'beta', tokenless: true, label: 'Beta EU' },
        ],
        useDemoStore: false,
        autoApplyToFieldsWithApiKey: '',
      }).stores,
    ).toEqual([ACME, BETA]);
  });

  it('treats a non-array store list as no stores', () => {
    expect(
      normalizePluginParameters({ paramsVersion: '3', stores: 'acme' }),
    ).toEqual(EMPTY_PARAMETERS);
  });

  it('emits keys in a stable order', () => {
    expect(
      Object.keys(
        normalizePluginParameters({
          useDemoStore: true,
          autoApplyToFieldsWithApiKey: 'x',
          shopifyDomain: 'acme',
        }),
      ),
    ).toEqual([
      'paramsVersion',
      'stores',
      'useDemoStore',
      'autoApplyToFieldsWithApiKey',
    ]);
  });
});

describe('isCurrentPluginParameters', () => {
  it('is true for normalized v3 parameters', () => {
    expect(isCurrentPluginParameters(params())).toBe(true);
    expect(isCurrentPluginParameters(EMPTY_PARAMETERS)).toBe(true);
    expect(
      isCurrentPluginParameters(
        normalizePluginParameters({ shopifyDomain: 'acme' }),
      ),
    ).toBe(true);
  });

  it('ignores key order', () => {
    expect(
      isCurrentPluginParameters({
        autoApplyToFieldsWithApiKey: '',
        useDemoStore: false,
        stores: [
          {
            tokenless: false,
            storefrontAccessToken: 'acme-token',
            shopDomain: 'acme.myshopify.com',
          },
        ],
        paramsVersion: '3',
      }),
    ).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['an empty object', {}],
    ['v1', { shopifyDomain: 'acme', storefrontAccessToken: 'tok' }],
    [
      'v2',
      {
        paramsVersion: '2',
        shopifyDomain: 'acme',
        storefrontAccessToken: 'tok',
        autoApplyToFieldsWithApiKey: '',
        useDemoStore: false,
      },
    ],
    ['v3 with an extra key', { ...EMPTY_PARAMETERS, shopifyDomain: 'acme' }],
    [
      'v3 missing a key',
      { paramsVersion: '3', stores: [], useDemoStore: false },
    ],
    [
      'v3 with an unnormalized domain',
      { ...EMPTY_PARAMETERS, stores: [{ ...ACME, shopDomain: 'acme' }] },
    ],
    [
      'v3 with an untrimmed token',
      {
        ...EMPTY_PARAMETERS,
        stores: [{ ...ACME, storefrontAccessToken: ' acme-token' }],
      },
    ],
    [
      'v3 with a duplicate store',
      { ...EMPTY_PARAMETERS, stores: [ACME, ACME] },
    ],
    [
      'v3 with an invalid store',
      { ...EMPTY_PARAMETERS, stores: [{ shopDomain: 'acme.com' }] },
    ],
  ])('is false for %s', (_label, raw) => {
    expect(isCurrentPluginParameters(raw)).toBe(false);
  });
});

describe('active stores', () => {
  it('uses only the demo store in demo mode', () => {
    expect(getActiveStores(params({ useDemoStore: true }))).toEqual([
      DEMO_STORE,
    ]);
    expect(getActiveStores(params())).toEqual([ACME, BETA]);
    expect(getActiveStores(EMPTY_PARAMETERS)).toEqual([]);
  });

  it('resolves the default store when the field names none', () => {
    expect(resolveFieldStore(params())).toEqual(ACME);
    expect(resolveFieldStore(params(), '')).toEqual(ACME);
    expect(resolveFieldStore(EMPTY_PARAMETERS)).toBeNull();
  });

  it('resolves the store the field names', () => {
    expect(resolveFieldStore(params(), 'beta.myshopify.com')).toEqual(BETA);
    expect(resolveFieldStore(params(), 'acme.myshopify.com')).toEqual(ACME);
    expect(resolveFieldStore(params(), 'BETA')).toEqual(BETA);
  });

  it('returns null when the named store is no longer configured', () => {
    expect(resolveFieldStore(params(), 'gone.myshopify.com')).toBeNull();
    expect(resolveFieldStore(params(), 'www.custom.com')).toBeNull();
    expect(
      resolveFieldStore(EMPTY_PARAMETERS, 'acme.myshopify.com'),
    ).toBeNull();
  });

  it('always resolves the demo store in demo mode', () => {
    const demo = params({ useDemoStore: true });
    expect(resolveFieldStore(demo)).toBe(DEMO_STORE);
    expect(resolveFieldStore(demo, 'acme.myshopify.com')).toBe(DEMO_STORE);
    expect(resolveFieldStore(demo, 'gone.myshopify.com')).toBe(DEMO_STORE);
    expect(resolveFieldStore({ ...EMPTY_PARAMETERS, useDemoStore: true })).toBe(
      DEMO_STORE,
    );
  });

  it('knows which stores can be queried', () => {
    expect(isStoreUsable(ACME)).toBe(true);
    expect(isStoreUsable(BETA)).toBe(true);
    expect(isStoreUsable(DEMO_STORE)).toBe(true);
    expect(isStoreUsable({ ...ACME, storefrontAccessToken: '' })).toBe(false);
    expect(
      isStoreUsable({ ...ACME, storefrontAccessToken: 'shpat_secret' }),
    ).toBe(false);
    expect(isStoreUsable({ ...ACME, shopDomain: 'www.acme.com' })).toBe(false);
  });

  it('knows when the plugin is configured', () => {
    expect(isPluginConfigured(EMPTY_PARAMETERS)).toBe(false);
    expect(
      isPluginConfigured({ ...EMPTY_PARAMETERS, useDemoStore: true }),
    ).toBe(true);
    expect(isPluginConfigured(params())).toBe(true);
    expect(
      isPluginConfigured(
        params({ stores: [{ ...ACME, storefrontAccessToken: '' }] }),
      ),
    ).toBe(false);
  });

  it('labels stores by label, else by domain', () => {
    expect(storeLabel(BETA)).toBe('Beta EU');
    expect(storeLabel(ACME)).toBe('acme.myshopify.com');
    expect(storeLabel({ ...ACME, label: '  ' })).toBe('acme.myshopify.com');
    expect(storeLabel(DEMO_STORE)).toBe('DatoCMS demo store');
  });
});

const FIELD_TYPES: FieldType[] = ['string', 'json'];
const FORMATS: StorageFormat[] = [
  'handle',
  'gid',
  'reference',
  'legacyProductJson',
];
const KINDS: ShopifyKind[] = ['product', 'variant', 'collection'];
const CARDINALITIES: Cardinality[] = ['single', 'multiple'];

type MatrixCase = {
  fieldType: FieldType;
  format: StorageFormat;
  kind: ShopifyKind;
  cardinality: Cardinality;
  snapshot: boolean;
};

function buildMatrix(): MatrixCase[] {
  const cases: MatrixCase[] = [];
  for (const fieldType of FIELD_TYPES) {
    for (const format of FORMATS) {
      for (const kind of KINDS) {
        for (const cardinality of CARDINALITIES) {
          for (const snapshot of [false, true]) {
            cases.push({ fieldType, format, kind, cardinality, snapshot });
          }
        }
      }
    }
  }
  return cases;
}

const MATRIX = buildMatrix();

describe('field parameter combinations', () => {
  it('lists the allowed formats, kinds and cardinalities', () => {
    expect(allowedFormats('string')).toEqual(['handle', 'gid']);
    expect(allowedFormats('json')).toEqual(['reference', 'legacyProductJson']);
    expect(allowedKinds('handle')).toEqual(['product', 'collection']);
    expect(allowedKinds('gid')).toEqual(['product', 'variant', 'collection']);
    expect(allowedKinds('legacyProductJson')).toEqual(['product']);
    expect(allowedKinds('reference')).toEqual([
      'product',
      'variant',
      'collection',
    ]);
    expect(allowedCardinalities('reference')).toEqual(['single', 'multiple']);
    expect(allowedCardinalities('handle')).toEqual(['single']);
    expect(allowedCardinalities('gid')).toEqual(['single']);
    expect(allowedCardinalities('legacyProductJson')).toEqual(['single']);
  });

  it('returns copies callers can change safely', () => {
    allowedFormats('string').push('reference');
    allowedKinds('handle').push('variant');
    expect(allowedFormats('string')).toEqual(['handle', 'gid']);
    expect(allowedKinds('handle')).toEqual(['product', 'collection']);
  });

  it('accepts exactly the combinations of the brief', () => {
    const valid = MATRIX.filter((combination) =>
      isValidCombination(combination.fieldType, combination),
    ).map(
      ({ fieldType, format, kind, cardinality, snapshot }) =>
        `${fieldType}/${format}/${kind}/${cardinality}${snapshot ? '/snapshot' : ''}`,
    );
    expect(valid.sort()).toEqual(
      [
        'string/handle/product/single',
        'string/handle/collection/single',
        'string/gid/product/single',
        'string/gid/variant/single',
        'string/gid/collection/single',
        'json/legacyProductJson/product/single',
        'json/reference/product/single',
        'json/reference/product/single/snapshot',
        'json/reference/product/multiple',
        'json/reference/product/multiple/snapshot',
        'json/reference/variant/single',
        'json/reference/variant/single/snapshot',
        'json/reference/variant/multiple',
        'json/reference/variant/multiple/snapshot',
        'json/reference/collection/single',
        'json/reference/collection/single/snapshot',
        'json/reference/collection/multiple',
        'json/reference/collection/multiple/snapshot',
      ].sort(),
    );
  });
});

describe('field parameter defaults', () => {
  it('has the 1.x legacy defaults', () => {
    expect(LEGACY_FIELD_PARAMETERS).toEqual({
      string: {
        paramsVersion: '1',
        kind: 'product',
        cardinality: 'single',
        format: 'handle',
        snapshot: false,
      },
      json: {
        paramsVersion: '1',
        kind: 'product',
        cardinality: 'single',
        format: 'legacyProductJson',
        snapshot: false,
      },
    });
  });

  it('defaults new JSON fields to reference documents', () => {
    expect(defaultFieldParameters('json')).toEqual({
      paramsVersion: '1',
      kind: 'product',
      cardinality: 'single',
      format: 'reference',
      snapshot: false,
    });
    expect(defaultFieldParameters('string')).toEqual(
      LEGACY_FIELD_PARAMETERS.string,
    );
    for (const fieldType of FIELD_TYPES) {
      expect(
        isValidCombination(fieldType, defaultFieldParameters(fieldType)),
      ).toBe(true);
    }
  });

  it('recognizes empty parameters', () => {
    expect(isEmptyFieldParameters(undefined)).toBe(true);
    expect(isEmptyFieldParameters(null)).toBe(true);
    expect(isEmptyFieldParameters({})).toBe(true);
    expect(isEmptyFieldParameters({ paramsVersion: '1' })).toBe(false);
    expect(isEmptyFieldParameters({ kind: 'product' })).toBe(false);
    expect(isEmptyFieldParameters('')).toBe(false);
  });
});

describe('normalizeFieldParameters', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty object', {}],
    ['a string', 'reference'],
    ['an array', []],
    ['a missing version', { kind: 'variant', format: 'reference' }],
    ['an unknown version', { paramsVersion: '2', format: 'reference' }],
    ['a numeric version', { paramsVersion: 1, format: 'reference' }],
  ])('uses the legacy defaults for %s', (_label, raw) => {
    expect(normalizeFieldParameters(raw, 'string')).toEqual(
      LEGACY_FIELD_PARAMETERS.string,
    );
    expect(normalizeFieldParameters(raw, 'json')).toEqual(
      LEGACY_FIELD_PARAMETERS.json,
    );
  });

  it('returns a fresh object, never the shared default', () => {
    const normalized = normalizeFieldParameters({}, 'json');
    expect(normalized).not.toBe(LEGACY_FIELD_PARAMETERS.json);
    normalized.kind = 'variant';
    expect(LEGACY_FIELD_PARAMETERS.json.kind).toBe('product');
  });

  it.each(
    MATRIX.map((combination) => ({
      ...combination,
      label: `${combination.fieldType}/${combination.format}/${combination.kind}/${combination.cardinality}/snapshot:${combination.snapshot}`,
    })),
  )('always yields a valid combination for $label', (combination) => {
    const { fieldType, label: _label, ...input } = combination;
    const normalized = normalizeFieldParameters(
      { paramsVersion: '1', ...input, min: 1, max: 3 },
      fieldType,
    );

    expect(isValidCombination(fieldType, normalized)).toBe(true);
    expect(validateFieldParameters(normalized)).toEqual({});

    if (isValidCombination(fieldType, input)) {
      expect(normalized).toMatchObject(input);
    }
    if (normalized.cardinality === 'multiple') {
      expect(normalized).toMatchObject({ min: 1, max: 3 });
    } else {
      expect(normalized).not.toHaveProperty('min');
      expect(normalized).not.toHaveProperty('max');
    }
  });

  it('falls back to the legacy format of the field type', () => {
    expect(
      normalizeFieldParameters(
        { paramsVersion: '1', kind: 'collection', format: 'reference' },
        'string',
      ),
    ).toEqual({
      paramsVersion: '1',
      kind: 'collection',
      cardinality: 'single',
      format: 'handle',
      snapshot: false,
    });
    expect(
      normalizeFieldParameters(
        { paramsVersion: '1', kind: 'variant', format: 'gid' },
        'json',
      ),
    ).toEqual(LEGACY_FIELD_PARAMETERS.json);
    expect(
      normalizeFieldParameters({ paramsVersion: '1', format: 'bogus' }, 'json'),
    ).toEqual(LEGACY_FIELD_PARAMETERS.json);
  });

  it('falls back to products when the format cannot store the kind', () => {
    expect(
      normalizeFieldParameters(
        { paramsVersion: '1', kind: 'variant', format: 'handle' },
        'string',
      ).kind,
    ).toBe('product');
    expect(
      normalizeFieldParameters(
        { paramsVersion: '1', kind: 'bogus', format: 'gid' },
        'string',
      ).kind,
    ).toBe('product');
  });

  it('keeps a full reference configuration in a stable key order', () => {
    const normalized = normalizeFieldParameters(
      {
        max: 5,
        min: 2,
        scope: {
          tags: [' sale ', 'sale', '', 'new', 3],
          vendor: ' Acme ',
          productType: 'Snowboard',
          availableOnly: true,
          collectionTitle: ' Hydrogen ',
          collectionId: ' gid://shopify/Collection/42 ',
        },
        shopDomain: 'https://Beta.myshopify.com',
        snapshot: true,
        format: 'reference',
        cardinality: 'multiple',
        kind: 'variant',
        paramsVersion: '1',
        unknown: 'dropped',
      },
      'json',
    );
    expect(normalized).toEqual({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
      format: 'reference',
      snapshot: true,
      shopDomain: 'beta.myshopify.com',
      scope: {
        collectionId: 'gid://shopify/Collection/42',
        collectionTitle: 'Hydrogen',
        productType: 'Snowboard',
        vendor: 'Acme',
        tags: ['sale', 'new'],
        availableOnly: true,
      },
      min: 2,
      max: 5,
    });
    expect(Object.keys(normalized)).toEqual([
      'paramsVersion',
      'kind',
      'cardinality',
      'format',
      'snapshot',
      'shopDomain',
      'scope',
      'min',
      'max',
    ]);
    expect(Object.keys(normalized.scope ?? {})).toEqual([
      'collectionId',
      'collectionTitle',
      'productType',
      'vendor',
      'tags',
      'availableOnly',
    ]);
  });

  it('omits optional keys instead of setting them to undefined', () => {
    const normalized = normalizeFieldParameters(
      {
        paramsVersion: '1',
        kind: 'product',
        cardinality: 'single',
        format: 'reference',
        snapshot: false,
        shopDomain: 'www.custom.com',
        scope: { availableOnly: false, tags: [], vendor: '  ' },
        min: 1,
        max: 2,
      },
      'json',
    );
    expect(Object.keys(normalized)).toEqual([
      'paramsVersion',
      'kind',
      'cardinality',
      'format',
      'snapshot',
    ]);
  });

  it('cleans the scope', () => {
    const scope = (value: unknown) =>
      normalizeFieldParameters(
        { paramsVersion: '1', format: 'reference', scope: value },
        'json',
      ).scope;

    expect(scope('sale')).toBeUndefined();
    expect(scope({})).toBeUndefined();
    expect(scope({ collectionId: 'gid://shopify/Product/42' })).toBeUndefined();
    expect(scope({ collectionId: '42' })).toBeUndefined();
    expect(
      scope({ collectionId: 'gid://shopify/Product/42', collectionTitle: 'X' }),
    ).toBeUndefined();
    expect(scope({ collectionTitle: 'Orphan title', vendor: 'Acme' })).toEqual({
      vendor: 'Acme',
    });
    expect(scope({ tags: 'sale' })).toBeUndefined();
    expect(scope({ availableOnly: 'yes' })).toBeUndefined();
    expect(scope({ productType: 42 })).toBeUndefined();
    expect(scope({ collectionId: 'gid://shopify/Collection/7' })).toEqual({
      collectionId: 'gid://shopify/Collection/7',
    });
  });

  it('keeps scopes on string fields too', () => {
    expect(
      normalizeFieldParameters(
        {
          paramsVersion: '1',
          format: 'handle',
          scope: { productType: 'Snowboard' },
        },
        'string',
      ).scope,
    ).toEqual({ productType: 'Snowboard' });
  });

  it('sanitizes min and max for multiple fields', () => {
    const limits = (min: unknown, max: unknown) => {
      const normalized = normalizeFieldParameters(
        {
          paramsVersion: '1',
          format: 'reference',
          cardinality: 'multiple',
          min,
          max,
        },
        'json',
      );
      return { min: normalized.min, max: normalized.max };
    };

    expect(limits(0, 1)).toEqual({ min: 0, max: 1 });
    expect(limits(2, 2)).toEqual({ min: 2, max: 2 });
    expect(limits(3, undefined)).toEqual({ min: 3, max: undefined });
    expect(limits(undefined, 4)).toEqual({ min: undefined, max: 4 });
    expect(limits(5, 2)).toEqual({ min: undefined, max: 2 });
    expect(limits(-1, 0)).toEqual({ min: undefined, max: undefined });
    expect(limits(1.5, 2.5)).toEqual({ min: undefined, max: undefined });
    expect(limits('1', '2')).toEqual({ min: undefined, max: undefined });
    expect(limits(null, null)).toEqual({ min: undefined, max: undefined });
    expect(limits(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      min: undefined,
      max: undefined,
    });
  });

  it('normalizes or drops the store domain', () => {
    const shopDomain = (value: unknown) =>
      normalizeFieldParameters(
        { paramsVersion: '1', format: 'gid', shopDomain: value },
        'string',
      ).shopDomain;

    expect(shopDomain('acme')).toBe('acme.myshopify.com');
    expect(shopDomain('ACME.myshopify.com')).toBe('acme.myshopify.com');
    expect(shopDomain('')).toBeUndefined();
    expect(shopDomain('www.acme.com')).toBeUndefined();
    expect(shopDomain(42)).toBeUndefined();
  });

  it('is idempotent', () => {
    for (const combination of MATRIX) {
      const { fieldType, ...input } = combination;
      const once = normalizeFieldParameters(
        {
          paramsVersion: '1',
          ...input,
          min: 4,
          max: 2,
          shopDomain: 'acme',
          scope: { tags: ['a', 'a'] },
        },
        fieldType,
      );
      expect(normalizeFieldParameters(once, fieldType)).toEqual(once);
    }
  });
});

describe('validateFieldParameters', () => {
  it('accepts empty parameters so legacy fields stay saveable', () => {
    expect(validateFieldParameters(undefined)).toEqual({});
    expect(validateFieldParameters(null)).toEqual({});
    expect(validateFieldParameters({})).toEqual({});
  });

  it('accepts every valid combination', () => {
    for (const fieldType of FIELD_TYPES) {
      for (const format of allowedFormats(fieldType)) {
        for (const kind of allowedKinds(format)) {
          for (const cardinality of allowedCardinalities(format)) {
            expect(
              validateFieldParameters({
                paramsVersion: '1',
                kind,
                cardinality,
                format,
                snapshot: format === 'reference',
              }),
            ).toEqual({});
          }
        }
      }
    }
  });

  it('accepts a complete multiple reference configuration', () => {
    expect(
      validateFieldParameters({
        paramsVersion: '1',
        kind: 'variant',
        cardinality: 'multiple',
        format: 'reference',
        snapshot: true,
        shopDomain: 'acme.myshopify.com',
        scope: {
          collectionId: 'gid://shopify/Collection/42',
          collectionTitle: 'Hydrogen',
          productType: 'Snowboard',
          vendor: 'Acme',
          tags: ['sale'],
          availableOnly: true,
        },
        min: 0,
        max: 10,
      }),
    ).toEqual({});
  });

  it('rejects unknown parameter versions', () => {
    for (const raw of [
      'reference',
      [],
      { kind: 'product' },
      { paramsVersion: '2', kind: 'product' },
    ]) {
      expect(Object.keys(validateFieldParameters(raw))).toEqual([
        'paramsVersion',
      ]);
    }
  });

  it('rejects unknown kinds, cardinalities and formats', () => {
    expect(
      validateFieldParameters({
        paramsVersion: '1',
        kind: 'order',
        cardinality: 'many',
        format: 'sku',
      }),
    ).toEqual({
      kind: 'Choose products, variants or collections',
      cardinality: 'Choose one or multiple items',
      format: 'Choose how the value is stored',
    });
  });

  it('rejects kinds the format cannot store', () => {
    expect(
      validateFieldParameters({
        paramsVersion: '1',
        kind: 'variant',
        cardinality: 'single',
        format: 'handle',
        snapshot: false,
      }),
    ).toEqual({
      kind: 'Variants can only be stored as a Shopify ID or a reference document',
    });
    expect(
      validateFieldParameters({
        paramsVersion: '1',
        kind: 'collection',
        cardinality: 'single',
        format: 'legacyProductJson',
        snapshot: false,
      }),
    ).toEqual({ kind: 'Legacy product JSON can only store products' });
  });

  it('allows multiple and the snapshot only with reference documents', () => {
    expect(
      validateFieldParameters({
        paramsVersion: '1',
        kind: 'product',
        cardinality: 'multiple',
        format: 'gid',
        snapshot: true,
      }),
    ).toEqual({
      cardinality: 'Multiple items can only be stored in a reference document',
      snapshot:
        'The display snapshot is only available for reference documents',
    });
    expect(
      validateFieldParameters({
        paramsVersion: '1',
        kind: 'product',
        cardinality: 'single',
        format: 'reference',
        snapshot: 'yes',
      }),
    ).toEqual({ snapshot: 'Turn the display snapshot on or off' });
  });

  const multiple = {
    paramsVersion: '1',
    kind: 'product',
    cardinality: 'multiple',
    format: 'reference',
    snapshot: false,
  };

  it('validates min and max', () => {
    expect(validateFieldParameters({ ...multiple, min: 1.5 })).toEqual({
      min: 'Minimum must be a whole number',
    });
    expect(validateFieldParameters({ ...multiple, max: '3' })).toEqual({
      max: 'Maximum must be a whole number',
    });
    expect(validateFieldParameters({ ...multiple, min: -1 })).toEqual({
      min: 'Minimum must be a whole number',
    });
    expect(validateFieldParameters({ ...multiple, max: 0 })).toEqual({
      max: 'Maximum must be at least 1',
    });
    expect(validateFieldParameters({ ...multiple, min: 4, max: 2 })).toEqual({
      min: "Minimum can't be greater than maximum",
    });
    expect(validateFieldParameters({ ...multiple, min: 2, max: 2 })).toEqual(
      {},
    );
    expect(
      validateFieldParameters({ ...multiple, min: null, max: null }),
    ).toEqual({});
  });

  it('rejects limits on single fields', () => {
    expect(
      validateFieldParameters({
        ...multiple,
        cardinality: 'single',
        min: 1,
        max: 2,
      }),
    ).toEqual({
      min: 'Limits only apply when editors can pick multiple items',
      max: 'Limits only apply when editors can pick multiple items',
    });
  });

  it('validates the scope', () => {
    const scopeError = (scope: unknown) =>
      validateFieldParameters({ ...multiple, scope }).scope;

    expect(scopeError(undefined)).toBeUndefined();
    expect(scopeError({})).toBeUndefined();
    expect(scopeError({ collectionId: '' })).toBeUndefined();
    expect(scopeError('sale')).toBe('Limit choices must be an object');
    expect(scopeError({ collectionId: 'gid://shopify/Product/1' })).toBe(
      'The collection must be a Shopify collection ID (gid://shopify/Collection/…)',
    );
    expect(scopeError({ collectionId: 42 })).toBe(
      'The collection must be a Shopify collection ID (gid://shopify/Collection/…)',
    );
    expect(scopeError({ tags: 'sale' })).toBe(
      'Tags must be a list of text values',
    );
    expect(scopeError({ tags: ['sale', 3] })).toBe(
      'Tags must be a list of text values',
    );
    expect(scopeError({ vendor: 3 })).toBe(
      'Product type and vendor must be text',
    );
  });

  it('validates the store domain', () => {
    const shopDomainError = (shopDomain: unknown) =>
      validateFieldParameters({ ...multiple, shopDomain }).shopDomain;

    expect(shopDomainError(undefined)).toBeUndefined();
    expect(shopDomainError('')).toBeUndefined();
    expect(shopDomainError('acme')).toBeUndefined();
    expect(shopDomainError('www.acme.com')).toBe(CUSTOM_DOMAIN_ERROR);
    expect(shopDomainError(42)).toBe(INVALID_SHOP_DOMAIN_ERROR);
  });

  it('writes messages in DatoCMS copy style', () => {
    const errors = validateFieldParameters({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
      format: 'handle',
      snapshot: true,
      min: 3,
      max: 0,
      scope: { tags: [1] },
      shopDomain: 'acme store',
    });
    expect(Object.keys(errors).sort()).toEqual(
      ['cardinality', 'kind', 'max', 'scope', 'shopDomain', 'snapshot'].sort(),
    );
    for (const message of Object.values(errors)) {
      expect(message).not.toMatch(/\.$/);
      expect(message[0]).toBe(message[0].toUpperCase());
    }
  });
});
