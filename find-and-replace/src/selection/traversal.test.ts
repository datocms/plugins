import type { ApiTypes } from '@datocms/cma-client-browser';
import { describe, expect, it } from 'vitest';
import { fieldValueIdentity, fingerprintValue } from './identity';
import { buildSchemaIndex } from './schemaIndex';
import { traverseRecord } from './traversal';

function itemType(
  id: string,
  name: string,
  modularBlock: boolean,
): ApiTypes.ItemType {
  return {
    id,
    name,
    api_key: name.toLowerCase(),
    modular_block: modularBlock,
  } as ApiTypes.ItemType;
}

function field(
  id: string,
  modelId: string,
  apiKey: string,
  fieldType: ApiTypes.Field['field_type'],
  options: {
    localized?: boolean;
    position?: number;
    blockModelIds?: string[];
    inlineBlockModelIds?: string[];
  } = {},
): ApiTypes.Field {
  const blockModelIds = options.blockModelIds ?? [];
  const validators =
    fieldType === 'rich_text'
      ? { rich_text_blocks: { item_types: blockModelIds } }
      : fieldType === 'single_block'
        ? { single_block_blocks: { item_types: blockModelIds } }
        : fieldType === 'structured_text'
          ? {
              structured_text_blocks: { item_types: blockModelIds },
              structured_text_inline_blocks: {
                item_types: options.inlineBlockModelIds ?? [],
              },
              structured_text_links: { item_types: [] },
            }
          : {};

  return {
    id,
    type: 'field',
    label: apiKey,
    api_key: apiKey,
    field_type: fieldType,
    localized: options.localized ?? false,
    position: options.position ?? 0,
    validators,
    item_type: { id: modelId, type: 'item_type' },
  } as ApiTypes.Field;
}

function blockRecord(
  id: string,
  modelId: string,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    type: 'item',
    attributes,
    relationships: { item_type: { data: { id: modelId, type: 'item_type' } } },
    meta: {},
  };
}

function createFixture() {
  const root = itemType('root', 'Page', false);
  const section = itemType('section', 'Section', true);
  const richBody = itemType('rich-body', 'Rich body', true);
  const contentBlock = itemType('content-block', 'Content block', true);
  const inlineBlock = itemType('inline-block', 'Inline block', true);

  const schema = buildSchemaIndex({
    itemTypes: [root, section, richBody, contentBlock, inlineBlock],
    fieldsByItemTypeId: new Map([
      [
        root.id,
        [
          field('title', root.id, 'title', 'string', { localized: true }),
          field('modules', root.id, 'modules', 'rich_text', {
            localized: true,
            blockModelIds: [section.id],
          }),
          field('related', root.id, 'related', 'link'),
        ],
      ],
      [
        section.id,
        [
          field('headline', section.id, 'headline', 'string', {
            localized: true,
          }),
          field('detail', section.id, 'detail', 'single_block', {
            localized: true,
            blockModelIds: [richBody.id],
          }),
        ],
      ],
      [
        richBody.id,
        [
          field('body', richBody.id, 'body', 'structured_text', {
            blockModelIds: [contentBlock.id],
            inlineBlockModelIds: [inlineBlock.id],
          }),
          field('back', richBody.id, 'back', 'single_block', {
            blockModelIds: [section.id],
          }),
        ],
      ],
      [contentBlock.id, [field('copy', contentBlock.id, 'copy', 'text')]],
      [
        inlineBlock.id,
        [field('inline-copy', inlineBlock.id, 'copy', 'string')],
      ],
    ]),
  });

  const embeddedContent = blockRecord('content-1', contentBlock.id, {
    copy: 'Block prose',
  });
  const embeddedInline = blockRecord('inline-1', inlineBlock.id, {
    copy: 'Inline prose',
  });
  const orphan = blockRecord('orphan-1', contentBlock.id, {
    copy: 'Must not appear',
  });
  const linkedRecord = {
    id: 'linked-1',
    type: 'item',
    relationships: { item_type: { data: { id: root.id, type: 'item_type' } } },
    attributes: { title: { en: 'Linked title' } },
  };

  const sectionClone = blockRecord('section-1', section.id, {
    headline: { en: 'Cyclic clone' },
  });
  const bodyBlock = blockRecord('body-1', richBody.id, {
    body: {
      schema: 'dast',
      document: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'span', value: 'Visible prose' }],
          },
          { type: 'block', item: embeddedContent },
          {
            type: 'paragraph',
            children: [
              { type: 'span', value: 'Before ' },
              { type: 'inlineBlock', item: embeddedInline },
              {
                type: 'itemLink',
                item: linkedRecord,
                children: [{ type: 'span', value: 'linked label' }],
              },
            ],
          },
        ],
      },
      blocks: [embeddedContent, orphan],
    },
    back: sectionClone,
  });
  const sectionBlock = blockRecord('section-1', section.id, {
    headline: { en: 'Section heading' },
    detail: { en: bodyBlock },
  });
  // A cloned object with an already-active block ID must not recurse back into
  // the same semantic block, even if object identity differs.
  (sectionClone.attributes as Record<string, unknown>).detail = {
    en: bodyBlock,
  };

  const record = {
    id: 'page-1',
    type: 'item',
    attributes: {
      title: { en: 'Page title' },
      modules: { en: [sectionBlock], it: [] },
      related: linkedRecord,
    },
    relationships: { item_type: { data: { id: root.id, type: 'item_type' } } },
    meta: { current_version: 'version-7' },
  };

  return { schema, record };
}

describe('traverseRecord', () => {
  it('walks localized nested containers and ignores links and orphan blocks', () => {
    const { schema, record } = createFixture();
    const values = traverseRecord({
      record,
      rootModelId: 'root',
      schema,
      siteId: 'site',
      environment: 'main',
      locales: ['en', 'it'],
    });

    const ownerIds = new Set(values.map((value) => value.ref.ownerRecordId));
    expect(ownerIds).toEqual(
      new Set(['page-1', 'section-1', 'body-1', 'content-1', 'inline-1']),
    );
    expect(ownerIds.has('linked-1')).toBe(false);
    expect(ownerIds.has('orphan-1')).toBe(false);

    const missingTitle = values.find(
      (value) => value.ref.fieldId === 'title' && value.ref.locale === 'it',
    );
    const missingNestedHeadline = values.find(
      (value) => value.ref.fieldId === 'headline' && value.ref.locale === 'it',
    );
    expect(missingTitle?.ref.present).toBe(false);
    expect(missingNestedHeadline?.ref.present).toBe(false);

    const modules = values.find(
      (value) => value.ref.fieldId === 'modules' && value.ref.locale === 'en',
    );
    const detail = values.find(
      (value) => value.ref.fieldId === 'detail' && value.ref.locale === 'en',
    );
    const body = values.find((value) => value.ref.fieldId === 'body');
    const copy = values.find((value) => value.ref.fieldId === 'copy');
    const inlineCopy = values.find(
      (value) => value.ref.fieldId === 'inline-copy',
    );
    expect(modules && detail && body && copy && inlineCopy).toBeTruthy();
    if (!modules || !detail || !body) throw new Error('Missing fixture values');

    expect(copy?.ref.blockAncestry.map((entry) => entry.kind)).toEqual([
      'modular_content',
      'single_block',
      'structured_text_block',
    ]);
    expect(inlineCopy?.ref.blockAncestry.map((entry) => entry.kind)).toEqual([
      'modular_content',
      'single_block',
      'structured_text_inline_block',
    ]);
    expect(copy?.ref.ancestorFieldValueIds).toEqual([
      fieldValueIdentity(modules.ref),
      fieldValueIdentity(detail.ref),
      fieldValueIdentity(body.ref),
    ]);
    expect(copy?.ref.rootRecordVersion).toBe('version-7');
    expect(copy?.ref.valuePath).toContain('attributes');
  });

  it('honors the defensive nesting ceiling', () => {
    const { schema, record } = createFixture();
    const values = traverseRecord({
      record,
      rootModelId: 'root',
      schema,
      siteId: 'site',
      environment: 'main',
      locales: ['en', 'it'],
      maxBlockDepth: 2,
    });

    expect(values.some((value) => value.ref.ownerRecordId === 'body-1')).toBe(
      true,
    );
    expect(
      values.some((value) => value.ref.ownerRecordId === 'content-1'),
    ).toBe(false);
    expect(values.some((value) => value.ref.ownerRecordId === 'inline-1')).toBe(
      false,
    );
  });

  it('fingerprints a value only when the fingerprint is read', () => {
    const page = itemType('page', 'Page', false);
    const schema = buildSchemaIndex({
      itemTypes: [page],
      fieldsByItemTypeId: new Map([
        [
          page.id,
          [
            field('title-field', 'page', 'title', 'string', { position: 1 }),
            field('data-field', 'page', 'data', 'json', { position: 2 }),
          ],
        ],
      ]),
    });
    const data = { theme: 'dark', sizes: [1, 2, 3] };
    let reads = 0;
    const watched = new Proxy(data, {
      ownKeys(target) {
        reads += 1;
        return Reflect.ownKeys(target);
      },
    });
    const values = traverseRecord({
      record: {
        id: 'page-1',
        type: 'item',
        attributes: { title: 'Acme', data: watched },
        relationships: {
          item_type: { data: { id: 'page', type: 'item_type' } },
        },
        meta: { current_version: 'v1' },
      },
      rootModelId: 'page',
      schema,
      siteId: 'site',
      environment: 'main',
    });

    const dataValue = values.find((value) => value.field.apiKey === 'data');
    expect(reads).toBe(0);
    expect(dataValue?.ref.valueFingerprint).toBe(fingerprintValue(data));
    expect(reads).toBeGreaterThan(0);
    const afterFirstRead = reads;
    expect(dataValue?.ref.valueFingerprint).toBe(fingerprintValue(data));
    expect(reads).toBe(afterFirstRead);
    expect({ ...dataValue?.ref }.valueFingerprint).toBe(fingerprintValue(data));
  });
});
