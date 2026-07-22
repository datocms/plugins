import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { buildClient } from '@datocms/cma-client-browser';
import { translateDefaultFieldValue } from './DefaultTranslation';
import { translateFieldValue } from './TranslateField';
import { translateArray } from './translateArray';

/**
 * Recursively collects every `id`/`itemId` key found at any depth of a value,
 * so a test can assert a rebuilt block payload leaks zero block identifiers.
 */
function collectIdentifierKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectIdentifierKeys);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, entry]) =>
        key === 'id' || key === 'itemId'
          ? [key, ...collectIdentifierKeys(entry)]
          : collectIdentifierKeys(entry),
    );
  }
  return [];
}

type LogPayload = {
  message: string;
  data?: unknown;
};

function parseLogPayloads(calls: unknown[][]): LogPayload[] {
  return calls.map((call) => JSON.parse(String(call[0])) as LogPayload);
}

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

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('logs source and translated field payloads when debugging is enabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(translateDefaultFieldValue).mockResolvedValue('Bonjour');

    const result = await translateFieldValue(
      'Hello',
      { ...pluginParams, enableDebugging: true },
      'fr',
      'en',
      'single_line',
      provider,
      '',
      'api-token',
      'field-title',
      'main',
      undefined,
      'Record title',
      undefined,
      { fieldApiKey: 'title' },
    );

    expect(result).toBe('Bonjour');
    const payloads = parseLogPayloads(logSpy.mock.calls);
    const messages = payloads.map((payload) => payload.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Source field payload',
        'Translated field payload',
      ]),
    );
    const sourcePayload = payloads.find(
      (payload) => payload.message === 'Source field payload',
    );
    const sourceData = sourcePayload?.data as {
      fieldId: string;
      fieldApiKey: string;
      value: string;
    };
    expect(sourceData.fieldId).toBe('field-title');
    expect(sourceData.fieldApiKey).toBe('title');
    expect(sourceData.value).toBe('Hello');

    const translatedPayload = payloads.find(
      (payload) => payload.message === 'Translated field payload',
    );
    const translatedData = translatedPayload?.data as { value: string };
    expect(translatedData.value).toBe('Bonjour');
  });

  it('enables HTML mode for WYSIWYG fields', async () => {
    const params = {
      ...pluginParams,
      translationFields: [...pluginParams.translationFields, 'wysiwyg'],
    };
    vi.mocked(translateDefaultFieldValue).mockResolvedValue('<p>Bonjour</p>');

    await translateFieldValue(
      '<p>Hello</p>',
      params,
      'fr',
      'en',
      'wysiwyg',
      provider,
      '',
      'api-token',
      'field-body',
      'main',
      undefined,
      'Record content',
      undefined,
      { fieldApiKey: 'body' },
    );

    expect(translateDefaultFieldValue).toHaveBeenCalledWith(
      '<p>Hello</p>',
      params,
      'fr',
      'en',
      provider,
      undefined,
      'Record content',
      { isHTML: true, kind: 'html', onQcFlag: undefined },
    );
  });

  it('keeps text fields out of HTML mode', async () => {
    vi.mocked(translateDefaultFieldValue).mockResolvedValue('Bonjour');

    await translateFieldValue(
      'Hello',
      pluginParams,
      'fr',
      'en',
      'single_line',
      provider,
      '',
      'api-token',
      'field-title',
      'main',
      undefined,
      'Record title',
      undefined,
      { fieldApiKey: 'title' },
    );

    expect(translateDefaultFieldValue).toHaveBeenCalledWith(
      'Hello',
      pluginParams,
      'fr',
      'en',
      provider,
      undefined,
      'Record title',
      { isHTML: false, kind: 'text', onQcFlag: undefined },
    );
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
    ).rejects.toThrow('translation produced an empty slug');
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

  it('skips a top-level field that is excluded (returns the source untouched)', async () => {
    vi.mocked(translateDefaultFieldValue).mockResolvedValue('SHOULD NOT APPEAR');

    const result = await translateFieldValue(
      'Hello',
      { ...pluginParams, apiKeysToBeExcludedFromThisPlugin: ['field-subtitle'] },
      'it',
      'en',
      'single_line',
      provider,
      '',
      'api-token',
      'field-subtitle',
      'main',
    );

    expect(result).toBe('Hello');
    expect(translateDefaultFieldValue).not.toHaveBeenCalled();
  });

  it('empties a nested block field excluded by field id (rev-7: exclude means null)', async () => {
    // The customer case: exclude a field that lives INSIDE a block. Rev-7 (§4.3)
    // rebuilds blocks fresh from the source and leaves excluded sub-fields empty
    // — the rebuilt block carries null, never the source value, and the provider
    // is never called.
    vi.mocked(translateArray).mockResolvedValue(['Clicca qui']);

    const result = (await translateFieldValue(
      [
        {
          id: 'wrapper-id',
          blockModelId: 'block-model-1',
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'span', value: 'Click here' }],
            },
          ],
        },
      ],
      { ...pluginParams, apiKeysToBeExcludedFromThisPlugin: ['field-content'] },
      'it',
      'en',
      'rich_text',
      provider,
      '',
      'api-token',
      'field-rich',
      'main',
    )) as Array<{ content: unknown }>;

    expect(translateArray).not.toHaveBeenCalled();
    expect(result[0].content).toBeNull();
  });

  it('empties a nested block field excluded by api_key (rev-7: exclude means null)', async () => {
    vi.mocked(translateArray).mockResolvedValue(['Clicca qui']);

    const result = (await translateFieldValue(
      [
        {
          id: 'wrapper-id',
          blockModelId: 'block-model-1',
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'span', value: 'Click here' }],
            },
          ],
        },
      ],
      { ...pluginParams, apiKeysToBeExcludedFromThisPlugin: ['content'] },
      'it',
      'en',
      'rich_text',
      provider,
      '',
      'api-token',
      'field-rich',
      'main',
    )) as Array<{ content: unknown }>;

    expect(translateArray).not.toHaveBeenCalled();
    expect(result[0].content).toBeNull();
  });

  it('copies a nested block sub-field verbatim when its fate is copy-from-source', async () => {
    // §4.2/§4.3: a copy-from-source sub-field is written with the source value
    // verbatim — the provider is never invoked for it.
    vi.mocked(translateArray).mockResolvedValue(['SHOULD NOT APPEAR']);

    const sourceContent = [
      {
        type: 'paragraph',
        children: [{ type: 'span', value: 'Brand X' }],
      },
    ];

    const result = (await translateFieldValue(
      [
        {
          id: 'wrapper-id',
          blockModelId: 'block-model-1',
          content: sourceContent,
        },
      ],
      { ...pluginParams, fieldsToCopyFromSource: ['content'] },
      'it',
      'en',
      'rich_text',
      provider,
      '',
      'api-token',
      'field-rich',
      'main',
    )) as Array<{ content: unknown }>;

    expect(translateArray).not.toHaveBeenCalled();
    expect(result[0].content).toEqual(sourceContent);
  });

  it('strips block ids recursively from a copy-fate modular-content sub-field', async () => {
    // §4.3: rebuilt blocks are always fresh instances — a copied modular-content
    // value must leak zero block identifiers at any nesting depth.
    const nestedModularContent = [
      {
        id: 'block-1',
        itemId: 'item-1',
        blockModelId: 'nested-model',
        heading: 'A',
        children: [
          {
            id: 'block-2',
            itemId: 'item-2',
            blockModelId: 'deeper-model',
            heading: 'B',
          },
        ],
      },
    ];

    const result = (await translateFieldValue(
      [
        {
          id: 'wrapper-id',
          blockModelId: 'block-model-1',
          content: nestedModularContent,
        },
      ],
      { ...pluginParams, fieldsToCopyFromSource: ['content'] },
      'it',
      'en',
      'rich_text',
      provider,
      '',
      'api-token',
      'field-rich',
      'main',
    )) as Array<{ content: unknown }>;

    expect(collectIdentifierKeys(result[0].content)).toEqual([]);
  });

  it('resolves sub-field fate before editor routing (excluded frameless → null)', async () => {
    // A frameless_single_block sub-field with fate exclude must resolve to null
    // like any other field — the fate check runs before frameless routing.
    vi.mocked(buildClient).mockReturnValueOnce({
      fields: {
        list: vi.fn(async () => [
          {
            api_key: 'hero',
            appearance: { editor: 'frameless_single_block' },
            id: 'field-hero',
            localized: false,
            validators: {
              single_block_blocks: { item_types: ['nested-model'] },
            },
          },
        ]),
      },
    } as never);

    const result = (await translateFieldValue(
      [
        {
          id: 'wrapper-id',
          blockModelId: 'frameless-block-model',
          hero: {
            id: 'nested-id',
            blockModelId: 'nested-model',
            heading: 'Hi',
          },
        },
      ],
      { ...pluginParams, apiKeysToBeExcludedFromThisPlugin: ['hero'] },
      'it',
      'en',
      'rich_text',
      provider,
      '',
      'api-token',
      'field-rich',
      'main',
    )) as Array<{ hero: unknown }>;

    expect(result[0].hero).toBeNull();
  });

  it('throws naming the block model and api_key for a sub-field missing from the schema', async () => {
    await expect(
      translateFieldValue(
        [
          {
            id: 'wrapper-id',
            blockModelId: 'block-model-1',
            mystery: 'x',
            content: [
              {
                type: 'paragraph',
                children: [{ type: 'span', value: 'Hi' }],
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
      ),
    ).rejects.toThrow(/mystery[\s\S]*block-model-1/);
  });

  it('still translates a translate-fate nested sub-field (regression guard)', async () => {
    vi.mocked(translateArray).mockResolvedValue(['Ciao']);

    const result = (await translateFieldValue(
      [
        {
          id: 'wrapper-id',
          blockModelId: 'block-model-1',
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'span', value: 'Hello' }],
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
    )) as Array<{ content: Array<{ children: Array<{ value: string }> }> }>;

    expect(translateArray).toHaveBeenCalled();
    expect(result[0].content[0].children[0].value).toBe('Ciao');
  });

  it('logs block payloads and per-field diagnostics when debugging is enabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(translateArray).mockResolvedValue(['Clicca qui']);

    await translateFieldValue(
      [
        {
          id: 'wrapper-id',
          blockModelId: 'block-model-1',
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'span', value: 'Click here' }],
            },
          ],
        },
      ],
      { ...pluginParams, enableDebugging: true },
      'it',
      'en',
      'rich_text',
      provider,
      '',
      'api-token',
      'field-rich',
      'main',
    );

    const payloads = parseLogPayloads(logSpy.mock.calls);
    const messages = payloads.map((payload) => payload.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Block payload before processing',
        'Block field translation input',
        'Block field translated payload',
        'Block translation completed',
      ]),
    );
    const sourcePayload = payloads.find(
      (payload) => payload.message === 'Block field translation input',
    );
    const sourceData = sourcePayload?.data as {
      fieldKey: string;
      editor: string;
      value: unknown;
    };
    expect(sourceData.fieldKey).toBe('content');
    expect(sourceData.editor).toBe('structured_text');
    expect(sourceData.value).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'span', value: 'Click here' }],
      },
    ]);
  });
});
