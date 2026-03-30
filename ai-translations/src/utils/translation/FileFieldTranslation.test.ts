/**
 * Tests for FileFieldTranslation.ts
 * Covers translation of alt/title and metadata for file and gallery fields.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { translateFileFieldValue } from './FileFieldTranslation';
import type { TranslationProvider } from './types';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';

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

  it('translates top-level alt/title and metadata strings', async () => {
    vi.mocked(translateArray).mockResolvedValue(['Alt IT', 'Title IT', 'Meta IT']);

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
      mockProvider
    );

    expect(translateArray).toHaveBeenCalledWith(
      mockProvider,
      mockPluginParams,
      ['Alt EN', 'Title EN', 'Meta EN'],
      'en',
      'it',
      { isHTML: false, recordContext: '' }
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
    vi.mocked(translateArray).mockResolvedValue(['Alt IT', 'Title IT', 'Meta IT']);

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
      mockProvider
    );

    expect(translateArray).toHaveBeenCalledWith(
      mockProvider,
      mockPluginParams,
      ['Alt EN', 'Title EN', 'Meta EN'],
      'en',
      'it',
      { isHTML: false, recordContext: '' }
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
    vi.mocked(translateArray).mockResolvedValue(['Alt IT', 'Title IT', 'Meta IT']);

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
      mockProvider
    );

    expect(translateArray).toHaveBeenCalledWith(
      mockProvider,
      mockPluginParams,
      ['Alt EN', 'Title EN', 'Meta EN'],
      'en',
      'it',
      { isHTML: false, recordContext: '' }
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
    vi.mocked(translateArray).mockResolvedValue(['Alt IT', 'Title IT', 'Meta IT']);
    mockUploadsFind.mockResolvedValue({
      default_field_metadata: {
        en: {
          alt: 'Alt EN default',
          title: 'Title EN default',
        },
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
      'main'
    );

    expect(mockUploadsFind).toHaveBeenCalledWith('upl_123');
    expect(translateArray).toHaveBeenCalledWith(
      mockProvider,
      mockPluginParams,
      ['Alt EN default', 'Title EN default', 'Meta EN'],
      'en',
      'it',
      { isHTML: false, recordContext: '' }
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
});
