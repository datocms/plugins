import { loadAllFields } from '@utils/fieldLoader';
import { describe, expect, it, vi } from 'vitest';

function createField(apiKey: string, fieldType: string, validators = {}) {
  return {
    attributes: {
      api_key: apiKey,
      label: apiKey,
      localized: false,
      field_type: fieldType,
      validators,
      appearance: {},
    },
  };
}

describe('loadAllFields', () => {
  it.each([
    ['rich_text', 'rich_text_blocks', 'content.0.title'],
    ['single_block', 'single_block_blocks', 'content.title'],
  ])('loads nested fields for SDK %s with its %s validator', async (fieldType, validatorKey, nestedPath) => {
    const field = createField('content', fieldType, {
      [validatorKey]: { item_types: ['block-1'] },
    });
    const block = { itemTypeId: 'block-1', attributes: { title: 'One' } };
    const loadItemTypeFields = vi.fn(async (modelId: string) =>
      modelId === 'model-1' ? [field] : [createField('title', 'string')],
    );
    const ctx = {
      itemType: { id: 'model-1' },
      site: { attributes: { locales: ['en'] } },
      itemTypes: { 'block-1': { id: 'block-1', attributes: { name: 'Block' } } },
      formValues: { content: fieldType === 'single_block' ? block : [block] },
      loadItemTypeFields,
    } as never;

    const fields = await loadAllFields(ctx);

    expect(fields.map((entry) => entry.fieldPath)).toEqual(['content', nestedPath]);
    expect(fields[1]?.displayLabel).toContain('Block');
    expect(loadItemTypeFields).toHaveBeenCalledTimes(2);
  });

  it('caches repeated block field metadata loads within one pass', async () => {
    const modularField = createField('content', 'modular_content', {
      item_item_type: { item_types: ['block-1'] },
    });
    const blockField = createField('title', 'string');
    const loadItemTypeFields = vi.fn(async (itemTypeId: string) =>
      itemTypeId === 'model-1' ? [modularField] : [blockField],
    );

    const ctx = {
      itemType: { id: 'model-1' },
      site: { attributes: { locales: ['en'] } },
      itemTypes: {
        'block-1': {
          id: 'block-1',
          attributes: { name: 'Block' },
        },
      },
      formValues: {
        content: [
          { itemTypeId: 'block-1', attributes: { title: 'One' } },
          { itemTypeId: 'block-1', attributes: { title: 'Two' } },
        ],
      },
      loadItemTypeFields,
    } as never;

    const fields = await loadAllFields(ctx);

    expect(fields.map((field) => field.fieldPath)).toEqual([
      'content',
      'content.0.title',
      'content.1.title',
    ]);
    expect(loadItemTypeFields).toHaveBeenCalledTimes(2);
    expect(loadItemTypeFields).toHaveBeenNthCalledWith(1, 'model-1');
    expect(loadItemTypeFields).toHaveBeenNthCalledWith(2, 'block-1');
  });
});
