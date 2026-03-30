/**
 * Tests for DefaultTranslation.ts
 * Tests translation of simple text fields.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { translateDefaultFieldValue } from './DefaultTranslation';
import type { TranslationProvider } from './types';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';

// Mock translateArray
vi.mock('./translateArray', () => ({
  translateArray: vi.fn(),
}));

import { translateArray } from './translateArray';

describe('DefaultTranslation', () => {
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

    mockProvider = {
      vendor: 'openai',
      streamText: vi.fn(),
      completeText: vi.fn(),
    };
  });

  describe('translateDefaultFieldValue', () => {
    describe('empty value handling', () => {
      it('should return null for null value', async () => {
        const result = await translateDefaultFieldValue(
          null,
          mockPluginParams,
          'de',
          'en',
          mockProvider
        );

        expect(result).toBe(null);
        expect(translateArray).not.toHaveBeenCalled();
      });

      it('should return undefined for undefined value', async () => {
        const result = await translateDefaultFieldValue(
          undefined,
          mockPluginParams,
          'de',
          'en',
          mockProvider
        );

        expect(result).toBe(undefined);
        expect(translateArray).not.toHaveBeenCalled();
      });

      it('should return empty string for empty string value', async () => {
        const result = await translateDefaultFieldValue(
          '',
          mockPluginParams,
          'de',
          'en',
          mockProvider
        );

        expect(result).toBe('');
        expect(translateArray).not.toHaveBeenCalled();
      });
    });

    describe('successful translation', () => {
      it('should translate string value', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Hallo Welt']);

        const result = await translateDefaultFieldValue(
          'Hello World',
          mockPluginParams,
          'de',
          'en',
          mockProvider
        );

        expect(result).toBe('Hallo Welt');
        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['Hello World'],
          'en',
          'de',
          { isHTML: false, recordContext: '' }
        );
      });

      it('should pass record context to translateArray', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Translated']);

        await translateDefaultFieldValue(
          'Original',
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          undefined,
          'This is a product description'
        );

        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['Original'],
          'en',
          'de',
          { isHTML: false, recordContext: 'This is a product description' }
        );
      });

      it('should convert non-string values to string', async () => {
        vi.mocked(translateArray).mockResolvedValue(['123']);

        const result = await translateDefaultFieldValue(
          123,
          mockPluginParams,
          'de',
          'en',
          mockProvider
        );

        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['123'],
          'en',
          'de',
          expect.any(Object)
        );
        expect(result).toBe('123');
      });
    });

    describe('error handling', () => {
      it('should throw error when translation fails', async () => {
        vi.mocked(translateArray).mockRejectedValue(new Error('API Error'));

        await expect(
          translateDefaultFieldValue(
            'Hello',
            mockPluginParams,
            'de',
            'en',
            mockProvider
          )
        ).rejects.toThrow();
      });
    });

    describe('locale handling', () => {
      it('should pass correct fromLocale and toLocale', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Bonjour']);

        await translateDefaultFieldValue(
          'Hello',
          mockPluginParams,
          'fr',
          'en',
          mockProvider
        );

        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['Hello'],
          'en',
          'fr',
          expect.any(Object)
        );
      });

      it('should handle hyphenated locales', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Olá']);

        await translateDefaultFieldValue(
          'Hello',
          mockPluginParams,
          'pt-BR',
          'en-US',
          mockProvider
        );

        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['Hello'],
          'en-US',
          'pt-BR',
          expect.any(Object)
        );
      });
    });

    describe('stream callbacks', () => {
      it('should accept stream callbacks parameter', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Translated']);

        const callbacks = {
          onStream: vi.fn(),
          onComplete: vi.fn(),
        };

        await translateDefaultFieldValue(
          'Hello',
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          callbacks
        );

        // The function accepts callbacks but translateArray doesn't use them directly
        expect(translateArray).toHaveBeenCalled();
      });
    });
  });
});
