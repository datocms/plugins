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

import { translateDefaultFieldValue } from './DefaultTranslation';
import { translateFieldValue } from './TranslateField';
import { translateArray } from './translateArray';

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
        'Block field source payload',
        'Block field translated payload',
        'Block translation completed',
      ]),
    );
    const sourcePayload = payloads.find(
      (payload) => payload.message === 'Block field source payload',
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
