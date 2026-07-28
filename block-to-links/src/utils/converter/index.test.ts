import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analyzeBlock: vi.fn(),
  buildNestedPathsToRootModels: vi.fn(),
  getGroupedBlockInstances: vi.fn(),
  convertModularContentToLinksField: vi.fn(),
  cleanupNestedBlocksFromOriginalField: vi.fn(),
  migrateBlocksToRecordsNested: vi.fn(),
  migrateGroupedBlocksToRecords: vi.fn(),
  createNewModelFromBlock: vi.fn(),
  deleteOriginalBlock: vi.fn(),
  renameModelToOriginal: vi.fn(),
}));

vi.mock('../analyzer', () => ({
  analyzeBlock: mocks.analyzeBlock,
  buildNestedPathsToRootModels: mocks.buildNestedPathsToRootModels,
  getGroupedBlockInstances: mocks.getGroupedBlockInstances,
}));

vi.mock('./field-handlers', () => ({
  convertModularContentToLinksField:
    mocks.convertModularContentToLinksField,
  cleanupNestedBlocksFromOriginalField:
    mocks.cleanupNestedBlocksFromOriginalField,
}));

vi.mock('./migrate', () => ({
  migrateBlocksToRecordsNested: mocks.migrateBlocksToRecordsNested,
  migrateGroupedBlocksToRecords: mocks.migrateGroupedBlocksToRecords,
}));

vi.mock('./model', () => ({
  createNewModelFromBlock: mocks.createNewModelFromBlock,
  deleteOriginalBlock: mocks.deleteOriginalBlock,
  renameModelToOriginal: mocks.renameModelToOriginal,
}));

import type {
  CMAClient,
  ConversionRollbackAction,
  ModularContentFieldInfo,
} from '../../types';
import { convertBlockToModel } from './index';

function modularField(id: string): ModularContentFieldInfo {
  return {
    id,
    label: id,
    apiKey: id,
    parentModelId: 'parent-block',
    parentModelName: 'Parent block',
    parentModelApiKey: 'parent_block',
    parentIsBlock: true,
    localized: true,
    allowedBlockIds: ['target-block'],
    fieldType: 'rich_text',
  };
}

describe('schema-changing field conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.analyzeBlock.mockResolvedValue({
      block: {
        id: 'target-block',
        name: 'Target block',
        apiKey: 'target_block',
      },
      fields: [],
      modularContentFields: [
        modularField('link'),
        modularField('secondary_link'),
      ],
      totalAffectedRecords: 1,
    });
    mocks.buildNestedPathsToRootModels.mockResolvedValue([]);
    mocks.createNewModelFromBlock.mockResolvedValue({
      id: 'new-model',
      api_key: 'target_blocks_conv',
    });
    mocks.migrateBlocksToRecordsNested.mockResolvedValue({});
    mocks.migrateGroupedBlocksToRecords.mockResolvedValue({});
  });

  it('serializes conversions that mutate related fields', async () => {
    let activeConversions = 0;
    let maximumConcurrency = 0;
    const events: string[] = [];

    mocks.convertModularContentToLinksField.mockImplementation(
      async ({ mcField }: { mcField: ModularContentFieldInfo }) => {
        activeConversions++;
        maximumConcurrency = Math.max(maximumConcurrency, activeConversions);
        events.push(`start:${mcField.apiKey}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`end:${mcField.apiKey}`);
        activeConversions--;
      },
    );

    const client = {
      site: {
        find: vi.fn(async () => ({ locales: ['en', 'de-DE'] })),
      },
    } as unknown as CMAClient;

    const result = await convertBlockToModel(
      client,
      'target-block',
      vi.fn(),
    );

    expect(result.success).toBe(true);
    expect(maximumConcurrency).toBe(1);
    expect(events).toEqual([
      'start:link',
      'end:link',
      'start:secondary_link',
      'end:secondary_link',
    ]);
  });

  it('removes the unreferenced model when conversion-wide preflight fails', async () => {
    mocks.buildNestedPathsToRootModels.mockResolvedValue([
      {
        rootModelId: 'root-model',
        rootModelName: 'Root',
        rootModelApiKey: 'roots',
        path: [
          {
            fieldApiKey: 'content',
            expectedBlockTypeId: 'target-block',
            localized: true,
            fieldType: 'rich_text',
          },
        ],
        fieldInfo: modularField('link'),
        isInLocalizedContext: true,
      },
    ]);
    mocks.getGroupedBlockInstances.mockResolvedValue([]);
    mocks.migrateGroupedBlocksToRecords.mockImplementation(
      async (
        _client: unknown,
        _groups: unknown,
        _modelId: unknown,
        _locales: unknown,
        _mapping: unknown,
        _onCount: unknown,
        options: { validateOnly?: boolean },
      ) => {
        if (options.validateOnly) {
          throw new Error('Required alternate text is missing');
        }
        return {};
      },
    );
    const destroy = vi.fn(async () => {});
    const client = {
      site: {
        find: vi.fn(async () => ({ locales: ['en', 'de-DE'] })),
      },
      itemTypes: { destroy },
    } as unknown as CMAClient;

    const result = await convertBlockToModel(
      client,
      'target-block',
      vi.fn(),
    );

    expect(result).toMatchObject({
      success: false,
      error: 'Required alternate text is missing',
    });
    expect(destroy).toHaveBeenCalledWith('new-model');
    expect(
      mocks.convertModularContentToLinksField,
    ).not.toHaveBeenCalled();
  });

  it('validates every path before any path creates records', async () => {
    const path = (rootModelId: string) => ({
      rootModelId,
      rootModelName: rootModelId,
      rootModelApiKey: rootModelId,
      path: [
        {
          fieldApiKey: 'content',
          expectedBlockTypeId: 'target-block',
          localized: true,
          fieldType: 'rich_text' as const,
        },
      ],
      fieldInfo: modularField('link'),
      isInLocalizedContext: true,
    });
    mocks.buildNestedPathsToRootModels.mockResolvedValue([
      path('root-1'),
      path('root-2'),
    ]);
    mocks.getGroupedBlockInstances.mockImplementation(
      async (
        _client: unknown,
        nestedPath: { rootModelId: string },
      ) => [{ rootModelId: nestedPath.rootModelId }],
    );
    const migrationEvents: string[] = [];
    mocks.migrateGroupedBlocksToRecords.mockImplementation(
      async (
        _client: unknown,
        groups: Array<{ rootModelId: string }>,
        _modelId: unknown,
        _locales: unknown,
        _mapping: unknown,
        _onCount: unknown,
        options: {
          validateOnly?: boolean;
          skipValidation?: boolean;
        },
      ) => {
        migrationEvents.push(
          `${options.validateOnly ? 'validate' : 'create'}:${groups[0].rootModelId}`,
        );
        return {};
      },
    );
    const client = {
      site: {
        find: vi.fn(async () => ({ locales: ['en', 'de-DE'] })),
      },
    } as unknown as CMAClient;

    const result = await convertBlockToModel(
      client,
      'target-block',
      vi.fn(),
    );

    expect(result.success).toBe(true);
    expect(migrationEvents).toEqual([
      'validate:root-1',
      'validate:root-2',
      'create:root-1',
      'create:root-2',
    ]);
  });

  it('rolls back records and the model if execution fails before field conversion', async () => {
    mocks.buildNestedPathsToRootModels.mockResolvedValue([
      {
        rootModelId: 'root-model',
        rootModelName: 'Root',
        rootModelApiKey: 'roots',
        path: [
          {
            fieldApiKey: 'content',
            expectedBlockTypeId: 'target-block',
            localized: true,
            fieldType: 'rich_text',
          },
        ],
        fieldInfo: modularField('link'),
        isInLocalizedContext: true,
      },
    ]);
    mocks.getGroupedBlockInstances.mockResolvedValue([]);
    mocks.migrateGroupedBlocksToRecords.mockImplementation(
      async (
        _client: unknown,
        _groups: unknown,
        _modelId: unknown,
        _locales: unknown,
        _mapping: unknown,
        _onCount: unknown,
        options: { validateOnly?: boolean },
      ) => {
        if (options.validateOnly) return {};
        throw new Error('Record creation timed out');
      },
    );
    const destroy = vi.fn(async () => {});
    const client = {
      site: {
        find: vi.fn(async () => ({ locales: ['en', 'de-DE'] })),
      },
      itemTypes: { destroy },
    } as unknown as CMAClient;

    const result = await convertBlockToModel(
      client,
      'target-block',
      vi.fn(),
    );

    expect(result).toMatchObject({
      success: false,
      error: 'Record creation timed out',
      migratedRecordsCount: 0,
    });
    expect(destroy).toHaveBeenCalledWith('new-model');
    expect(
      mocks.convertModularContentToLinksField,
    ).not.toHaveBeenCalled();
  });

  it('rolls back non-destructive field changes before removing the model', async () => {
    const events: string[] = [];
    mocks.convertModularContentToLinksField.mockImplementation(
      async ({
        rollbackActions,
      }: {
        rollbackActions?: ConversionRollbackAction[];
      }) => {
        rollbackActions?.push({
          description: 'first field mutation',
          run: async () => {
            events.push('rollback:first');
          },
        });
        rollbackActions?.push({
          description: 'second field mutation',
          run: async () => {
            events.push('rollback:second');
          },
        });
        throw new Error('PUT /items/page-1: 500');
      },
    );
    const client = {
      site: {
        find: vi.fn(async () => ({ locales: ['en', 'de-DE'] })),
      },
      itemTypes: {
        destroy: vi.fn(async () => {
          events.push('destroy:model');
        }),
      },
    } as unknown as CMAClient;

    const result = await convertBlockToModel(
      client,
      'target-block',
      vi.fn(),
    );

    expect(result).toMatchObject({
      success: false,
      error: 'PUT /items/page-1: 500',
      migratedRecordsCount: 0,
      convertedFieldsCount: 0,
    });
    expect(events).toEqual([
      'rollback:second',
      'rollback:first',
      'destroy:model',
    ]);
  });

  it('does not create a model for an unused block', async () => {
    mocks.analyzeBlock.mockResolvedValue({
      block: {
        id: 'unused-block',
        name: 'Unused block',
        apiKey: 'unused_block',
      },
      fields: [],
      modularContentFields: [],
      totalAffectedRecords: 0,
    });
    const client = {} as CMAClient;

    const result = await convertBlockToModel(
      client,
      'unused-block',
      vi.fn(),
    );

    expect(result).toMatchObject({
      success: false,
      error: 'This block is not used in any modular content fields',
    });
    expect(mocks.createNewModelFromBlock).not.toHaveBeenCalled();
  });
});
