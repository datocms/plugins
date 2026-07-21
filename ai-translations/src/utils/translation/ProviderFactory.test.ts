/**
 * Tests for ProviderFactory.ts
 * Tests provider configuration validation only.
 * Provider instantiation requires complex mocking that's brittle.
 */

import { describe, expect, it } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { getProvider, isProviderConfigured } from './ProviderFactory';

describe('ProviderFactory', () => {
  const baseParams: ctxParamsType = {
    apiKey: 'openai-key',
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

  describe('isProviderConfigured', () => {
    describe('OpenAI validation', () => {
      it('should return true for valid OpenAI config', () => {
        const result = isProviderConfigured(baseParams);
        expect(result).toBe(true);
      });

      it('should return false when apiKey is missing', () => {
        const params = { ...baseParams, apiKey: '' };
        expect(isProviderConfigured(params)).toBe(false);
      });

      it('should return false when gptModel is missing', () => {
        const params = { ...baseParams, gptModel: '' };
        expect(isProviderConfigured(params)).toBe(false);
      });

      it('should return false when gptModel is None', () => {
        const params = { ...baseParams, gptModel: 'None' };
        expect(isProviderConfigured(params)).toBe(false);
      });
    });

    describe('Google/Gemini validation', () => {
      it('should return true for valid Google config', () => {
        const params = {
          ...baseParams,
          vendor: 'google' as const,
          googleApiKey: 'key',
          geminiModel: 'gemini-1.5-flash',
        };
        expect(isProviderConfigured(params)).toBe(true);
      });

      it('should return false when googleApiKey is missing', () => {
        const params = {
          ...baseParams,
          vendor: 'google' as const,
          googleApiKey: '',
          geminiModel: 'gemini-1.5-flash',
        };
        expect(isProviderConfigured(params)).toBe(false);
      });

      it('should return false when geminiModel is missing', () => {
        const params = {
          ...baseParams,
          vendor: 'google' as const,
          googleApiKey: 'key',
          geminiModel: '',
        };
        expect(isProviderConfigured(params)).toBe(false);
      });
    });

    describe('Anthropic validation', () => {
      it('should return true for valid Anthropic config', () => {
        const params = {
          ...baseParams,
          vendor: 'anthropic' as const,
          anthropicApiKey: 'key',
          anthropicModel: 'claude-3-sonnet-20240229',
        };
        expect(isProviderConfigured(params)).toBe(true);
      });

      it('should return false when anthropicApiKey is missing', () => {
        const params = {
          ...baseParams,
          vendor: 'anthropic' as const,
          anthropicApiKey: '',
          anthropicModel: 'claude-3-sonnet-20240229',
        };
        expect(isProviderConfigured(params)).toBe(false);
      });

      it('should return false when anthropicModel is missing', () => {
        const params = {
          ...baseParams,
          vendor: 'anthropic' as const,
          anthropicApiKey: 'key',
          anthropicModel: '',
        };
        expect(isProviderConfigured(params)).toBe(false);
      });
    });

    describe('DeepL validation', () => {
      it('should return true for valid DeepL config', () => {
        const params = {
          ...baseParams,
          vendor: 'deepl' as const,
          deeplApiKey: 'key',
        };
        expect(isProviderConfigured(params)).toBe(true);
      });

      it('should return false when deeplApiKey is missing', () => {
        const params = {
          ...baseParams,
          vendor: 'deepl' as const,
          deeplApiKey: '',
        };
        expect(isProviderConfigured(params)).toBe(false);
      });
    });

    describe('Yandex validation', () => {
      it('should return true when the API key is configured without a Folder ID', () => {
        const params = {
          ...baseParams,
          vendor: 'yandex' as const,
          yandexApiKey: 'yandex-key',
        };
        expect(isProviderConfigured(params)).toBe(true);
      });

      it('should return true when both the API key and Folder ID are configured', () => {
        const params = {
          ...baseParams,
          vendor: 'yandex' as const,
          yandexApiKey: 'yandex-key',
          yandexFolderId: 'folder-id',
        };
        expect(isProviderConfigured(params)).toBe(true);
      });

      it('should return false when the API key is blank', () => {
        const params = {
          ...baseParams,
          vendor: 'yandex' as const,
          yandexApiKey: '   ',
          yandexFolderId: 'folder-id',
        };
        expect(isProviderConfigured(params)).toBe(false);
      });
    });

    describe('default vendor', () => {
      it('should treat undefined vendor as openai', () => {
        const params = { ...baseParams, vendor: undefined };
        expect(isProviderConfigured(params)).toBe(true);
      });
    });
  });

  describe('Yandex provider caching', () => {
    it('reuses a provider for the same API key and Folder ID', () => {
      const params = {
        ...baseParams,
        vendor: 'yandex' as const,
        yandexApiKey: 'yandex-cache-key-0001',
        yandexFolderId: 'folder-a',
      };

      expect(getProvider(params)).toBe(getProvider({ ...params }));
    });

    it('does not reuse a provider when the Folder ID changes', () => {
      const params = {
        ...baseParams,
        vendor: 'yandex' as const,
        yandexApiKey: 'yandex-cache-key-0002',
      };

      const first = getProvider({ ...params, yandexFolderId: 'folder-a' });
      const second = getProvider({ ...params, yandexFolderId: 'folder-b' });

      expect(first).not.toBe(second);
    });

    it('trims optional Folder IDs before constructing the cache identity', () => {
      const params = {
        ...baseParams,
        vendor: 'yandex' as const,
        yandexApiKey: 'yandex-cache-key-0003',
      };

      const first = getProvider({ ...params, yandexFolderId: ' folder-a ' });
      const second = getProvider({ ...params, yandexFolderId: 'folder-a' });

      expect(first).toBe(second);
    });
  });
});
