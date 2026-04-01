import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import type { TranslationProvider } from './types';

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: vi.fn(() => ({
    fields: {
      list: vi.fn(async () => [
        {
          api_key: 'content',
          appearance: { editor: 'structured_text' },
          id: 'field-content',
          localized: false,
          validators: {},
        },
      ]),
    },
  })),
}));

vi.mock('./DefaultTranslation', () => ({
  translateDefaultFieldValue: vi.fn(),
}));

vi.mock('./translateArray', () => ({
  translateArray: vi.fn(),
}));

import { translateDefaultFieldValue } from './DefaultTranslation';
import { translateFieldValue } from './TranslateField';
import { translateArray } from './translateArray';

describe('TranslateField', () => {
  const pluginParams: ctxParamsType = {
    apiKey: 'test-key',
    gptModel: 'gpt-4',
    translationFields: ['single_line', 'slug', 'structured_text', 'rich_text'],
    translateWholeRecord: true,
    translateBulkRecords: true,
    prompt: '',
    modelsToBeExcludedFromThisPlugin: [],
    rolesToBeExcludedFromThisPlugin: [],
    apiKeysToBeExcludedFromThisPlugin: [],
    enableDebugging: false,
  };

  const provider: TranslationProvider = {
    vendor: 'openai',
    streamText: vi.fn(),
    completeText: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes translated slug values deterministically', async () => {
    vi.mocked(translateDefaultFieldValue).mockResolvedValue('Caffè & tè!');

    await expect(
      translateFieldValue(
        'Cos’è il cloud',
        pluginParams,
        'en',
        'it',
        'slug',
        provider,
        '',
        'api-token',
        'field-slug',
        'main',
      ),
    ).resolves.toBe('caffe-te');
  });

  it('throws when slug normalization produces an empty string', async () => {
    vi.mocked(translateDefaultFieldValue).mockResolvedValue('!!!');

    await expect(
      translateFieldValue(
        '!!!',
        pluginParams,
        'en',
        'it',
        'slug',
        provider,
        '',
        'api-token',
        'field-slug',
        'main',
      ),
    ).rejects.toThrow('Translated slug is empty after normalization');
  });

  it('removes only wrapper ids from block payloads while preserving nested metadata ids', async () => {
    vi.mocked(translateArray).mockResolvedValue(['Clicca qui']);

    const result = (await translateFieldValue(
      [
        {
          id: 'wrapper-id',
          blockModelId: 'block-model-1',
          content: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'link',
                  meta: [{ id: 'target', value: '_blank' }],
                  children: [{ type: 'span', value: 'Click here' }],
                },
              ],
            },
          ],
        },
      ],
      pluginParams,
      'it',
      'en',
      'rich_text',
      provider,
      '',
      'api-token',
      'field-rich',
      'main',
    )) as Array<{
      id?: string;
      content: Array<{
        children: Array<{
          meta: Array<{ id: string; value: string }>;
          children: Array<{ value: string }>;
        }>;
      }>;
    }>;

    expect(result[0].id).toBeUndefined();
    expect(result[0].content[0].children[0].meta[0]).toEqual({
      id: 'target',
      value: '_blank',
    });
    expect(result[0].content[0].children[0].children[0].value).toBe(
      'Clicca qui',
    );
  });
});
