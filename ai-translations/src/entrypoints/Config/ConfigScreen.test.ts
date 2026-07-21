import { describe, expect, it } from 'vitest';
import {
  isNativeTranslationVendor,
  isVendorCredentialsMissing,
} from './ConfigScreen';

const configuredCredentials = {
  vendor: 'openai' as const,
  apiKey: 'openai-key',
  gptModel: 'gpt-model',
  googleApiKey: 'google-key',
  geminiModel: 'gemini-model',
  anthropicApiKey: 'anthropic-key',
  anthropicModel: 'anthropic-model',
  deeplApiKey: 'deepl-key',
  yandexApiKey: 'yandex-key',
};

describe('isVendorCredentialsMissing', () => {
  it('requires a non-blank API key for Yandex Translate', () => {
    expect(
      isVendorCredentialsMissing({
        ...configuredCredentials,
        vendor: 'yandex',
        yandexApiKey: '   ',
      }),
    ).toBe(true);
  });

  it('accepts Yandex Translate without a Folder ID', () => {
    expect(
      isVendorCredentialsMissing({
        ...configuredCredentials,
        vendor: 'yandex',
      }),
    ).toBe(false);
  });
});

describe('isNativeTranslationVendor', () => {
  it('hides prompt configuration only for native translation providers', () => {
    expect(isNativeTranslationVendor('deepl')).toBe(true);
    expect(isNativeTranslationVendor('yandex')).toBe(true);
    expect(isNativeTranslationVendor('openai')).toBe(false);
    expect(isNativeTranslationVendor('google')).toBe(false);
    expect(isNativeTranslationVendor('anthropic')).toBe(false);
  });
});
