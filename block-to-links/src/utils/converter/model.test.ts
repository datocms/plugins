import { describe, expect, it, vi } from 'vitest';
import type { BlockAnalysis, CMAClient } from '../../types';
import { createNewModelFromBlock } from './model';

describe('converted model creation', () => {
  it('removes an incomplete unreferenced model when field copying fails', async () => {
    const destroy = vi.fn(async () => {});
    const client = {
      itemTypes: {
        list: vi.fn(async () => []),
        create: vi.fn(async () => ({
          id: 'new-model',
          api_key: 'target_blocks_conv',
        })),
        update: vi.fn(),
        destroy,
      },
      fields: {
        create: vi.fn(async () => {
          throw new Error('Field creation failed');
        }),
      },
    } as unknown as CMAClient;
    const analysis: BlockAnalysis = {
      block: {
        id: 'target-block',
        name: 'Target block',
        apiKey: 'target_block',
      },
      fields: [
        {
          id: 'title-field',
          label: 'Title',
          apiKey: 'title',
          fieldType: 'string',
          localized: false,
          validators: {},
          appearance: {
            editor: 'single_line',
            parameters: {},
            addons: [],
          },
          position: 1,
        },
      ],
      modularContentFields: [],
      totalAffectedRecords: 0,
    };

    await expect(
      createNewModelFromBlock(client, analysis),
    ).rejects.toThrow('Field creation failed');
    expect(destroy).toHaveBeenCalledWith('new-model');
  });
});
