import type {
  ApiTypes,
  Client,
  RawApiTypes,
} from '@datocms/cma-client-browser';
import {
  type DiscoveredTarget,
  discoverTargetsInRecord,
} from '../selection/discoverTargets';
import { buildSchemaIndex } from '../selection/schemaIndex';
import type {
  DiscoverySpec,
  MatcherSpec,
  SchemaIndex,
} from '../selection/types';

export type ReplacementClientSpies = {
  rawFind: ReturnType<typeof import('vitest').vi.fn>;
  validateExisting: ReturnType<typeof import('vitest').vi.fn>;
  update: ReturnType<typeof import('vitest').vi.fn>;
  publish: ReturnType<typeof import('vitest').vi.fn>;
};

function itemType(
  id: string,
  name: string,
  modularBlock: boolean,
  titleFieldId?: string,
  presentationTitleFieldId?: string,
): ApiTypes.ItemType {
  return {
    id,
    type: 'item_type',
    name,
    api_key: name.toLowerCase().replace(/ /g, '_'),
    modular_block: modularBlock,
    ...(titleFieldId
      ? { title_field: { id: titleFieldId, type: 'field' } }
      : {}),
    ...(presentationTitleFieldId
      ? {
          presentation_title_field: {
            id: presentationTitleFieldId,
            type: 'field',
          },
        }
      : {}),
  } as ApiTypes.ItemType;
}

function field(
  id: string,
  modelId: string,
  label: string,
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
    label,
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
    relationships: {
      item_type: { data: { id: modelId, type: 'item_type' } },
    },
    meta: {},
  };
}

export function replacementSchema(): SchemaIndex {
  const article = itemType('article-model', 'Article', false, 'title-field');
  const contentBlock = itemType('content-block', 'Content block', true);
  const inlineBlock = itemType('inline-block', 'Inline block', true);

  return buildSchemaIndex({
    itemTypes: [article, contentBlock, inlineBlock],
    fieldsByItemTypeId: new Map([
      [
        article.id,
        [
          field('title-field', article.id, 'Title', 'title', 'string', {
            position: 1,
          }),
          field('summary-field', article.id, 'Summary', 'summary', 'text', {
            position: 2,
          }),
          field('seo-field', article.id, 'SEO', 'seo', 'seo', {
            position: 3,
          }),
          field(
            'content-field',
            article.id,
            'Content',
            'content',
            'rich_text',
            {
              position: 4,
              blockModelIds: [contentBlock.id],
            },
          ),
        ],
      ],
      [
        contentBlock.id,
        [
          field('copy-field', contentBlock.id, 'Copy', 'copy', 'text', {
            position: 1,
          }),
          field(
            'body-field',
            contentBlock.id,
            'Body',
            'body',
            'structured_text',
            {
              position: 2,
              inlineBlockModelIds: [inlineBlock.id],
            },
          ),
        ],
      ],
      [
        inlineBlock.id,
        [field('label-field', inlineBlock.id, 'Label', 'label', 'string')],
      ],
    ]),
  });
}

export function replacementRoot(
  id = 'article-1',
  version = 'version-1',
): RawApiTypes.ItemInNestedResponse {
  const inline = blockRecord('inline-1', 'inline-block', {
    label: 'Summer sale inline',
  });
  const content = blockRecord('content-1', 'content-block', {
    copy: 'Summer sale in a nested block',
    body: {
      schema: 'dast',
      document: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'span', value: 'Summer ' },
              { type: 'span', marks: ['strong'], value: 'sale in prose' },
            ],
          },
          { type: 'inlineBlock', item: inline },
        ],
      },
    },
  });

  return {
    id,
    type: 'item',
    attributes: {
      title: 'Summer sale and summer sale',
      summary: 'Promo week',
      seo: {
        title: 'Summer sale',
        description: 'Summer sale details',
        image: 'upload-1',
        no_index: false,
      },
      content: [content],
    },
    relationships: {
      item_type: {
        data: { id: 'article-model', type: 'item_type' },
      },
    },
    meta: {
      status: 'draft',
      current_version: version,
      created_at: '2026-07-30T10:00:00Z',
      updated_at: '2026-07-30T10:00:00Z',
      published_at: null,
      first_published_at: null,
      publication_scheduled_at: null,
      unpublishing_scheduled_at: null,
      is_valid: true,
      is_current_version_valid: true,
      is_published_version_valid: null,
      stage: null,
      has_children: null,
    },
  } as RawApiTypes.ItemInNestedResponse;
}

export function cloneRoot(
  root: RawApiTypes.ItemInNestedResponse,
): RawApiTypes.ItemInNestedResponse {
  return structuredClone(root);
}

export function literalMatcher(
  pattern: string,
  caseSensitive = false,
  wholeWord = false,
): MatcherSpec {
  return { kind: 'literal', pattern, caseSensitive, wholeWord };
}

export function regexMatcher(
  pattern: string,
  caseSensitive = false,
  wholeWord = false,
): MatcherSpec {
  return { kind: 'regex', pattern, caseSensitive, wholeWord };
}

export async function discoverReplacementTargets(args: {
  record: RawApiTypes.ItemInNestedResponse;
  schema?: SchemaIndex;
  matcher?: MatcherSpec;
  granularity?: DiscoverySpec['granularity'];
  workflow?: DiscoverySpec['workflow'];
  apiKey?: string;
}): Promise<DiscoveredTarget[]> {
  const schema = args.schema ?? replacementSchema();
  const workflow = args.workflow ?? 'text';
  const matcher = args.matcher ?? literalMatcher('summer sale');

  return discoverTargetsInRecord({
    record: args.record,
    rootModelId: 'article-model',
    schema,
    siteId: 'site-1',
    environment: 'main',
    spec: {
      workflow,
      granularity: args.granularity ?? 'field_value',
      rootModelIds: ['article-model'],
      locales: ['en'],
      publicationStatuses: ['draft', 'updated', 'published'],
      ...(workflow === 'field_api_key'
        ? { apiKey: args.apiKey ?? 'copy' }
        : { matcher }),
    },
  });
}

export async function replacementClient(
  roots: ReadonlyMap<string, RawApiTypes.ItemInNestedResponse>,
): Promise<{ client: Client; spies: ReplacementClientSpies }> {
  const { vi } = await import('vitest');
  const rawFind = vi.fn(async (id: string) => {
    const root = roots.get(id);
    if (!root) throw new Error(`Missing fixture root: ${id}`);
    return { data: cloneRoot(root) };
  });
  const validateExisting = vi.fn(async () => undefined);
  const update = vi.fn(async (id: string) => {
    const root = roots.get(id);
    if (!root) throw new Error(`Missing fixture root: ${id}`);
    return cloneRoot(root);
  });
  const publish = vi.fn(async () => undefined);

  return {
    client: {
      items: { rawFind, validateExisting, update, publish },
    } as unknown as Client,
    spies: { rawFind, validateExisting, update, publish },
  };
}

/**
 * A richer project for find and replace: localized fields, SEO, a slug,
 * Structured Text with a block and an inline block, Modular Content with
 * repeated and nested blocks, and a single block. Every text mentions "Acme".
 */
export function findReplaceSchema(): SchemaIndex {
  const article = itemType(
    'article-model',
    'Article',
    false,
    'title-field',
    'headline-field',
  );
  const quote = itemType('quote-block', 'Quote', true);
  const callout = itemType('callout-block', 'Callout', true);
  const section = itemType('section-block', 'Section', true);
  const cta = itemType('cta-block', 'Call to action', true);

  return buildSchemaIndex({
    itemTypes: [article, quote, callout, section, cta],
    fieldsByItemTypeId: new Map([
      [
        article.id,
        [
          field('title-field', article.id, 'Title', 'title', 'string', {
            localized: true,
            position: 1,
          }),
          field(
            'headline-field',
            article.id,
            'Headline',
            'headline',
            'string',
            { position: 2 },
          ),
          field('slug-field', article.id, 'Slug', 'slug', 'slug', {
            position: 3,
          }),
          field('article-seo-field', article.id, 'SEO', 'seo', 'seo', {
            position: 4,
          }),
          field(
            'article-body-field',
            article.id,
            'Body',
            'body',
            'structured_text',
            {
              localized: true,
              position: 5,
              blockModelIds: [quote.id],
              inlineBlockModelIds: [cta.id],
            },
          ),
          field(
            'article-content-field',
            article.id,
            'Content',
            'content',
            'rich_text',
            {
              position: 6,
              blockModelIds: [quote.id, callout.id, section.id],
            },
          ),
          field('hero-field', article.id, 'Hero', 'hero', 'single_block', {
            position: 7,
            blockModelIds: [quote.id],
          }),
        ],
      ],
      [quote.id, [field('quote-text-field', quote.id, 'Text', 'text', 'text')]],
      [
        callout.id,
        [field('callout-label-field', callout.id, 'Label', 'label', 'string')],
      ],
      [
        section.id,
        [
          field(
            'section-heading-field',
            section.id,
            'Heading',
            'heading',
            'string',
            { position: 1 },
          ),
          field(
            'section-items-field',
            section.id,
            'Items',
            'items',
            'rich_text',
            { position: 2, blockModelIds: [quote.id] },
          ),
        ],
      ],
      [cta.id, [field('cta-label-field', cta.id, 'Label', 'label', 'string')]],
    ]),
  });
}

export function findReplaceRoot(
  id = 'article-1',
  version = 'version-1',
): RawApiTypes.ItemInNestedResponse {
  const quote = (blockId: string, text: string) =>
    blockRecord(blockId, 'quote-block', { text });

  return {
    id,
    type: 'item',
    attributes: {
      title: { en: 'Acme Widget by ACME', it: 'Widget Acme' },
      headline: 'The Acme headline',
      slug: 'acme-widget',
      seo: {
        title: 'Acme',
        description: 'Buy Acme today',
        image: null,
        no_index: false,
      },
      body: {
        en: {
          schema: 'dast',
          document: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'span', value: 'Hello Ac' },
                  {
                    type: 'span',
                    marks: ['strong'],
                    value: 'me world, acme again',
                  },
                ],
              },
              { type: 'block', item: quote('q-body', 'Quote about Acme') },
              {
                type: 'paragraph',
                children: [
                  { type: 'span', value: 'Before ' },
                  {
                    type: 'inlineBlock',
                    item: blockRecord('cta-1', 'cta-block', {
                      label: 'Try Acme',
                    }),
                  },
                  { type: 'span', value: ' Acme after' },
                ],
              },
            ],
          },
        },
        it: {
          schema: 'dast',
          document: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'span', value: 'Ciao Acme' }],
              },
            ],
          },
        },
      },
      content: [
        quote('q-1', 'First Acme quote'),
        blockRecord('c-1', 'callout-block', { label: 'Acme callout' }),
        quote('q-2', 'Second Acme quote'),
        blockRecord('s-1', 'section-block', {
          heading: 'Acme section',
          items: [quote('q-3', 'Nested Acme quote')],
        }),
      ],
      hero: quote('q-hero', 'Hero Acme'),
    },
    relationships: {
      item_type: {
        data: { id: 'article-model', type: 'item_type' },
      },
    },
    meta: {
      status: 'published',
      current_version: version,
      created_at: '2026-07-30T10:00:00Z',
      updated_at: '2026-07-30T10:00:00Z',
      published_at: '2026-07-30T10:00:00Z',
      first_published_at: '2026-07-30T10:00:00Z',
      publication_scheduled_at: null,
      unpublishing_scheduled_at: null,
      is_valid: true,
      is_current_version_valid: true,
      is_published_version_valid: true,
      stage: null,
      has_children: null,
    },
  } as RawApiTypes.ItemInNestedResponse;
}
