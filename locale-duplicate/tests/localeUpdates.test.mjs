import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLocaleUpdates,
  cloneCmaFieldValue,
} from '../src/services/localeUpdates.ts';

const field = (api_key, field_type, localized = false) => ({
  api_key,
  field_type,
  localized,
});
const schemas = new Map([
  [
    'outer',
    [
      field('content', 'structured_text'),
      field('metadata', 'json'),
      field('asset', 'file'),
      field('title', 'string', true),
    ],
  ],
  ['inner', [field('label', 'string'), field('ref', 'link')]],
]);
const loadFields = async (id) => schemas.get(id);
const block = (id, model, attributes) => ({
  id,
  type: 'item',
  attributes,
  relationships: { item_type: { data: { type: 'item_type', id: model } } },
  meta: { current_version: 'read-only' },
});
const document = (nodes) => ({
  schema: 'dast',
  document: { type: 'root', children: nodes },
});

function fixture() {
  const inner = block('source-inner', 'inner', {
    label: 'Button',
    ref: 'linked-record',
  });
  const outer = block('source-outer', 'outer', {
    content: document([
      { type: 'block', item: inner },
      {
        type: 'paragraph',
        children: [
          {
            type: 'inlineBlock',
            item: block('inline-inner', 'inner', {
              label: 'Inline',
              ref: 'another-record',
            }),
          },
          { type: 'inlineItem', item: 'external-record' },
          {
            type: 'itemLink',
            item: 'linked-record',
            children: [{ type: 'span', value: 'link', marks: ['custom-mark'] }],
          },
        ],
      },
    ]),
    metadata: {
      id: 'json-data',
      type: 'item',
      attributes: { id: 'nested-json-id' },
      relationships: {},
    },
    asset: {
      upload_id: 'asset-id',
      alt: 'caption',
      focal_point: { x: 0, y: 1 },
      custom_data: { id: 'asset-meta' },
    },
    title: { en: 'Title', fr: null },
  });
  return {
    id: 'record',
    content: {
      en: [outer],
      pt: [],
      fr: [block('untouched', 'inner', { label: 'French', ref: 'ref-fr' })],
    },
    metadata: {
      en: { id: 'metadata', en: 'ordinary JSON' },
      pt: { id: 'old' },
    },
    plain_json: { en: 'not localized' },
  };
}

test('CMA schema-aware cloning replaces only copied block IDs across modular/DAST/inline blocks', async () => {
  const source = fixture();
  const before = structuredClone(source);
  const fields = [
    field('content', 'rich_text', true),
    field('metadata', 'json', true),
    field('plain_json', 'json'),
  ];
  const updates = await buildLocaleUpdates(
    source,
    source,
    fields,
    'en',
    'pt',
    loadFields,
  );
  assert.deepEqual(source, before);
  assert.strictEqual(updates.content.en, source.content.en);
  assert.strictEqual(updates.content.fr, source.content.fr);
  const target = updates.content.pt[0];
  assert.match(target.id, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(target.id, source.content.en[0].id);
  assert.equal(target.meta, undefined);
  const nodes = target.attributes.content.document.children;
  assert.notEqual(nodes[0].item.id, 'source-inner');
  assert.notEqual(nodes[1].children[0].item.id, 'inline-inner');
  assert.equal(nodes[1].children[1].item, 'external-record');
  assert.equal(nodes[1].children[2].item, 'linked-record');
  assert.deepEqual(nodes[1].children[2].children[0].marks, ['custom-mark']);
  assert.deepEqual(
    target.attributes.metadata,
    source.content.en[0].attributes.metadata,
  );
  assert.deepEqual(
    target.attributes.asset,
    source.content.en[0].attributes.asset,
  );
  assert.deepEqual(target.attributes.title, { en: 'Title', fr: null });
  assert.equal(updates.plain_json, undefined);
});

test('adding a locale updates all localized fields, including missing source and falsy values', async () => {
  const item = {
    title: { en: '' },
    enabled: { en: false },
    number: { en: 0 },
    optional: { en: null },
    missing: { fr: 'French' },
  };
  const fields = ['title', 'enabled', 'number', 'optional', 'missing'].map(
    (key) => field(key, 'json', true),
  );
  const updates = await buildLocaleUpdates(
    item,
    item,
    fields,
    'en',
    'pt',
    loadFields,
  );
  assert.equal(updates.title.pt, '');
  assert.equal(updates.enabled.pt, false);
  assert.equal(updates.number.pt, 0);
  assert.equal(updates.optional.pt, null);
  assert.equal(updates.missing.pt, null);
  assert.deepEqual(item.missing, { fr: 'French' });
});

test('published source copies preserve other locales and current edits', async () => {
  const published = { title: { en: 'Published', pt: 'Old', fr: 'Old French' } };
  const current = {
    title: { en: 'Draft', pt: 'Target draft', fr: 'Fresh French' },
  };
  const updates = await buildLocaleUpdates(
    published,
    current,
    [field('title', 'string', true)],
    'en',
    'pt',
    loadFields,
  );
  assert.deepEqual(updates.title, {
    en: 'Draft',
    pt: 'Published',
    fr: 'Fresh French',
  });
});

test('repeat copies with independently assigned target block IDs are no-ops', async () => {
  const item = fixture();
  const fields = [field('content', 'rich_text', true)];
  const first = await buildLocaleUpdates(
    item,
    item,
    fields,
    'en',
    'pt',
    loadFields,
  );
  const saved = { ...item, ...first };
  assert.deepEqual(
    await buildLocaleUpdates(saved, saved, fields, 'en', 'pt', loadFields),
    {},
  );
});

test('unexpanded blocks and incomplete schemas fail before writing', async () => {
  await assert.rejects(
    cloneCmaFieldValue(['block-id'], 'rich_text', loadFields),
    /Expected an object/,
  );
  await assert.rejects(
    cloneCmaFieldValue(
      block('id', 'inner', { label: 'ok', extra: 'important' }),
      'single_block',
      loadFields,
    ),
    /schema changed/,
  );
});
