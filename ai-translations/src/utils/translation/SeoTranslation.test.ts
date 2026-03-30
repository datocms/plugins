/**
 * Tests for SeoTranslation.ts
 * Tests translation of SEO field objects (title and description).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { translateSeoFieldValue, type SeoObject } from './SeoTranslation';
import type { TranslationProvider } from './types';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';

// Mock translateArray
vi.mock('./translateArray', () => ({
  translateArray: vi.fn(),
}));

import { translateArray } from './translateArray';

describe('SeoTranslation', () => {
  const mockPluginParams: ctxParamsType = {
    apiKey: 'test-key',
    gptModel: 'gpt-4',
    translationFields: [],
    translateWholeRecord: false,
    translateBulkRecords: false,
    prompt: '{fieldValue} from {fromLocale} to {toLocale} {recordContext}',
    modelsToBeExcludedFromThisPlugin: [],
    rolesToBeExcludedFromThisPlugin: [],
    apiKeysToBeExcludedFromThisPlugin: [],
    enableDebugging: false,
  };

  let mockProvider: TranslationProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProvider = {
      vendor: 'openai',
      streamText: vi.fn(),
      completeText: vi.fn(),
    };
  });

  describe('translateSeoFieldValue', () => {
    describe('empty value handling', () => {
      it('should return empty object for null value', async () => {
        const result = await translateSeoFieldValue(
          null,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(result).toEqual({ title: '', description: '' });
        expect(translateArray).not.toHaveBeenCalled();
      });

      it('should return empty object for undefined value', async () => {
        const result = await translateSeoFieldValue(
          undefined,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(result).toEqual({ title: '', description: '' });
        expect(translateArray).not.toHaveBeenCalled();
      });
    });

    describe('successful translation', () => {
      it('should translate title and description', async () => {
        vi.mocked(translateArray).mockResolvedValue([
          'Deutscher Titel',
          'Deutsche Beschreibung',
        ]);

        const seoObject: SeoObject = {
          title: 'English Title',
          description: 'English Description',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(result.title).toBe('Deutscher Titel');
        expect(result.description).toBe('Deutsche Beschreibung');
      });

      it('should call translateArray with title and description as array', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Title DE', 'Desc DE']);

        const seoObject: SeoObject = {
          title: 'Title EN',
          description: 'Desc EN',
        };

        await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['Title EN', 'Desc EN'],
          'en',
          'de',
          { isHTML: false, recordContext: '' }
        );
      });

      it('should handle missing title', async () => {
        vi.mocked(translateArray).mockResolvedValue(['', 'Description DE']);

        const seoObject: SeoObject = {
          description: 'Description EN',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['', 'Description EN'],
          'en',
          'de',
          expect.any(Object)
        );
        expect(result.description).toBe('Description DE');
      });

      it('should handle missing description', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Title DE', '']);

        const seoObject: SeoObject = {
          title: 'Title EN',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(result.title).toBe('Title DE');
      });

      it('should pass record context', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Title', 'Desc']);

        const seoObject: SeoObject = {
          title: 'Title',
          description: 'Desc',
        };

        await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          '',
          undefined,
          'Product page SEO'
        );

        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['Title', 'Desc'],
          'en',
          'de',
          { isHTML: false, recordContext: 'Product page SEO' }
        );
      });
    });

    describe('character limit enforcement', () => {
      it('should truncate title exceeding 60 characters', async () => {
        const longTitle = 'A'.repeat(70);
        vi.mocked(translateArray).mockResolvedValue([longTitle, 'Description']);

        const seoObject: SeoObject = {
          title: 'Original Title',
          description: 'Description',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        // 60 - 3 (ellipsis offset) = 57 chars + "..."
        expect(result.title?.length).toBeLessThanOrEqual(60);
        expect(result.title?.endsWith('...')).toBe(true);
      });

      it('should not truncate title under 60 characters', async () => {
        const shortTitle = 'Short Title';
        vi.mocked(translateArray).mockResolvedValue([shortTitle, 'Description']);

        const seoObject: SeoObject = {
          title: 'Original',
          description: 'Desc',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(result.title).toBe(shortTitle);
        expect(result.title?.endsWith('...')).toBe(false);
      });

      it('should truncate description exceeding 160 characters', async () => {
        const longDesc = 'B'.repeat(180);
        vi.mocked(translateArray).mockResolvedValue(['Title', longDesc]);

        const seoObject: SeoObject = {
          title: 'Title',
          description: 'Description',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        // 160 - 3 (ellipsis offset) = 157 chars + "..."
        expect(result.description?.length).toBeLessThanOrEqual(160);
        expect(result.description?.endsWith('...')).toBe(true);
      });

      it('should not truncate description under 160 characters', async () => {
        const shortDesc = 'Short description under limit';
        vi.mocked(translateArray).mockResolvedValue(['Title', shortDesc]);

        const seoObject: SeoObject = {
          title: 'Title',
          description: 'Desc',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(result.description).toBe(shortDesc);
      });

      it('should handle exactly 60 character title', async () => {
        const exactTitle = 'A'.repeat(60);
        vi.mocked(translateArray).mockResolvedValue([exactTitle, 'Description']);

        const seoObject: SeoObject = {
          title: 'Original',
          description: 'Desc',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(result.title).toBe(exactTitle);
        expect(result.title?.length).toBe(60);
      });

      it('should handle exactly 160 character description', async () => {
        const exactDesc = 'B'.repeat(160);
        vi.mocked(translateArray).mockResolvedValue(['Title', exactDesc]);

        const seoObject: SeoObject = {
          title: 'Title',
          description: 'Desc',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(result.description).toBe(exactDesc);
        expect(result.description?.length).toBe(160);
      });
    });

    describe('fallback behavior', () => {
      it('should use original title if translated title is empty', async () => {
        vi.mocked(translateArray).mockResolvedValue(['', 'Description DE']);

        const seoObject: SeoObject = {
          title: 'Original Title',
          description: 'Original Description',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        // The function should keep the original title
        expect(result.title).toBe('Original Title');
      });

      it('should use original description if translated description is empty', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Title DE', '']);

        const seoObject: SeoObject = {
          title: 'Original Title',
          description: 'Original Description',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(result.description).toBe('Original Description');
      });
    });

    describe('error handling', () => {
      it('should throw error when translation fails', async () => {
        vi.mocked(translateArray).mockRejectedValue(new Error('API Error'));

        const seoObject: SeoObject = {
          title: 'Title',
          description: 'Description',
        };

        await expect(
          translateSeoFieldValue(
            seoObject,
            mockPluginParams,
            'de',
            'en',
            mockProvider,
            ''
          )
        ).rejects.toThrow();
      });
    });

    describe('preservation of other properties', () => {
      it('should preserve additional properties in SEO object', async () => {
        vi.mocked(translateArray).mockResolvedValue([
          'Title DE',
          'Description DE',
        ]);

        const seoObject: SeoObject = {
          title: 'Title EN',
          description: 'Description EN',
          image: { id: 'image-123' },
          twitterCard: 'summary_large_image',
        };

        const result = await translateSeoFieldValue(
          seoObject,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          ''
        );

        expect(result.title).toBe('Title DE');
        expect(result.description).toBe('Description DE');
        expect(result.image).toEqual({ id: 'image-123' });
        expect(result.twitterCard).toBe('summary_large_image');
      });
    });
  });
});
