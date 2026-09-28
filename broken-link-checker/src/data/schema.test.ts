import type { Field, ItemType, Role } from 'datocms-plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createSchemaLoader } from './schema';

function model(id: string, isBlock = false): ItemType {
  return {
    id,
    type: 'item_type',
    attributes: { name: id, modular_block: isBlock },
    relationships: {
      presentation_title_field: { data: { id: 'title', type: 'field' } },
      workflow: { data: null },
    },
  } as unknown as ItemType;
}

function field(id: string, validators: Record<string, unknown> = {}): Field {
  return {
    id,
    type: 'field',
    attributes: {
      api_key: id,
      label: id,
      field_type: 'structured_text',
      localized: true,
      appearance: { editor: 'structured_text' },
      validators,
    },
  } as unknown as Field;
}

describe('createSchemaLoader', () => {
  it('discovers regular models and loads recursive/inline blocks with cycle-safe caching', async () => {
    const itemTypes = {
      article: model('article'),
      hero: model('hero', true),
      button: model('button', true),
      empty: undefined,
    };
    const loadItemTypeFields = vi.fn(async (id: string) => {
      if (id === 'article')
        return [
          field('body', {
            structured_text_blocks: { item_types: ['hero'] },
            structured_text_inline_blocks: { item_types: ['button'] },
          }),
        ];
      if (id === 'hero')
        return [
          field('nested', { single_block_blocks: { item_types: ['button'] } }),
        ];
      return [field('nested', { rich_text_blocks: { item_types: ['hero'] } })];
    });
    const loader = createSchemaLoader({ itemTypes, loadItemTypeFields });
    expect(loader.models.map((entry) => entry.id)).toEqual(['article']);
    const [schema, repeated] = await Promise.all([
      loader.load('article'),
      loader.load('article'),
    ]);
    expect([...schema.keys()]).toEqual(['article', 'hero', 'button']);
    expect(repeated).toEqual(schema);
    expect(schema.get('article')?.fields[0]).toEqual({
      id: 'body',
      apiKey: 'body',
      label: 'body',
      type: 'structured_text',
      localized: true,
      editor: 'structured_text',
    });
    expect(loadItemTypeFields).toHaveBeenCalledTimes(3);
  });

  it('fails if an allowed nested model is not available', async () => {
    const loader = createSchemaLoader({
      itemTypes: { article: model('article') },
      loadItemTypeFields: vi.fn().mockResolvedValue([
        field('body', {
          structured_text_blocks: { item_types: ['missing'] },
        }),
      ]),
    });
    await expect(loader.load('article')).rejects.toThrow(
      'schema for model missing',
    );
  });

  it('surfaces failed schema requests and retries them on the next scan', async () => {
    const loadItemTypeFields = vi
      .fn()
      .mockRejectedValueOnce(new Error('No access'))
      .mockResolvedValueOnce([]);
    const loader = createSchemaLoader({
      itemTypes: { article: model('article') },
      loadItemTypeFields,
    });
    await expect(loader.load('article')).rejects.toThrow('No access');
    expect((await loader.load('article')).get('article')?.fields).toEqual([]);
    expect(loadItemTypeFields).toHaveBeenCalledTimes(2);
  });

  it('accepts read-only grants and leaves creator-scoped restrictions to CMA', () => {
    const currentRole = {
      attributes: {
        positive_item_type_permissions: [
          {
            action: 'read',
            environment: 'sandbox',
            item_type: null,
            on_creator: 'self',
          },
        ],
        negative_item_type_permissions: [
          {
            action: 'read',
            environment: 'sandbox',
            item_type: 'denied',
            on_creator: 'anyone',
          },
          {
            action: 'read',
            environment: 'sandbox',
            item_type: 'restricted',
            on_creator: 'self',
          },
        ],
      },
    } as unknown as Role;
    const loader = createSchemaLoader({
      itemTypes: {
        article: model('article'),
        denied: model('denied'),
        restricted: model('restricted'),
      },
      loadItemTypeFields: vi.fn(),
      environment: 'sandbox',
      currentRole,
    });
    expect(loader.models.map((entry) => entry.id)).toEqual([
      'article',
      'restricted',
    ]);
  });

  it('does not expose models with only an edit grant or grants in another environment', () => {
    const currentRole = {
      attributes: {
        positive_item_type_permissions: [
          { action: 'update', environment: 'sandbox', item_type: 'article' },
          { action: 'read', environment: 'main', item_type: 'article' },
        ],
        negative_item_type_permissions: [],
      },
    } as unknown as Role;
    expect(
      createSchemaLoader({
        itemTypes: { article: model('article') },
        loadItemTypeFields: vi.fn(),
        environment: 'sandbox',
        currentRole,
      }).models,
    ).toEqual([]);
  });

  it('includes models readable through inherited role permissions', () => {
    const currentRole = {
      attributes: {
        positive_item_type_permissions: [],
        negative_item_type_permissions: [],
      },
      meta: {
        final_permissions: {
          positive_item_type_permissions: [
            {
              action: 'read',
              environment: 'sandbox',
              item_type: null,
              on_creator: 'anyone',
            },
          ],
          negative_item_type_permissions: [],
        },
      },
    } as unknown as Role;
    expect(
      createSchemaLoader({
        itemTypes: { article: model('article') },
        loadItemTypeFields: vi.fn(),
        environment: 'sandbox',
        currentRole,
      }).models.map((entry) => entry.id),
    ).toEqual(['article']);
  });
});
