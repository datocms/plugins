import { describe, expect, it } from 'vitest';
import type { RawItemType } from '../types';
import { getRegularModels } from './models';

function itemType(
  id: string,
  name: string,
  modularBlock: boolean,
  workflowId: string | null = null,
): RawItemType {
  return {
    id,
    attributes: {
      name,
      api_key: name.toLowerCase(),
      modular_block: modularBlock,
      draft_mode_active: true,
    },
    relationships: {
      workflow: {
        data: workflowId ? { id: workflowId, type: 'workflow' } : null,
      },
    },
  } as unknown as RawItemType;
}

describe('getRegularModels', () => {
  it('excludes block models and returns sorted summaries', () => {
    const result = getRegularModels([
      itemType('z', 'Zebra', false, 'workflow-1'),
      itemType('b', 'Block', true),
      itemType('a', 'article', false),
    ]);

    expect(result).toEqual([
      {
        id: 'a',
        name: 'article',
        apiKey: 'article',
        draftModeActive: true,
        workflowId: null,
      },
      {
        id: 'z',
        name: 'Zebra',
        apiKey: 'zebra',
        draftModeActive: true,
        workflowId: 'workflow-1',
      },
    ]);
  });
});
