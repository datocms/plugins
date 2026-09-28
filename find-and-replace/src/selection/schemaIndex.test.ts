import type { ApiTypes } from '@datocms/cma-client-browser';
import { describe, expect, it } from 'vitest';
import { buildSchemaIndex } from './schemaIndex';

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
    label?: string;
    localized?: boolean;
    position?: number;
    blockModelIds?: string[];
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
              structured_text_inline_blocks: { item_types: [] },
              structured_text_links: { item_types: [] },
            }
          : {};

  return {
    id,
    type: 'field',
    label: options.label ?? apiKey,
    api_key: apiKey,
    field_type: fieldType,
    localized: options.localized ?? false,
    position: options.position ?? 0,
    validators,
    item_type: { id: modelId, type: 'item_type' },
  } as ApiTypes.Field;
}

describe('buildSchemaIndex', () => {
  it('groups API keys and resolves root reachability through cyclic block schemas', () => {
    const root = itemType('root', 'Page', false);
    const blockA = itemType('block-a', 'Section', true);
    const blockB = itemType('block-b', 'Callout', true);
    const unrelatedRoot = itemType('other', 'Other', false);
    const fields = new Map<string, ApiTypes.Field[]>([
      [
        root.id,
        [
          field('root-title', root.id, 'shared', 'string', {
            label: 'Page title',
          }),
          field('root-blocks', root.id, 'content', 'rich_text', {
            blockModelIds: [blockA.id],
          }),
        ],
      ],
      [
        blockA.id,
        [
          field('a-title', blockA.id, 'shared', 'text', {
            label: 'Heading',
            localized: true,
          }),
          field('a-child', blockA.id, 'child', 'single_block', {
            blockModelIds: [blockB.id],
          }),
        ],
      ],
      [
        blockB.id,
        [
          field('b-title', blockB.id, 'shared', 'integer', {
            label: 'Display number',
          }),
          field('b-cycle', blockB.id, 'cycle', 'rich_text', {
            blockModelIds: [blockA.id],
          }),
        ],
      ],
      [
        unrelatedRoot.id,
        [field('other-title', unrelatedRoot.id, 'shared', 'slug')],
      ],
    ]);

    const index = buildSchemaIndex({
      itemTypes: [root, blockA, blockB, unrelatedRoot],
      fieldsByItemTypeId: fields,
      rootModelIds: [root.id],
    });

    expect(index.rootModelIds).toEqual([root.id]);
    expect([
      ...(index.reachableRootModelIdsByBlockModelId.get(blockA.id) ?? []),
    ]).toEqual([root.id]);
    expect([
      ...(index.reachableRootModelIdsByBlockModelId.get(blockB.id) ?? []),
    ]).toEqual([root.id]);

    const shared = index.apiKeyCatalogByKey.get('shared');
    expect(shared).toMatchObject({
      apiKey: 'shared',
      label: 'Display number / Heading / Page title',
      modelCount: 1,
      blockModelCount: 2,
      localized: 'mixed',
      exactMatchCompatible: true,
      incompatibleLocationCount: 1,
    });
    expect(
      shared?.locations.map((location) => location.modelId).sort(),
    ).toEqual([root.id, blockA.id, blockB.id].sort());
    expect(
      shared?.locations.map((location) => location.fieldLabel).sort(),
    ).toEqual(['Display number', 'Heading', 'Page title']);
    expect(
      shared?.locations.some(
        (location) => location.modelId === unrelatedRoot.id,
      ),
    ).toBe(false);
  });
});
