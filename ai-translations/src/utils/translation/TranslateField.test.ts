import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import type { TranslationProvider } from './types';

const mockFieldsList = vi.hoisted(() => vi.fn(async () => [
  { api_key: 'content', appearance: { editor: 'structured_text' }, id: 'field-content', localized: false, validators: {} },
]));

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: vi.fn(() => ({
    fields: {
      list: mockFieldsList,
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
import { fetchBlockFields, translateFieldValue } from './TranslateField';
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
      { isHTML: true },
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
      { isHTML: false },
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
  it('deduplicates concurrent schema reads, isolates project credentials and allows a failed read to retry', async () => {
    await Promise.all(Array.from({ length: 100 }, () => fetchBlockFields('cache-project-one', 'main', 'shared-model')));
    expect(mockFieldsList).toHaveBeenCalledTimes(1);
    await fetchBlockFields('cache-project-two', 'main', 'shared-model');
    expect(mockFieldsList).toHaveBeenCalledTimes(2);
    mockFieldsList.mockRejectedValueOnce(new Error('temporary schema failure'));
    await expect(fetchBlockFields('cache-recovery', 'main', 'retry-model')).rejects.toThrow('temporary schema failure');
    await fetchBlockFields('cache-recovery', 'main', 'retry-model');
    expect(mockFieldsList).toHaveBeenCalledTimes(4);
  });

  it('preserves localized source/other locales, unknown metadata and shallow record references inside blocks', async () => {
    mockFieldsList.mockResolvedValueOnce([
      { api_key: 'title', appearance: { editor: 'single_line' }, id: 'title-field', localized: true, validators: {} },
      { api_key: 'references', appearance: { editor: 'single_line' }, id: 'references-field', localized: false, validators: { items_item_type: { item_types: ['linked-model'] } } },
      { api_key: 'excluded', appearance: { editor: 'single_line' }, id: 'excluded-field', localized: false, validators: {} },
    ]);
    vi.mocked(translateDefaultFieldValue).mockResolvedValue('Título traduzido');
    const source = [{ id: 'source-block', item_type: { type: 'item_type', id: 'content-model' },
      title: { en: 'Source', 'pt-BR': 'Old target', fr: 'Keep French' },
      references: ['record-one', 'record-two'], excluded: 'Do not translate',
      arbitrary_metadata: { id: 'metadata-id', text: 'opaque' },
    }];
    const result = await translateFieldValue(source, { ...pluginParams, apiKeysToBeExcludedFromThisPlugin: ['excluded-field'] }, 'pt-br', 'EN', 'rich_text', provider, '', 'integrity-project', '', 'main') as typeof source;
    expect(result[0].title).toEqual({ en: 'Source', 'pt-BR': 'Título traduzido', fr: 'Keep French' });
    expect(result[0].references).toEqual(source[0].references);
    expect(result[0].arbitrary_metadata).toEqual(source[0].arbitrary_metadata);
    expect(result[0].excluded).toBe('Do not translate');
    expect(result[0].item_type.id).toBe('content-model');
    expect(source[0].id).toBe('source-block');
    expect(source[0].title.en).toBe('Source');
    expect(source[0].title['pt-BR']).toBe('Old target');
    expect(translateDefaultFieldValue).toHaveBeenCalledTimes(1);
  });

  it('rejects cancellation within a block instead of returning partially translated fields', async () => {
    mockFieldsList.mockResolvedValueOnce([
      { api_key: 'first', appearance: { editor: 'single_line' }, id: 'first-field', localized: false, validators: {} },
      { api_key: 'second', appearance: { editor: 'single_line' }, id: 'second-field', localized: false, validators: {} },
    ]);
    const controller = new AbortController();
    vi.mocked(translateDefaultFieldValue).mockImplementation(async () => { controller.abort(); return 'partial'; });
    const source = [{ itemTypeId: 'cancel-model', first: 'one', second: 'two' }];
    await expect(translateFieldValue(source, pluginParams, 'it', 'en', 'rich_text', provider, '', 'cancel-project', '', 'main', { abortSignal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(translateDefaultFieldValue).toHaveBeenCalledTimes(1);
    expect(source[0].first).toBe('one');
  });

  it('keeps nested branching blocks at one provider call in flight and resolves simplified CMA items', async () => {
    mockFieldsList.mockImplementation(async () => [
      { api_key: 'label', appearance: { editor: 'single_line' }, id: 'label-field', localized: false, validators: {} },
      { api_key: 'children_blocks', appearance: { editor: 'rich_text' }, id: 'children-field', localized: false, validators: {} },
    ]);
    let active = 0;
    let peak = 0;
    vi.mocked(translateDefaultFieldValue).mockImplementation(async (value) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return `Translated ${value}`;
    });
    const createBlock = (depth: number): Record<string, unknown> => ({
      id: `block-${depth}`, item_type: { type: 'item_type', id: 'branch-model' },
      label: `level-${depth}`, children_blocks: depth === 0 ? [] : Array.from({ length: 3 }, () => createBlock(depth - 1)),
    });
    const source = [{ type: 'inlineBlock', item: createBlock(5) }];
    const result = await translateFieldValue(source, pluginParams, 'it', 'en', 'rich_text', provider, '', 'branch-project', '', 'main') as Array<{ item: Record<string, unknown> }>;
    expect(peak).toBe(1);
    expect(translateDefaultFieldValue).toHaveBeenCalledTimes(364);
    expect(mockFieldsList).toHaveBeenCalledTimes(1);
    expect(result[0].item.label).toBe('Translated level-5');
    expect(result[0].item.id).toBeUndefined();
    expect(source[0].item.id).toBe('block-5');
  });

  it('keeps nested localized block and Structured Text source trees independent from the translated target', async () => {
    mockFieldsList.mockResolvedValueOnce([
      { api_key: 'body', appearance: { editor: 'rich_text' }, id: 'body-field', localized: true, validators: {} },
      { api_key: 'document', appearance: { editor: 'structured_text' }, id: 'document-field', localized: true, validators: {} },
    ]);
    mockFieldsList.mockResolvedValueOnce([
      { api_key: 'heading', appearance: { editor: 'single_line' }, id: 'heading-field', localized: false, validators: {} },
    ]);
    vi.mocked(translateDefaultFieldValue).mockResolvedValue('Titolo tradotto');
    vi.mocked(translateArray).mockResolvedValue(['Testo tradotto']);
    const source = [{ itemTypeId: 'localized-outer',
      body: { en: [{ itemId: 'nested-source-id', itemTypeId: 'localized-inner', heading: 'Source heading' }], it: [], de: [{ itemId: 'german-id', itemTypeId: 'localized-inner', heading: 'Deutsch' }] },
      document: { en: [{ type: 'paragraph', id: 'paragraph-source-id', children: [{ text: 'Source text' }] }], it: [], de: [{ type: 'paragraph', children: [{ text: 'Deutsch' }] }] },
    }];
    const original = structuredClone(source);
    const result = await translateFieldValue(source, pluginParams, 'it', 'en', 'rich_text', provider, '', 'nested-localized-project', '', 'main') as typeof source;
    expect(result[0].body.en).toEqual(original[0].body.en);
    expect(result[0].body.de).toEqual(original[0].body.de);
    expect(result[0].body.it[0]).toMatchObject({ heading: 'Titolo tradotto' });
    expect(result[0].body.it[0]).not.toHaveProperty('itemId');
    expect(result[0].document.en).toEqual(original[0].document.en);
    expect(result[0].document.de).toEqual(original[0].document.de);
    expect(result[0].document.it[0]).toMatchObject({ children: [{ text: 'Testo tradotto' }] });
    expect(source).toEqual(original);
  });

});
