import { describe, expect, it } from 'vitest';
import {
  activeProviderValidationError,
  DEFAULT_ALT_TEXT_PROMPT,
  normalizePluginConfiguration,
  type PluginConfiguration,
  PROVIDER_LABELS,
  PROVIDER_OPTIONS,
  serializePluginConfiguration,
} from './config';

describe('plugin configuration', () => {
  it('exposes a label and option for every supported provider', () => {
    expect(PROVIDER_OPTIONS).toEqual([
      { value: 'alttext-ai', label: 'AltText.ai' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'gemini', label: 'Google Gemini' },
    ]);
    expect(PROVIDER_LABELS).toEqual(
      Object.fromEntries(
        PROVIDER_OPTIONS.map(({ value, label }) => [value, label]),
      ),
    );
  });

  it('migrates the legacy apiKey parameter to the AltText.ai provider', () => {
    const result = normalizePluginConfiguration({
      apiKey: '  legacy-key  ',
    });

    expect(result).toMatchObject({
      provider: 'alttext-ai',
      altTextAiApiKey: 'legacy-key',
      openAiApiKey: '',
      anthropicApiKey: '',
      geminiApiKey: '',
    });
  });

  it('prefers the current AltText.ai key over the legacy key', () => {
    const result = normalizePluginConfiguration({
      apiKey: 'legacy-key',
      altTextAiApiKey: 'current-key',
    });

    expect(result.altTextAiApiKey).toBe('current-key');
  });

  it('selects OpenAI when no provider settings exist', () => {
    expect(normalizePluginConfiguration({}).provider).toBe('openai');
  });

  it('keeps AltText.ai selected when its current key exists without a provider', () => {
    expect(
      normalizePluginConfiguration({ altTextAiApiKey: 'current-key' }).provider,
    ).toBe('alttext-ai');
  });

  it.each([
    ['google', 'gemini'],
    [' Google ', 'gemini'],
    ['claude', 'anthropic'],
    ['CLAUDE', 'anthropic'],
  ] as const)('normalizes the %s provider alias to %s', (input, expected) => {
    expect(normalizePluginConfiguration({ provider: input }).provider).toBe(
      expected,
    );
  });

  it('uses safe defaults for malformed and blank parameters', () => {
    const result = normalizePluginConfiguration({
      provider: 'unsupported',
      altTextAiApiKey: 123,
      openAiApiKey: false,
      openAiModel: '   ',
      anthropicApiKey: {},
      anthropicModel: null,
      geminiApiKey: [],
      geminiModel: undefined,
      prompt: '   ',
    });

    expect(result).toEqual({
      provider: 'openai',
      altTextAiApiKey: '',
      openAiApiKey: '',
      openAiModel: '',
      anthropicApiKey: '',
      anthropicModel: '',
      geminiApiKey: '',
      geminiModel: '',
      prompt: DEFAULT_ALT_TEXT_PROMPT,
    });
    expect(DEFAULT_ALT_TEXT_PROMPT).toContain('{locale}');
    expect(DEFAULT_ALT_TEXT_PROMPT).toContain('{filename}');
  });

  it('normalizes non-object parameters', () => {
    expect(normalizePluginConfiguration(null)).toEqual(
      normalizePluginConfiguration({}),
    );
    expect(normalizePluginConfiguration('invalid')).toEqual(
      normalizePluginConfiguration({}),
    );
  });

  it('preserves a non-empty custom prompt verbatim', () => {
    const prompt = '  Describe {filename} in {locale}.\nKeep this line.  ';

    expect(normalizePluginConfiguration({ prompt }).prompt).toBe(prompt);
  });
});

describe('activeProviderValidationError', () => {
  function configuration(
    overrides: Partial<PluginConfiguration> = {},
  ): PluginConfiguration {
    return {
      ...normalizePluginConfiguration({
        altTextAiApiKey: 'alttext-key',
        openAiApiKey: 'openai-key',
        openAiModel: 'openai-model',
        anthropicApiKey: 'anthropic-key',
        anthropicModel: 'anthropic-model',
        geminiApiKey: 'gemini-key',
        geminiModel: 'gemini-model',
      }),
      ...overrides,
    };
  }

  it.each([
    [
      { provider: 'alttext-ai', altTextAiApiKey: '  ' },
      'AltText.ai API key is required.',
    ],
    [{ provider: 'openai', openAiApiKey: '' }, 'OpenAI API key is required.'],
    [{ provider: 'openai', openAiModel: ' ' }, 'OpenAI model is required.'],
    [
      { provider: 'anthropic', anthropicApiKey: '' },
      'Anthropic API key is required.',
    ],
    [
      { provider: 'anthropic', anthropicModel: '' },
      'Anthropic model is required.',
    ],
    [{ provider: 'gemini', geminiApiKey: '' }, 'Gemini API key is required.'],
    [{ provider: 'gemini', geminiModel: '' }, 'Gemini model is required.'],
    [
      { provider: 'openai', prompt: ' ' },
      'Prompt is required for direct AI providers.',
    ],
  ] satisfies Array<
    [Partial<PluginConfiguration>, string]
  >)('validates active-provider values for %#', (overrides, expected) => {
    expect(activeProviderValidationError(configuration(overrides))).toBe(
      expected,
    );
  });

  it.each([
    'alttext-ai',
    'openai',
    'anthropic',
    'gemini',
  ] as const)('accepts a complete %s configuration', (provider) => {
    expect(
      activeProviderValidationError(configuration({ provider })),
    ).toBeNull();
  });

  it('does not require a prompt for AltText.ai', () => {
    expect(
      activeProviderValidationError(
        configuration({ provider: 'alttext-ai', prompt: '' }),
      ),
    ).toBeNull();
  });
});

describe('serializePluginConfiguration', () => {
  it('trims credentials and models and mirrors the AltText.ai legacy key', () => {
    const config: PluginConfiguration = {
      provider: 'openai',
      altTextAiApiKey: '  alttext-key  ',
      openAiApiKey: '  openai-key  ',
      openAiModel: '  gpt-custom  ',
      anthropicApiKey: '  anthropic-key  ',
      anthropicModel: '  claude-custom  ',
      geminiApiKey: '  gemini-key  ',
      geminiModel: '  gemini-custom  ',
      prompt: '  Keep prompt whitespace.  ',
    };

    expect(serializePluginConfiguration(config)).toEqual({
      provider: 'openai',
      apiKey: 'alttext-key',
      altTextAiApiKey: 'alttext-key',
      openAiApiKey: 'openai-key',
      openAiModel: 'gpt-custom',
      anthropicApiKey: 'anthropic-key',
      anthropicModel: 'claude-custom',
      geminiApiKey: 'gemini-key',
      geminiModel: 'gemini-custom',
      prompt: '  Keep prompt whitespace.  ',
    });
  });
});
