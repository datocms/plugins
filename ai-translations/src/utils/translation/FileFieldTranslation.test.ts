/**
 * Tests for FileFieldTranslation.ts
 * Covers translation of alt/title and metadata for file and gallery fields.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import {
  readUploadDefaultAltTitle,
  translateFileFieldValue,
} from './FileFieldTranslation';
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
      { isHTML: false, recordContext: '', qcAtomicSegments: true },
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
      { isHTML: false, recordContext: '', qcAtomicSegments: true },
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
      { isHTML: false, recordContext: '', qcAtomicSegments: true },
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

  it('retries the upload lookup after a transient failure (does not cache the error)', async () => {
    vi.mocked(translateArray).mockImplementation(
      async (_provider, _params, values) =>
        (values as string[]).map((v) => `${v} IT`),
    );

    // A distinct upload id so the module-level cache can't collide with the
    // sibling enrichment test.
    const fileValue = { upload_id: 'upl_evict', metadata: { custom: 'Meta EN' } };

    // First lookup fails transiently: enrichment is skipped and the failure
    // must NOT be cached.
    mockUploadsFind.mockRejectedValueOnce(new Error('429 Too Many Requests'));
    await translateFileFieldValue(
      fileValue,
      mockPluginParams,
      'it',
      'en',
      mockProvider,
      'token-123',
      'main',
    );
    expect(mockUploadsFind).toHaveBeenCalledTimes(1);

    // The metadata becomes retrievable moments later; a subsequent record must
    // refetch it rather than read a cached `undefined` from the failed attempt.
    mockUploadsFind.mockResolvedValueOnce({
      default_field_metadata: {
        en: { alt: 'Alt default', title: 'Title default' },
      },
    });
    const result = (await translateFileFieldValue(
      fileValue,
      mockPluginParams,
      'it',
      'en',
      mockProvider,
      'token-123',
      'main',
    )) as Record<string, unknown>;

    expect(mockUploadsFind).toHaveBeenCalledTimes(2);
    expect(result.alt).toBe('Alt default IT');
    expect(result.title).toBe('Title default IT');
  });

  it('falls back to upload default metadata when alt/title are missing', async () => {
    vi.mocked(translateArray).mockResolvedValue([
      'Alt IT',
      'Title IT',
      'Meta IT',
    ]);
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
      'main',
    );

    expect(mockUploadsFind).toHaveBeenCalledWith('upl_123');
    expect(translateArray).toHaveBeenCalledWith(
      mockProvider,
      mockPluginParams,
      ['Alt EN default', 'Title EN default', 'Meta EN'],
      'en',
      'it',
      { isHTML: false, recordContext: '', qcAtomicSegments: true },
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

  it('reads upload default metadata in the new field-first shape (non-localized focal points)', async () => {
    // The "non-localized focal points" update (opt-in; default for projects
    // created after 2026-06-11) reshaped default_field_metadata from LOCALE-first
    // ({ en: { alt, title, focal_point } }) to FIELD-first
    // ({ alt: { en, it }, title: { en, it }, focal_point: { x, y } }), pulling the
    // single focal point out of the per-locale blocks. Both shapes exist in live
    // projects, so enrichment must read either. See:
    // https://www.datocms.com/product-updates/non-localized-focal-points
    vi.mocked(translateArray).mockResolvedValue([
      'Alt IT',
      'Title IT',
      'Meta IT',
    ]);
    mockUploadsFind.mockResolvedValue({
      default_field_metadata: {
        alt: { en: 'Alt EN default', it: '' },
        title: { en: 'Title EN default', it: '' },
        custom_data: { en: {}, it: {} },
        focal_point: { x: 0.1, y: 0.2 },
      },
    });

    // Fresh upload id so the module-level metadata cache can't collide with the
    // locale-first fallback test above.
    const fileValue = {
      upload_id: 'upl_fieldfirst',
      metadata: { custom: 'Meta EN' },
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

    expect(translateArray).toHaveBeenCalledWith(
      mockProvider,
      mockPluginParams,
      ['Alt EN default', 'Title EN default', 'Meta EN'],
      'en',
      'it',
      { isHTML: false, recordContext: '', qcAtomicSegments: true },
    );

    expect(result).toEqual({
      ...fileValue,
      alt: 'Alt IT',
      title: 'Title IT',
      metadata: { custom: 'Meta IT' },
    });
  });
});

describe('readUploadDefaultAltTitle', () => {
  it('reads the legacy locale-first shape', () => {
    expect(
      readUploadDefaultAltTitle(
        { en: { alt: 'Alt EN', title: 'Title EN' }, it: { alt: 'Alt IT' } },
        'en',
      ),
    ).toEqual({ alt: 'Alt EN', title: 'Title EN' });
  });

  it('reads the field-first shape (non-localized focal points)', () => {
    expect(
      readUploadDefaultAltTitle(
        {
          alt: { en: 'Alt EN', it: 'Alt IT' },
          title: { en: 'Title EN', it: 'Title IT' },
          focal_point: { x: 0.1, y: 0.2 },
        },
        'en',
      ),
    ).toEqual({ alt: 'Alt EN', title: 'Title EN' });
  });

  it('treats blank/missing values as undefined in both shapes', () => {
    expect(
      readUploadDefaultAltTitle({ en: { alt: '   ', title: undefined } }, 'en'),
    ).toEqual({ alt: undefined, title: undefined });
    expect(
      readUploadDefaultAltTitle({ alt: { en: '' }, title: {} }, 'en'),
    ).toEqual({ alt: undefined, title: undefined });
  });

  it('returns undefined when the source locale is absent in either shape', () => {
    expect(
      readUploadDefaultAltTitle({ it: { alt: 'Alt IT' } }, 'en'),
    ).toEqual({ alt: undefined, title: undefined });
    expect(
      readUploadDefaultAltTitle({ alt: { it: 'Alt IT' } }, 'en'),
    ).toEqual({ alt: undefined, title: undefined });
  });
});
