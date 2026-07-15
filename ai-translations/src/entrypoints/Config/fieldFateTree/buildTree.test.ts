import { describe, expect, it } from 'vitest';
import {
  blockTypeIdsOf,
  buildModelNode,
  buildModelsFromSchema,
} from './buildTree';
import type { LoadedField, LoadedItemType } from './buildTree';

const field = (
  id: string,
  apiKey: string,
  fieldType: string,
  validators: Record<string, unknown> = {},
): LoadedField => ({
  id,
  attributes: {
    label: apiKey,
    api_key: apiKey,
    field_type: fieldType,
    validators,
  },
});

const itemType = (
  id: string,
  name: string,
  modularBlock = false,
): LoadedItemType => ({
  id,
  attributes: { name, modular_block: modularBlock },
});

describe('blockTypeIdsOf', () => {
  it('reads rich_text_blocks item_types', () => {
    expect(blockTypeIdsOf({ rich_text_blocks: { item_types: ['b1'] } })).toEqual([
      'b1',
    ]);
  });
  it('reads structured_text_blocks item_types', () => {
    expect(
      blockTypeIdsOf({ structured_text_blocks: { item_types: ['b2', 'b3'] } }),
    ).toEqual(['b2', 'b3']);
  });
  it('reads single_block_blocks item_types', () => {
    expect(blockTypeIdsOf({ single_block_blocks: { item_types: ['b4'] } })).toEqual(
      ['b4'],
    );
  });
  it('returns empty for a plain field', () => {
    expect(blockTypeIdsOf({ required: {} })).toEqual([]);
  });
});

describe('buildModelNode', () => {
  it('keeps translatable fields and footers the rest', () => {
    const fields = new Map([
      ['m1', [field('f1', 'title', 'single_line'), field('f2', 'flag', 'boolean')]],
    ]);
    const node = buildModelNode(itemType('m1', 'Article'), fields, new Map());
    expect(node.fields.map((f) => f.apiKey)).toEqual(['title']);
    expect(node.nonTranslatable.map((f) => f.label)).toEqual(['flag']);
  });

  it('nests a rich_text block field’s sub-fields', () => {
    const fields = new Map<string, LoadedField[]>([
      [
        'm1',
        [
          field('f1', 'body', 'rich_text', {
            rich_text_blocks: { item_types: ['b1'] },
          }),
        ],
      ],
      ['b1', [field('bf1', 'heading', 'single_line')]],
    ]);
    const itemTypes = new Map([['b1', itemType('b1', 'Callout', true)]]);
    const node = buildModelNode(itemType('m1', 'Article'), fields, itemTypes);
    expect(node.fields[0].apiKey).toBe('body');
    expect(node.fields[0].children?.[0].apiKey).toBe('heading');
  });

  it('expands a single_block container even though its editor is not a translatable type', () => {
    const fields = new Map<string, LoadedField[]>([
      [
        'm1',
        [
          field('f1', 'hero', 'single_block', {
            single_block_blocks: { item_types: ['b1'] },
          }),
        ],
      ],
      ['b1', [field('bf1', 'headline', 'single_line')]],
    ]);
    const itemTypes = new Map([['b1', itemType('b1', 'Hero', true)]]);
    const node = buildModelNode(itemType('m1', 'Article'), fields, itemTypes);
    expect(node.fields[0].children?.[0].apiKey).toBe('headline');
  });

  it('footers a block container with no translatable sub-fields', () => {
    const fields = new Map<string, LoadedField[]>([
      [
        'm1',
        [
          field('f1', 'body', 'rich_text', {
            rich_text_blocks: { item_types: ['b1'] },
          }),
        ],
      ],
      ['b1', [field('bf1', 'flag', 'boolean')]],
    ]);
    const itemTypes = new Map([['b1', itemType('b1', 'Empty', true)]]);
    const node = buildModelNode(itemType('m1', 'Article'), fields, itemTypes);
    expect(node.fields).toEqual([]);
    expect(node.nonTranslatable.map((f) => f.label)).toEqual(['body']);
  });

  it('stops a self-referential block without infinite recursion', () => {
    const fields = new Map<string, LoadedField[]>([
      [
        'm1',
        [
          field('f1', 'body', 'rich_text', {
            rich_text_blocks: { item_types: ['b1'] },
          }),
        ],
      ],
      [
        'b1',
        [
          field('bf1', 'text', 'single_line'),
          field('bf2', 'nested', 'rich_text', {
            rich_text_blocks: { item_types: ['b1'] },
          }),
        ],
      ],
    ]);
    const itemTypes = new Map([['b1', itemType('b1', 'Self', true)]]);
    const node = buildModelNode(itemType('m1', 'Article'), fields, itemTypes);
    // body → b1 expands to its leaf 'text'; 'nested' recurses back into b1,
    // which is a cycle, so it has no configurable descendants and is pruned.
    // b1's fields are already configurable here (fate is global to the block
    // type), so nothing is lost. The key requirement: no infinite recursion.
    const body = node.fields[0];
    expect(body.children?.map((c) => c.apiKey)).toEqual(['text']);
  });

  it('expands the same block under two sibling fields (per-path cycle detection)', () => {
    const fields = new Map<string, LoadedField[]>([
      [
        'm1',
        [
          field('f1', 'a', 'rich_text', { rich_text_blocks: { item_types: ['b1'] } }),
          field('f2', 'b', 'rich_text', { rich_text_blocks: { item_types: ['b1'] } }),
        ],
      ],
      ['b1', [field('bf1', 'inner', 'single_line')]],
    ]);
    const itemTypes = new Map([['b1', itemType('b1', 'Shared', true)]]);
    const node = buildModelNode(itemType('m1', 'Article'), fields, itemTypes);
    expect(node.fields[0].children?.[0].apiKey).toBe('inner');
    expect(node.fields[1].children?.[0].apiKey).toBe('inner');
  });

  it('marks required via cannotBeBlank', () => {
    const fields = new Map([
      ['m1', [field('f1', 'title', 'single_line', { required: {} })]],
    ]);
    const node = buildModelNode(itemType('m1', 'Article'), fields, new Map());
    expect(node.fields[0].required).toBe(true);
  });
});

describe('buildModelsFromSchema', () => {
  it('builds a node per top-level model and excludes block item types', () => {
    const itemTypes = [
      itemType('m1', 'Article'),
      itemType('b1', 'Callout', true),
    ];
    const fields = new Map<string, LoadedField[]>([
      [
        'm1',
        [
          field('f1', 'body', 'rich_text', {
            rich_text_blocks: { item_types: ['b1'] },
          }),
        ],
      ],
      ['b1', [field('bf1', 'heading', 'single_line')]],
    ]);
    const models = buildModelsFromSchema(itemTypes, fields);
    expect(models.map((m) => m.name)).toEqual(['Article']);
    expect(models[0].fields[0].children?.[0].apiKey).toBe('heading');
  });
});
