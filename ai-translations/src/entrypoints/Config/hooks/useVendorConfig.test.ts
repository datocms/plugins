import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ctxParamsType } from '../ConfigScreen';
import {
  getVendorConfigParams,
  useVendorConfig,
  type VendorConfigState,
} from './useVendorConfig';

function createPluginParams(
  overrides: Partial<ctxParamsType> = {},
): ctxParamsType {
  return {
    apiKey: '',
    gptModel: 'None',
    translationFields: [],
    translateWholeRecord: true,
    translateBulkRecords: true,
    prompt: '',
    modelsToBeExcludedFromThisPlugin: [],
    rolesToBeExcludedFromThisPlugin: [],
    apiKeysToBeExcludedFromThisPlugin: [],
    enableDebugging: false,
    ...overrides,
  };
}

function createVendorState(
  overrides: Partial<VendorConfigState> = {},
): VendorConfigState {
  return {
    vendor: 'openai',
    apiKey: '',
    gptModel: 'None',
    googleApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    anthropicApiKey: '',
    anthropicModel: 'claude-haiku-4-5-latest',
    deeplApiKey: '',
    deeplUseFree: false,
    deeplFormality: 'default',
    deeplPreserveFormatting: true,
    deeplIgnoreTags: 'notranslate,ph',
    deeplNonSplittingTags: 'a,code,pre,strong,em,ph,notranslate',
    deeplSplittingTags: '',
    deeplGlossaryId: '',
    deeplGlossaryPairs: '',
    yandexApiKey: '',
    yandexFolderId: '',
    ...overrides,
  };
}

describe('useVendorConfig Yandex settings', () => {
  it('loads Yandex credentials and normalizes a saved Folder ID', () => {
    const { result } = renderHook(() =>
      useVendorConfig(
        createPluginParams({
          vendor: 'yandex',
          yandexApiKey: 'api-key',
          yandexFolderId: '  folder-id  ',
        }),
      ),
    );

    expect(result.current[0].vendor).toBe('yandex');
    expect(result.current[0].yandexApiKey).toBe('api-key');
    expect(result.current[0].yandexFolderId).toBe('folder-id');
  });

  it('trims the optional Folder ID when serializing vendor settings', () => {
    const params = getVendorConfigParams(
      createVendorState({
        vendor: 'yandex',
        yandexApiKey: 'api-key',
        yandexFolderId: '  folder-id  ',
      }),
    );

    expect(params).toMatchObject({
      vendor: 'yandex',
      yandexApiKey: 'api-key',
      yandexFolderId: 'folder-id',
    });
  });
});
