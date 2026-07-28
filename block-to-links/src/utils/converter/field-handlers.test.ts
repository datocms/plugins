import { beforeEach, describe, expect, it, vi } from 'vitest';

const migrateMocks = vi.hoisted(() => ({
  migrateFieldData: vi.fn(),
  migrateFieldDataAppend: vi.fn(),
  migrateNestedBlockFieldData: vi.fn(),
  migrateNestedBlockFieldDataAppend: vi.fn(),
  migrateNestedStructuredTextFieldData: vi.fn(),
  migrateNestedStructuredTextFieldDataPartial: vi.fn(),
  migrateStructuredTextFieldData: vi.fn(),
  migrateStructuredTextFieldDataPartial: vi.fn(),
}));

vi.mock('./migrate', () => migrateMocks);

import type {
  CMAClient,
  ConversionRollbackAction,
  ModularContentFieldInfo,
} from '../../types';
import { convertModularContentToLinksField } from './field-handlers';

function modularField(): ModularContentFieldInfo {
  return {
    id: 'source-field',
    label: 'Content',
    apiKey: 'content',
    parentModelId: 'page-model',
    parentModelName: 'Page',
    parentModelApiKey: 'page',
    parentIsBlock: false,
    localized: true,
    allowedBlockIds: ['target-block'],
    fieldType: 'rich_text',
  };
}

function conversionContext(
  client: CMAClient,
  rollbackActions: ConversionRollbackAction[],
) {
  return {
    client,
    mcField: modularField(),
    newModelId: 'new-model',
    blockIdToRemove: 'target-block',
    mapping: { 'source-block': 'new-record' },
    nestedPaths: [],
    availableLocales: ['en', 'de-DE'],
    fullyReplace: false,
    rollbackActions,
  };
}

describe('non-destructive field conversion rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const migrateMock of Object.values(migrateMocks)) {
      migrateMock.mockResolvedValue(undefined);
    }
  });

  it('restores existing links field validators after an append failure', async () => {
    const originalValidators = {
      items_item_type: { item_types: ['existing-model'] },
    };
    const update = vi.fn(async () => {});
    const client = {
      fields: {
        find: vi.fn(async () => ({
          id: 'source-field',
          label: 'Content',
          position: 1,
          hint: null,
          fieldset: null,
          validators: {
            rich_text_blocks: { item_types: ['target-block'] },
          },
        })),
        list: vi.fn(async () => [
          {
            id: 'links-field',
            api_key: 'content_links',
            validators: originalValidators,
          },
        ]),
        update,
      },
    } as unknown as CMAClient;
    const rollbackActions: ConversionRollbackAction[] = [];
    migrateMocks.migrateFieldDataAppend.mockRejectedValue(
      new Error('PUT /items/page-1: 500'),
    );

    await expect(
      convertModularContentToLinksField(
        conversionContext(client, rollbackActions),
      ),
    ).rejects.toThrow('PUT /items/page-1: 500');

    expect(rollbackActions).toHaveLength(1);
    await rollbackActions[0].run();
    expect(update).toHaveBeenLastCalledWith('links-field', {
      validators: originalValidators,
    });
  });

  it('registers cleanup for a newly-created links field before migration', async () => {
    const destroy = vi.fn(async () => {});
    const client = {
      fields: {
        find: vi.fn(async () => ({
          id: 'source-field',
          label: 'Content',
          position: 1,
          hint: null,
          fieldset: null,
          validators: {
            rich_text_blocks: { item_types: ['target-block'] },
          },
        })),
        list: vi.fn(async () => []),
        create: vi.fn(async () => ({
          id: 'new-links-field',
          api_key: 'content_links',
        })),
        destroy,
      },
    } as unknown as CMAClient;
    const rollbackActions: ConversionRollbackAction[] = [];
    migrateMocks.migrateFieldData.mockRejectedValue(
      new Error('PUT /items/page-1: 500'),
    );

    await expect(
      convertModularContentToLinksField(
        conversionContext(client, rollbackActions),
      ),
    ).rejects.toThrow('PUT /items/page-1: 500');

    expect(rollbackActions).toHaveLength(1);
    await rollbackActions[0].run();
    expect(destroy).toHaveBeenCalledWith('new-links-field');
  });
});
