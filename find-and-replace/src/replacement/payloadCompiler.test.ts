import type { ApiTypes } from '@datocms/cma-client-browser';
import { describe, expect, it } from 'vitest';
import { buildSchemaIndex } from '../selection/schemaIndex';
import { traverseRecord } from '../selection/traversal';
import type { MatcherSpec, TraversedFieldValue } from '../selection/types';
import {
  type ChangedFieldValue,
  compileRootUpdateAttributes,
  NestedPayloadCompilationError,
} from './payloadCompiler';
import { replaceMatchingText } from './valueReplacement';

const literal = (pattern: string): MatcherSpec => ({
  kind: 'literal',
  pattern,
  caseSensitive: true,
  wholeWord: false,
});

function itemType(
  id: string,
  name: string,
  modularBlock: boolean,
): ApiTypes.ItemType {
  return {
    id,
    name,
    api_key: name.toLowerCase().replace(/ /g, '_'),
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

function block(
  id: string,
  modelId: string,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    type: 'item',
    attributes,
    relationships: {
      item_type: { data: { id: modelId, type: 'item_type' } },
    },
    meta: {},
  };
}

function paragraph(value: string): Record<string, unknown> {
  return {
    type: 'paragraph',
    children: [{ type: 'span', value }],
  };
}

function dast(
  children: unknown[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema: 'dast',
    document: { type: 'root', children },
    ...extra,
  };
}

function createFixture() {
  const page = itemType('page', 'Page', false);
  const section = itemType('section', 'Section', true);
  const detail = itemType('detail', 'Detail', true);
  const content = itemType('content', 'Content', true);
  const inline = itemType('inline', 'Inline', true);
  const hero = itemType('hero', 'Hero', true);

  const schema = buildSchemaIndex({
    itemTypes: [page, section, detail, content, inline, hero],
    fieldsByItemTypeId: new Map([
      [
        page.id,
        [
          field('page-modules', page.id, 'modules', 'rich_text', {
            localized: true,
            position: 0,
            blockModelIds: [section.id],
          }),
          field('page-hero', page.id, 'hero', 'single_block', {
            position: 1,
            blockModelIds: [hero.id],
          }),
          field('page-body', page.id, 'body', 'structured_text', {
            position: 2,
            blockModelIds: [content.id],
            inlineBlockModelIds: [inline.id],
          }),
          field('page-related', page.id, 'related', 'link', { position: 3 }),
        ],
      ],
      [
        section.id,
        [
          field('section-heading', section.id, 'heading', 'string', {
            localized: true,
            position: 0,
          }),
          field('section-detail', section.id, 'detail', 'single_block', {
            localized: true,
            position: 1,
            blockModelIds: [detail.id],
          }),
          field('section-seo', section.id, 'seo', 'seo', { position: 2 }),
        ],
      ],
      [
        detail.id,
        [
          field('detail-body', detail.id, 'body', 'structured_text', {
            blockModelIds: [content.id],
            inlineBlockModelIds: [inline.id],
          }),
        ],
      ],
      [
        content.id,
        [
          field('content-copy', content.id, 'copy', 'text', { position: 0 }),
          field('content-seo', content.id, 'seo', 'seo', {
            localized: true,
            position: 1,
          }),
        ],
      ],
      [inline.id, [field('inline-copy', inline.id, 'copy', 'string')]],
      [
        hero.id,
        [
          field('hero-caption', hero.id, 'caption', 'string', {
            localized: true,
          }),
        ],
      ],
    ]),
  });

  const deepContent = block('deep-content', content.id, {
    copy: 'Deep prose',
    seo: {
      en: {
        title: 'Summer sale',
        description: 'Summer sale details',
        image: 'upload-deep',
        no_index: false,
      },
      it: {
        title: 'Saldi estivi',
        description: 'Dettagli',
        image: null,
        no_index: true,
      },
    },
  });
  const detailEn = block('detail-en', detail.id, {
    body: dast([
      paragraph('Deep introduction'),
      { type: 'block', item: deepContent },
    ]),
  });
  const detailIt = block('detail-it', detail.id, {
    body: dast([paragraph('Dettagli')]),
  });
  const sectionOne = block('section-1', section.id, {
    heading: { en: 'Summer sale', it: 'Saldi estivi' },
    detail: { en: detailEn, it: detailIt },
    seo: {
      title: 'Summer sale section',
      description: 'Seasonal offer',
      image: 'upload-section',
      twitter_card: 'summary_large_image',
      no_index: false,
    },
  });
  const sectionUntouched = block('section-untouched', section.id, {
    heading: { en: 'Untouched', it: 'Invariato' },
    detail: { en: null, it: null },
    seo: null,
  });
  const sectionIt = block('section-it', section.id, {
    heading: { en: 'Other', it: 'Altro' },
    detail: { en: null, it: null },
    seo: null,
  });
  const heroBlock = block('hero-1', hero.id, {
    caption: { en: 'Summer hero', it: 'Estate' },
  });
  const bodyContent = block('body-content', content.id, {
    copy: 'Summer block',
    seo: { en: null, it: null },
  });
  const bodyUntouched = block('body-untouched', content.id, {
    copy: 'Untouched block',
    seo: { en: null, it: null },
  });
  const bodyInline = block('body-inline', inline.id, {
    copy: 'Summer inline',
  });

  const body = dast(
    [
      paragraph('Summer introduction'),
      { type: 'block', item: bodyContent },
      { type: 'block', item: bodyUntouched },
      {
        type: 'paragraph',
        children: [
          { type: 'span', value: 'Before ' },
          { type: 'inlineBlock', item: bodyInline },
          {
            type: 'itemLink',
            item: 'linked-record',
            children: [{ type: 'span', value: 'linked label' }],
          },
          { type: 'inlineItem', item: 'inline-record' },
        ],
      },
    ],
    {
      blocks: [
        bodyContent,
        bodyUntouched,
        block('orphan', content.id, {
          copy: 'Hydration-only orphan',
          seo: { en: null, it: null },
        }),
      ],
    },
  );

  const linkedRecord = {
    id: 'linked-record',
    type: 'item',
    attributes: { title: 'Do not compile me' },
    relationships: {
      item_type: { data: { id: page.id, type: 'item_type' } },
    },
  };
  const record = {
    id: 'page-1',
    type: 'item',
    attributes: {
      modules: {
        en: [sectionOne, sectionUntouched],
        it: [sectionIt],
      },
      hero: heroBlock,
      body,
      related: linkedRecord,
    },
    relationships: {
      item_type: { data: { id: page.id, type: 'item_type' } },
    },
    meta: { current_version: 'version-1' },
  };

  const values = traverseRecord({
    record,
    rootModelId: page.id,
    schema,
    siteId: 'site',
    environment: 'main',
    locales: ['en', 'it'],
  });

  return { schema, record, values };
}

function findValue(
  values: TraversedFieldValue[],
  fieldId: string,
  options: { ownerId?: string; locale?: string | null } = {},
): TraversedFieldValue {
  const result = values.find(
    (value) =>
      value.ref.fieldId === fieldId &&
      (options.ownerId === undefined ||
        value.ref.ownerRecordId === options.ownerId) &&
      (options.locale === undefined || value.ref.locale === options.locale),
  );

  if (!result) {
    throw new Error(`Missing fixture field value: ${fieldId}`);
  }
  return result;
}

function replacement(
  fieldValue: TraversedFieldValue,
  find: string,
  replace: string,
): ChangedFieldValue {
  const result = replaceMatchingText(fieldValue, literal(find), replace);
  expect(result.changed).toBe(true);
  return { fieldValue, value: result.value };
}

describe('compileRootUpdateAttributes', () => {
  it('merges localized and SEO changes in one Modular Content block', () => {
    const { schema, record, values } = createFixture();
    const heading = findValue(values, 'section-heading', {
      ownerId: 'section-1',
      locale: 'en',
    });
    const seo = findValue(values, 'section-seo', {
      ownerId: 'section-1',
    });

    const attributes = compileRootUpdateAttributes({
      root: record,
      schema,
      changedValues: [
        replacement(heading, 'Summer sale', 'Winter offer'),
        replacement(seo, 'Summer sale', 'Winter offer'),
      ],
    });

    expect(attributes).toEqual({
      modules: {
        en: [
          {
            id: 'section-1',
            type: 'item',
            attributes: {
              heading: { en: 'Winter offer', it: 'Saldi estivi' },
              seo: {
                title: 'Winter offer section',
                description: 'Seasonal offer',
                image: 'upload-section',
                twitter_card: 'summary_large_image',
                no_index: false,
              },
            },
          },
          'section-untouched',
        ],
        it: ['section-it'],
      },
    });
  });

  it('compiles a changed Single Block and preserves its complete locale map', () => {
    const { schema, record, values } = createFixture();
    const caption = findValue(values, 'hero-caption', {
      ownerId: 'hero-1',
      locale: 'en',
    });

    expect(
      compileRootUpdateAttributes({
        root: record,
        schema,
        changedValues: [replacement(caption, 'Summer hero', 'Winter hero')],
      }),
    ).toEqual({
      hero: {
        id: 'hero-1',
        type: 'item',
        attributes: {
          caption: { en: 'Winter hero', it: 'Estate' },
        },
      },
    });
  });

  it('combines Structured Text prose, block, and inline-block replacements', () => {
    const { schema, record, values } = createFixture();
    const body = findValue(values, 'page-body', { ownerId: 'page-1' });
    const blockCopy = findValue(values, 'content-copy', {
      ownerId: 'body-content',
    });
    const inlineCopy = findValue(values, 'inline-copy', {
      ownerId: 'body-inline',
    });

    const attributes = compileRootUpdateAttributes({
      root: record,
      schema,
      changedValues: [
        replacement(body, 'Summer introduction', 'Winter introduction'),
        replacement(blockCopy, 'Summer block', 'Winter block'),
        replacement(inlineCopy, 'Summer inline', 'Winter inline'),
      ],
    });

    expect(attributes).toEqual({
      body: {
        schema: 'dast',
        document: {
          type: 'root',
          children: [
            paragraph('Winter introduction'),
            {
              type: 'block',
              item: {
                id: 'body-content',
                type: 'item',
                attributes: { copy: 'Winter block' },
              },
            },
            { type: 'block', item: 'body-untouched' },
            {
              type: 'paragraph',
              children: [
                { type: 'span', value: 'Before ' },
                {
                  type: 'inlineBlock',
                  item: {
                    id: 'body-inline',
                    type: 'item',
                    attributes: { copy: 'Winter inline' },
                  },
                },
                {
                  type: 'itemLink',
                  item: 'linked-record',
                  children: [{ type: 'span', value: 'linked label' }],
                },
                { type: 'inlineItem', item: 'inline-record' },
              ],
            },
          ],
        },
      },
    });
    expect((attributes.body as Record<string, unknown>).blocks).toBeUndefined();
  });

  it('recurses bottom-up through localized Modular, Single Block, and Structured Text containers', () => {
    const { schema, record, values } = createFixture();
    const nestedSeo = findValue(values, 'content-seo', {
      ownerId: 'deep-content',
      locale: 'en',
    });

    expect(
      compileRootUpdateAttributes({
        root: record,
        schema,
        changedValues: [replacement(nestedSeo, 'Summer sale', 'Winter offer')],
      }),
    ).toEqual({
      modules: {
        en: [
          {
            id: 'section-1',
            type: 'item',
            attributes: {
              detail: {
                en: {
                  id: 'detail-en',
                  type: 'item',
                  attributes: {
                    body: {
                      schema: 'dast',
                      document: {
                        type: 'root',
                        children: [
                          paragraph('Deep introduction'),
                          {
                            type: 'block',
                            item: {
                              id: 'deep-content',
                              type: 'item',
                              attributes: {
                                seo: {
                                  en: {
                                    title: 'Winter offer',
                                    description: 'Winter offer details',
                                    image: 'upload-deep',
                                    no_index: false,
                                  },
                                  it: {
                                    title: 'Saldi estivi',
                                    description: 'Dettagli',
                                    image: null,
                                    no_index: true,
                                  },
                                },
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
                it: 'detail-it',
              },
            },
          },
          'section-untouched',
        ],
        it: ['section-it'],
      },
    });
  });

  it('rejects conflicting changes for the same fresh value path', () => {
    const { schema, record, values } = createFixture();
    const caption = findValue(values, 'hero-caption', {
      ownerId: 'hero-1',
      locale: 'en',
    });

    expect(() =>
      compileRootUpdateAttributes({
        root: record,
        schema,
        changedValues: [
          { fieldValue: caption, value: 'First' },
          { fieldValue: caption, value: 'Second' },
        ],
      }),
    ).toThrow(NestedPayloadCompilationError);
  });
});
