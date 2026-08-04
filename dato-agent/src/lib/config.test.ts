import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_REASONING_EFFORTS,
  activeApiKey,
  activeModel,
  activeModelMaxOutputTokens,
  activeReasoningEffort,
  DEFAULT_CONFIG,
  normalizeConfig,
  providerLabel,
  REASONING_EFFORTS,
  serializeConfig,
  withActiveApiKey,
  withActiveModel,
  withActiveReasoningEffort,
} from './config';

describe('normalizeConfig', () => {
  it('returns safe OpenAI defaults for missing parameters', () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });

  it('keeps legacy OpenAI configuration active and unchanged', () => {
    expect(
      normalizeConfig({
        openAiApiKey: '  sk-project  ',
        model: '  custom-model ',
        reasoningEffort: 'max',
        additionalInstructions: 2,
        enableRecordSidebar: false,
        defaultSidebarWidth: 2_000,
      }),
    ).toEqual({
      ...DEFAULT_CONFIG,
      provider: 'openai',
      openAiApiKey: 'sk-project',
      model: 'custom-model',
      reasoningEffort: 'max',
      enableRecordSidebar: false,
    });
  });

  it('normalizes Anthropic configuration and provider aliases', () => {
    expect(
      normalizeConfig({
        provider: ' Claude ',
        anthropicApiKey: '  sk-ant-project  ',
        anthropicModel: '  claude-sonnet-5 ',
        anthropicModelMaxOutputTokens: 128_000,
        anthropicReasoningEffort: 'xhigh',
      }),
    ).toMatchObject({
      provider: 'anthropic',
      anthropicApiKey: 'sk-ant-project',
      anthropicModel: 'claude-sonnet-5',
      anthropicModelMaxOutputTokens: 128_000,
      anthropicReasoningEffort: 'xhigh',
    });

    expect(normalizeConfig({ provider: 'ChatGPT' }).provider).toBe('openai');
    expect(normalizeConfig({ provider: 'unknown' }).provider).toBe('openai');
  });

  it('falls back when either provider effort is unsupported', () => {
    expect(
      normalizeConfig({
        reasoningEffort: 'extreme',
        anthropicModelMaxOutputTokens: -1,
        anthropicReasoningEffort: 'none',
      }),
    ).toMatchObject({
      reasoningEffort: DEFAULT_CONFIG.reasoningEffort,
      anthropicModelMaxOutputTokens: null,
      anthropicReasoningEffort: DEFAULT_CONFIG.anthropicReasoningEffort,
    });
  });

  it('uses the documented provider effort sets', () => {
    expect(REASONING_EFFORTS).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(ANTHROPIC_REASONING_EFFORTS).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('reads and updates only the active provider values', () => {
    const anthropic = normalizeConfig({
      provider: 'anthropic',
      openAiApiKey: 'sk-openai',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'medium',
      anthropicApiKey: 'sk-ant-old',
      anthropicModel: 'claude-opus-4-6',
      anthropicModelMaxOutputTokens: 64_000,
      anthropicReasoningEffort: 'max',
    });

    expect(providerLabel(anthropic.provider)).toBe('Anthropic (Claude)');
    expect(activeApiKey(anthropic)).toBe('sk-ant-old');
    expect(activeModel(anthropic)).toBe('claude-opus-4-6');
    expect(activeModelMaxOutputTokens(anthropic)).toBe(64_000);
    expect(activeReasoningEffort(anthropic)).toBe('max');

    const updated = withActiveReasoningEffort(
      withActiveModel(
        withActiveApiKey(anthropic, 'sk-ant-new'),
        'claude-new',
        128_000,
      ),
      'low',
    );
    expect(updated).toMatchObject({
      openAiApiKey: 'sk-openai',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'medium',
      anthropicApiKey: 'sk-ant-new',
      anthropicModel: 'claude-new',
      anthropicModelMaxOutputTokens: 128_000,
      anthropicReasoningEffort: 'low',
    });
    expect(withActiveReasoningEffort(updated, 'none')).toBe(updated);
  });

  it('preserves unrelated and inactive-provider parameters on save', () => {
    const serialized = serializeConfig(
      { unrelated: 'keep me', defaultSidebarWidth: 720 },
      {
        ...DEFAULT_CONFIG,
        provider: 'anthropic',
        openAiApiKey: 'sk-openai',
        model: 'gpt-5.6-sol',
        anthropicApiKey: 'sk-ant-project',
        anthropicModel: 'claude-sonnet-5',
        anthropicModelMaxOutputTokens: 128_000,
      },
    );

    expect(serialized).toMatchObject({
      unrelated: 'keep me',
      provider: 'anthropic',
      openAiApiKey: 'sk-openai',
      model: 'gpt-5.6-sol',
      anthropicApiKey: 'sk-ant-project',
      anthropicModel: 'claude-sonnet-5',
      anthropicModelMaxOutputTokens: 128_000,
    });
    expect(serialized).not.toHaveProperty('defaultSidebarWidth');
  });
});
