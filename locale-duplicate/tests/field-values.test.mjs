import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloneFieldValue,
  cloneFormFieldValue,
  copyFormValueToLocales,
  getLocalizedFieldPath,
  getValueAtPath,
  loadFormBlockSchemas,
} from '../src/utils/fieldUtils.ts';

const schemas = new Map([
  [
    'outer',
    [
      { apiKey: 'data', fieldType: 'json', localized: false },
      { apiKey: 'image', fieldType: 'file', localized: false },
      { apiKey: 'related', fieldType: 'link', localized: false },
      { apiKey: 'nested', fieldType: 'single_block', localized: false },
      {
        apiKey: 'localizedText',
        fieldType: 'structured_text',
        localized: true,
      },
    ],
  ],
  [
    'inner',
    [
      { apiKey: 'title', fieldType: 'string', localized: false },
      { apiKey: 'data', fieldType: 'json', localized: false },
    ],
  ],
]);

function structuredFixture() {
  return [
    {
      type: 'paragraph',
      children: [
        { text: 'Read ', strong: true },
        {
          type: 'inlineItem',
          item: 'linked-record',
          itemTypeId: 'record-model',
          children: [{ text: '' }],
        },
        {
          type: 'itemLink',
          item: 'linked-record-2',
          itemTypeId: 'record-model',
          children: [{ text: 'more' }],
        },
      ],
    },
    {
      type: 'block',
      id: 'source-block',
      key: 'old-editor-key',
      blockModelId: 'outer',
      children: [{ text: '' }],
      data: {
        type: 'block',
        id: 'business-id',
        blockModelId: 'json-value',
        itemId: 'json-id',
        children: [],
      },
      image: {
        upload_id: 'asset',
        alt: '',
        title: null,
        custom_data: { id: 'upload-data' },
      },
      related: 'linked-record-3',
      nested: {
        itemId: 'nested-source',
        itemTypeId: 'inner',
        id: 'content-field-id',
        title: '',
        data: { itemId: 'business-field' },
      },
      localizedText: {
        'zh-Hant-TW': [
          {
            type: 'inlineBlock',
            id: 'inline-source',
            blockModelId: 'inner',
            children: [{ text: '' }],
            title: '中文',
          },
        ],
        en: null,
      },
    },
  ];
}

test('editor duplication preserves references, marks, upload metadata and JSON IDs', () => {
  const original = structuredFixture();
  const copy = cloneFormFieldValue(original, 'structured_text', schemas);
  assert.deepEqual(copy[0], original[0]);
  assert.equal(copy[1].id, undefined);
  assert.equal(copy[1].nested.itemId, undefined);
  assert.equal(copy[1].nested.id, 'content-field-id');
  assert.equal(copy[1].localizedText['zh-Hant-TW'][0].id, undefined);
  assert.notEqual(copy[1].key, 'old-editor-key');
  assert.notEqual(copy[1].key, copy[1].localizedText['zh-Hant-TW'][0].key);
  assert.deepEqual(copy[1].data, original[1].data);
  assert.deepEqual(copy[1].image, original[1].image);
  assert.equal(copy[1].related, original[1].related);
  assert.equal(original[1].id, 'source-block');
  assert.equal(original[1].nested.itemId, 'nested-source');
  assert.equal(original[1].localizedText['zh-Hant-TW'][0].id, 'inline-source');
  copy[1].data.id = 'changed';
  assert.equal(original[1].data.id, 'business-id');
});

test('each target locale receives independent blocks and editor keys', () => {
  const original = structuredFixture();
  const first = cloneFormFieldValue(original, 'structured_text', schemas);
  const second = cloneFormFieldValue(original, 'structured_text', schemas);
  assert.notEqual(first[1].key, second[1].key);
  assert.notEqual(first[1].nested, second[1].nested);
  first[1].nested.title = 'first locale';
  assert.equal(second[1].nested.title, '');
  assert.equal(original[1].nested.title, '');
});

test('model schemas load once and only along block-bearing fields', async () => {
  const original = structuredFixture();
  const loaded = [];
  const actual = await loadFormBlockSchemas(
    [...original, cloneFieldValue(original[1])],
    'structured_text',
    async (modelId) => {
      loaded.push(modelId);
      assert.ok(
        schemas.has(modelId),
        'JSON content must not be treated as a block model',
      );
      return schemas.get(modelId);
    },
  );
  assert.deepEqual(loaded, ['outer', 'inner']);
  assert.equal(actual.size, 2);
  assert.equal(
    cloneFormFieldValue(original, 'structured_text', actual)[1].id,
    undefined,
  );
});

test('JSON and SEO values are cloned without interpreting content as editor nodes', () => {
  const original = {
    type: 'inlineItem',
    id: 'business',
    item: 'reference',
    itemTypeId: 'type',
    children: [{ type: 'block', id: 'json-id', blockModelId: 'opaque' }],
  };
  for (const fieldType of ['json', 'seo']) {
    const copy = cloneFormFieldValue(original, fieldType);
    assert.deepEqual(copy, original);
    assert.notEqual(copy.children, original.children);
  }
});

test('single-block and modular-content shapes stay intact and only itemId is regenerated', () => {
  const original = {
    itemId: 'block',
    itemTypeId: 'inner',
    id: 'user-field',
    title: '',
    data: { itemId: 'metadata' },
  };
  const single = cloneFormFieldValue(original, 'single_block', schemas);
  assert.equal(Array.isArray(single), false);
  assert.equal(single.itemId, undefined);
  assert.equal(single.id, 'user-field');
  assert.deepEqual(single.data, original.data);
  const modular = cloneFormFieldValue([original], 'rich_text', schemas);
  assert.equal(modular.length, 1);
  assert.deepEqual(modular[0], single);
  assert.equal(cloneFormFieldValue(null, 'single_block', schemas), null);
});

test('unloaded blocks, absent schemas and API DAST fail before editor writes', async () => {
  assert.throws(
    () =>
      cloneFormFieldValue(
        [{ type: 'block', item: 'unloaded' }],
        'structured_text',
      ),
    /not loaded/,
  );
  assert.throws(
    () => cloneFormFieldValue(structuredFixture(), 'structured_text'),
    /Could not load/,
  );
  assert.throws(
    () =>
      cloneFormFieldValue(
        { schema: 'dast', document: { type: 'root', children: [] } },
        'structured_text',
      ),
    /not loaded/,
  );
  assert.throws(
    () => cloneFormFieldValue(['unloaded-block-id'], 'rich_text'),
    /not loaded/,
  );
  await assert.rejects(
    loadFormBlockSchemas(structuredFixture(), 'structured_text', async () => {
      throw new Error('schema unavailable');
    }),
    /schema unavailable/,
  );
});

test('false, zero, null and empty values remain distinct when copied', async () => {
  await Promise.all(
    [false, 0, null, ''].map(async (value) => {
      const writes = [];
      const result = await copyFormValueToLocales(
        value,
        'json',
        new Map(),
        ['it', 'pt-BR'],
        async (locale, copy) => writes.push({ locale, copy }),
      );
      assert.deepEqual(writes, [
        { locale: 'it', copy: value },
        { locale: 'pt-BR', copy: value },
      ]);
      assert.deepEqual(result, { copied: 2, failures: [] });
    }),
  );
});

test('large locale fan-out uses one write at a time and reports partial failures accurately', async () => {
  const locales = Array.from({ length: 1000 }, (_, index) => `locale-${index}`);
  const original = structuredFixture();
  let active = 0;
  let maximum = 0;
  const keys = new Set();
  const result = await copyFormValueToLocales(
    original,
    'structured_text',
    schemas,
    locales,
    async (locale, value) => {
      active += 1;
      maximum = Math.max(maximum, active);
      try {
        await Promise.resolve();
        keys.add(value[1].key);
        value[1].nested.title = locale;
        if (locale === 'locale-5' || locale === 'locale-900')
          throw new Error('mock editor failure');
      } finally {
        active -= 1;
      }
    },
  );
  assert.equal(maximum, 1);
  assert.equal(keys.size, locales.length);
  assert.equal(result.copied, 998);
  assert.deepEqual(result.failures, [
    'locale-5: mock editor failure',
    'locale-900: mock editor failure',
  ]);
  assert.equal(original[1].nested.title, '');
});

test('nested locale paths preserve parent locale/index and accept complex locale codes', () => {
  const path = 'sections.en.12.content.0.title.zh-Hant-TW';
  assert.equal(
    getLocalizedFieldPath(path, 'zh-Hant-TW', 'pt-BR'),
    'sections.en.12.content.0.title.pt-BR',
  );
  assert.equal(getLocalizedFieldPath('title', 'en', 'it'), undefined);
  assert.equal(getLocalizedFieldPath('title.en', '', 'it'), undefined);
  const values = {
    sections: {
      en: [{ title: { 'zh-Hant-TW': false, 'pt-BR': 0, it: null } }],
    },
  };
  assert.equal(getValueAtPath(values, 'sections.en.0.title.zh-Hant-TW'), false);
  assert.equal(getValueAtPath(values, 'sections.en[0].title.pt-BR'), 0);
  assert.equal(getValueAtPath(values, 'sections.en.0.title.it'), null);
  assert.equal(getValueAtPath(values, 'sections.en.1.title.it'), undefined);
  assert.equal(getValueAtPath({}, 'toString'), undefined);
});

test('iterative cloning handles 20000 nested objects and 10000 asset references', () => {
  const root = {
    assets: Array.from({ length: 10000 }, (_, index) => ({
      upload_id: `asset-${index}`,
      custom_data: { id: `${index}` },
    })),
  };
  let cursor = root;
  for (let index = 0; index < 20000; index += 1) {
    cursor.child = { id: index };
    cursor = cursor.child;
  }
  const copy = cloneFieldValue(root);
  assert.deepEqual(copy.assets, root.assets);
  assert.notEqual(copy.assets[9999], root.assets[9999]);
  cursor = copy;
  for (let index = 0; index < 20000; index += 1) {
    cursor = cursor.child;
    assert.equal(cursor.id, index);
  }
});

test('nested block transformation is iterative for 4000 levels', async () => {
  const fields = [
    { apiKey: 'nested', fieldType: 'single_block', localized: false },
  ];
  const root = { itemId: 'root', itemTypeId: 'recursive' };
  let cursor = root;
  for (let index = 0; index < 4000; index += 1) {
    cursor.nested = { itemId: `block-${index}`, itemTypeId: 'recursive' };
    cursor = cursor.nested;
  }
  let loads = 0;
  const loaded = await loadFormBlockSchemas(root, 'single_block', async () => {
    loads += 1;
    return fields;
  });
  assert.equal(loads, 1);
  cursor = cloneFormFieldValue(root, 'single_block', loaded);
  for (let index = 0; index <= 4000; index += 1) {
    assert.equal(cursor.itemId, undefined);
    cursor = cursor.nested;
  }
  assert.equal(root.itemId, 'root');
});

test('wide Structured Text preserves every node and reference', () => {
  const value = [
    {
      type: 'paragraph',
      children: Array.from({ length: 100000 }, (_, index) =>
        index % 100 === 0
          ? {
              type: 'inlineItem',
              item: `record-${index}`,
              itemTypeId: 'record-model',
              children: [{ text: '' }],
            }
          : { text: `${index}`, highlight: true },
      ),
    },
  ];
  const copy = cloneFormFieldValue(value, 'structured_text');
  assert.equal(copy[0].children.length, 100000);
  assert.deepEqual(copy, value);
  assert.notEqual(copy[0].children[0], value[0].children[0]);
});

test('arbitrary JSON property names do not modify object prototypes', () => {
  const value = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":{"id":"data"}}',
  );
  const copy = cloneFieldValue(value);
  assert.deepEqual(copy, value);
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test('Structured Text copying preserves standalone inline-item references', () => {
  const value = [
    {
      type: 'inlineItem',
      item: 'record',
      itemTypeId: 'model',
      children: [{ text: '' }],
    },
  ];
  assert.deepEqual(cloneFormFieldValue(value, 'structured_text'), value);
});
