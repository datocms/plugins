/**
 * Tests for FileFieldTranslation.ts
 * Covers translation of alt/title and metadata for file and gallery fields.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { translateFileFieldValue } from './FileFieldTranslation';
import type { TranslationProvider } from './types';

vi.mock('./translateArray', () => ({
  translateArray: vi.fn(),
}));

const mockUploadsFind = vi.hoisted(() => vi.fn());

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: vi.fn(() => ({
    uploads: {
      find: mockUploadsFind,
    },
  })),
}));

import { translateArray } from './translateArray';

describe('FileFieldTranslation', () => {
  const mockPluginParams: ctxParamsType = {
    apiKey: 'test-key',
    gptModel: 'gpt-4',
    translationFields: [],
    translateWholeRecord: false,
    translateBulkRecords: false,
    prompt: '',
    modelsToBeExcludedFromThisPlugin: [],
    rolesToBeExcludedFromThisPlugin: [],
    apiKeysToBeExcludedFromThisPlugin: [],
    enableDebugging: false,
  };

  let mockProvider: TranslationProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadsFind.mockReset();
    mockProvider = {
      vendor: 'openai',
      streamText: vi.fn(),
      completeText: vi.fn(),
    };
  });

  it('forwards file-metadata cancellation and preserves the abort error', async () => {
    const controller = new AbortController();
    const checkCancellation = vi.fn(() => false);
    const error = new DOMException('Cancelled', 'AbortError');
    vi.mocked(translateArray).mockRejectedValue(error);

    await expect(
      translateFileFieldValue(
        { alt: 'Alt', title: 'Title' },
        mockPluginParams,
        'it',
        'en',
        mockProvider,
        undefined,
        undefined,
        { abortSignal: controller.signal, checkCancellation },
      ),
    ).rejects.toBe(error);
    expect(translateArray).toHaveBeenCalledWith(
      mockProvider,
      mockPluginParams,
      ['Alt', 'Title'],
      'en',
      'it',
      expect.objectContaining({
        abortSignal: controller.signal,
        checkCancellation,
      }),
    );
  });

  it('translates top-level alt/title and metadata strings', async () => {
    vi.mocked(translateArray).mockResolvedValue([
      'Alt IT',
      'Title IT',
      'Meta IT',
    ]);

    const fileValue = {
      alt: 'Alt EN',
      title: 'Title EN',
      url: 'https://example.com/img.jpg',
      metadata: {
        custom: 'Meta EN',
        width: 1200,
      },
    };

    const result = await translateFileFieldValue(
      fileValue,
      mockPluginParams,
      'it',
      'en',
      mockProvider,
    );

    expect(translateArray).toHaveBeenCalledWith(
      mockProvider,
      mockPluginParams,
      ['Alt EN', 'Title EN', 'Meta EN'],
      'en',
      'it',
      { isHTML: false, recordContext: '' },
    );

    expect(result).toEqual({
      ...fileValue,
      alt: 'Alt IT',
      title: 'Title IT',
      metadata: {
        custom: 'Meta IT',
        width: 1200,
      },
    });
  });

  it('fills top-level alt/title from metadata when only metadata has them', async () => {
    vi.mocked(translateArray).mockResolvedValue([
      'Alt IT',
      'Title IT',
      'Meta IT',
    ]);

    const fileValue = {
      metadata: {
        alt: 'Alt EN',
        title: 'Title EN',
        custom: 'Meta EN',
      },
    };

    const result = await translateFileFieldValue(
      fileValue,
      mockPluginParams,
      'it',
      'en',
      mockProvider,
    );

    expect(translateArray).toHaveBeenCalledWith(
      mockProvider,
      mockPluginParams,
      ['Alt EN', 'Title EN', 'Meta EN'],
      'en',
      'it',
      { isHTML: false, recordContext: '' },
    );

    expect(result).toEqual({
      ...fileValue,
      alt: 'Alt IT',
      title: 'Title IT',
      metadata: {
        alt: 'Alt IT',
        title: 'Title IT',
        custom: 'Meta IT',
      },
    });
  });

  it('does not translate alt/title twice when present in both file and metadata', async () => {
    vi.mocked(translateArray).mockResolvedValue([
      'Alt IT',
      'Title IT',
      'Meta IT',
    ]);

    const fileValue = {
      alt: 'Alt EN',
      title: 'Title EN',
      metadata: {
        alt: 'Alt EN',
        title: 'Title EN',
        custom: 'Meta EN',
      },
    };

    const result = await translateFileFieldValue(
      fileValue,
      mockPluginParams,
      'it',
      'en',
      mockProvider,
    );

    expect(translateArray).toHaveBeenCalledWith(
      mockProvider,
      mockPluginParams,
      ['Alt EN', 'Title EN', 'Meta EN'],
      'en',
      'it',
      { isHTML: false, recordContext: '' },
    );

    expect(result).toEqual({
      ...fileValue,
      alt: 'Alt IT',
      title: 'Title IT',
      metadata: {
        alt: 'Alt IT',
        title: 'Title IT',
        custom: 'Meta IT',
      },
    });
  });

  it('falls back to upload default metadata when alt/title are missing', async () => {
    vi.mocked(translateArray).mockResolvedValue([
      'Alt IT',
      'Title IT',
      'Meta IT',
    ]);
    mockUploadsFind.mockResolvedValue({
      default_field_metadata: {
        alt: { en: 'Alt EN default' },
        title: { en: 'Title EN default' },
      },
    });

    const fileValue = {
      upload_id: 'upl_123',
      metadata: {
        custom: 'Meta EN',
      },
    };

    const result = await translateFileFieldValue(
      fileValue,
      mockPluginParams,
      'it',
      'en',
      mockProvider,
      'token-123',
      'main',
    );

    expect(mockUploadsFind).toHaveBeenCalledWith('upl_123');
    expect(translateArray).toHaveBeenCalledWith(
      mockProvider,
      mockPluginParams,
      ['Alt EN default', 'Title EN default', 'Meta EN'],
      'en',
      'it',
      { isHTML: false, recordContext: '' },
    );

    expect(result).toEqual({
      ...fileValue,
      alt: 'Alt IT',
      title: 'Title IT',
      metadata: {
        custom: 'Meta IT',
      },
    });
  });
  it('rejects cancellation between gallery entries without returning partial success', async () => {
    const controller = new AbortController();
    vi.mocked(translateArray).mockImplementation(async () => {
      controller.abort();
      return ['IT alt', 'IT title'];
    });
    const gallery = [{ alt: 'alt', title: 'title' }, { alt: 'other', title: 'other' }];
    await expect(translateFileFieldValue(
      gallery, mockPluginParams, 'it', 'en', mockProvider, undefined, undefined,
      { abortSignal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(translateArray).toHaveBeenCalledTimes(1);
    expect(gallery[0].alt).toBe('alt');
  });

  it('isolates upload defaults by credentials and evicts old asset metadata', async () => {
    mockUploadsFind.mockResolvedValue({ default_field_metadata: { alt: { en: 'Default alt' }, title: { en: 'Default title' } } });
    vi.mocked(translateArray).mockResolvedValue(['IT alt', 'IT title']);
    const translate = (id: string, token: string) => translateFileFieldValue(
      { upload_id: id }, mockPluginParams, 'it', 'en', mockProvider, token, 'cache-test-environment',
    );
    await translate('shared-upload', 'project-one');
    await translate('shared-upload', 'project-two');
    expect(mockUploadsFind).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 257; index++) {
      // biome-ignore lint/performance/noAwaitInLoops: populate the bounded cache deterministically.
      await translate(`bounded-${index}`, 'bounded-project');
    }
    const count = mockUploadsFind.mock.calls.length;
    await translate('bounded-0', 'bounded-project');
    expect(mockUploadsFind).toHaveBeenCalledTimes(count + 1);
  });

  it('retries failed upload-default reads instead of caching the failure permanently', async () => {
    mockUploadsFind.mockRejectedValueOnce(new Error('temporary CMA failure'));
    mockUploadsFind.mockResolvedValueOnce({ default_field_metadata: { alt: { en: 'Alt' }, title: { en: 'Title' } } });
    vi.mocked(translateArray).mockResolvedValue(['IT Alt', 'IT Title']);
    const source = { upload_id: 'failed-cache-case' };
    await translateFileFieldValue(source, mockPluginParams, 'it', 'en', mockProvider, 'failure-token', 'main');
    const result = await translateFileFieldValue(source, mockPluginParams, 'it', 'en', mockProvider, 'failure-token', 'main');
    expect(mockUploadsFind).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ...source, alt: 'IT Alt', title: 'IT Title' });
  });

});
