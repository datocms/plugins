import { describe, expect, it, vi } from 'vitest';
import {
  isCompatibleOpenAiAgentModel,
  listAnthropicProviderModels,
  listOpenAiProviderModels,
  listProviderModels,
  preferredProviderModel,
  providerModelSupportsFastMode,
} from './providerModels';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function anthropicModel({
  adaptive = true,
  displayName,
  efforts = ['low', 'medium', 'high'],
  id,
  maxTokens = 64_000,
}: {
  adaptive?: boolean;
  displayName?: string;
  efforts?: string[];
  id: string;
  maxTokens?: unknown;
}) {
  return {
    id,
    display_name: displayName,
    max_tokens: maxTokens,
    capabilities: {
      effort: {
        supported: efforts.length > 0,
        low: { supported: efforts.includes('low') },
        medium: { supported: efforts.includes('medium') },
        high: { supported: efforts.includes('high') },
        xhigh: { supported: efforts.includes('xhigh') },
        max: { supported: efforts.includes('max') },
      },
      thinking: {
        supported: true,
        types: {
          adaptive: { supported: adaptive },
          enabled: { supported: true },
        },
      },
    },
  };
}

describe('provider model discovery', () => {
  it('limits fast mode to provider models that currently support it', () => {
    expect(providerModelSupportsFastMode('openai', 'gpt-5.6-terra')).toBe(true);
    expect(providerModelSupportsFastMode('openai', 'gpt-4.1')).toBe(false);
    expect(providerModelSupportsFastMode('openai', 'gpt-5-mini')).toBe(false);
    expect(providerModelSupportsFastMode('anthropic', 'claude-opus-5')).toBe(
      true,
    );
    expect(
      providerModelSupportsFastMode('anthropic', 'claude-opus-4-8-20260801'),
    ).toBe(true);
    expect(providerModelSupportsFastMode('anthropic', 'claude-sonnet-5')).toBe(
      false,
    );
    expect(providerModelSupportsFastMode('anthropic', 'claude-opus-4-7')).toBe(
      false,
    );
  });

  it('keeps the compatible OpenAI ordering and capability set', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'gpt-5.6' },
          { id: 'gpt-5.6-sol' },
          { id: 'gpt-5.6-terra' },
          { id: 'gpt-5.6-terra' },
          { id: 'gpt-4.1' },
        ],
      }),
    );

    await expect(
      listOpenAiProviderModels(' sk-project ', undefined, fetchModels),
    ).resolves.toEqual([
      {
        id: 'gpt-5.6-terra',
        label: 'gpt-5.6-terra',
        reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'gpt-5.6-sol',
        label: 'gpt-5.6-sol',
        reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'gpt-5.6',
        label: 'gpt-5.6',
        reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
    ]);
  });

  it('prefers the newest dated OpenAI snapshot within each model family', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'gpt-5.6-sol-2026-05-01' },
          { id: 'gpt-5.6-terra-2026-04-01' },
          { id: 'gpt-5.6-terra-2026-07-15' },
          { id: 'gpt-5.6-sol-2026-08-01' },
        ],
      }),
    );

    await expect(
      listOpenAiProviderModels('sk-project', undefined, fetchModels),
    ).resolves.toMatchObject([
      { id: 'gpt-5.6-terra-2026-07-15' },
      { id: 'gpt-5.6-terra-2026-04-01' },
      { id: 'gpt-5.6-sol-2026-08-01' },
      { id: 'gpt-5.6-sol-2026-05-01' },
    ]);
  });

  it.each([
    'gpt-5',
    'gpt-5-mini',
    'gpt-5.1',
    'gpt-5.2-pro',
    'gpt-5.4-nano',
    'gpt-5.5',
    'gpt-5.6-sol-2026-07-01',
    'gpt-6-astra',
    'gpt-6-sol',
    'gpt-6-luna',
    'gpt-6.1-sol',
    'gpt-7-future-variant',
    'gpt-10-2028-01-01',
  ])('includes available general-purpose model %s', async (id) => {
    const fetchModels = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ data: [{ id }, { id }, { id: '' }, null] }),
      );

    await expect(
      listOpenAiProviderModels('sk-project', undefined, fetchModels),
    ).resolves.toMatchObject([{ id, label: id }]);
  });

  it.each([
    'gpt-4.1',
    'gpt-4o',
    'gpt-oss-120b',
    'gpt-image-2',
    'gpt-realtime-2',
    'gpt-5-chat-latest',
    'gpt-5.2-codex',
    'gpt-6-audio-preview',
    'gpt-6-search-preview',
    'gpt-6-transcribe',
    'o3-deep-research',
    'text-embedding-3-large',
    'omni-moderation-latest',
  ])('omits model %s that does not fit the agent runtime', (id) => {
    expect(isCompatibleOpenAiAgentModel(id)).toBe(false);
  });

  it.each([
    ['gpt-5-mini', ['low', 'medium', 'high']],
    ['gpt-5-2025-08-07', ['low', 'medium', 'high']],
    ['gpt-5.1', ['none', 'low', 'medium', 'high']],
    ['gpt-5.2', ['none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-5.4-mini', ['none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-5.5', ['none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-5-pro-2025-10-06', ['high']],
    ['gpt-5.2-pro', ['medium', 'high', 'xhigh']],
    ['gpt-6-astra', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6-astra-2026-09-01', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6-sol', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
  ])('uses known reasoning limits for %s', async (id, reasoningEfforts) => {
    const fetchModels = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: [{ id }] }));

    await expect(
      listOpenAiProviderModels('sk-project', undefined, fetchModels),
    ).resolves.toEqual([{ id, label: id, reasoningEfforts }]);
  });

  it('prefers the existing OpenAI default only when the API returns it', () => {
    const model = (id: string) => ({ id, label: id, reasoningEfforts: [] });
    const models = [model('gpt-6-astra'), model('gpt-5.6-terra')];
    expect(preferredProviderModel('openai', models)?.id).toBe('gpt-5.6-terra');
    expect(preferredProviderModel('openai', models.slice(0, 1))?.id).toBe(
      'gpt-6-astra',
    );
  });

  it('paginates Anthropic models and uses returned capabilities and labels', async () => {
    const fetchModels = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            anthropicModel({
              id: 'claude-opus-4-8',
              displayName: 'Claude Opus 4.8',
              efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
              maxTokens: 128_000,
            }),
            anthropicModel({
              id: 'claude-sonnet-5',
              displayName: 'Claude Sonnet 5',
              efforts: ['low', 'medium', 'high', 'xhigh'],
            }),
            anthropicModel({
              id: 'claude-sonnet-4-5',
              adaptive: false,
            }),
            anthropicModel({ id: 'other-model' }),
          ],
          has_more: true,
          last_id: 'claude-sonnet-5',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            anthropicModel({
              id: 'claude-sonnet-5',
              displayName: 'Duplicate',
            }),
            anthropicModel({
              id: 'claude-opus-4-6',
              displayName: 'Claude Opus 4.6',
              efforts: ['low', 'medium', 'high', 'max'],
              maxTokens: 32_000,
            }),
          ],
          has_more: false,
          last_id: 'claude-opus-4-6',
        }),
      );

    const models = await listAnthropicProviderModels(
      ' sk-ant-project ',
      undefined,
      fetchModels,
    );

    expect(models).toEqual([
      {
        id: 'claude-opus-4-8',
        label: 'Claude Opus 4.8',
        maxOutputTokens: 128_000,
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'claude-sonnet-5',
        label: 'Claude Sonnet 5',
        maxOutputTokens: 64_000,
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      },
      {
        id: 'claude-opus-4-6',
        label: 'Claude Opus 4.6',
        maxOutputTokens: 32_000,
        reasoningEfforts: ['low', 'medium', 'high', 'max'],
      },
    ]);
    expect(preferredProviderModel('anthropic', models)?.id).toBe(
      'claude-sonnet-5',
    );

    const [firstUrl, firstInit] = fetchModels.mock.calls[0] ?? [];
    expect(String(firstUrl)).toBe(
      'https://api.anthropic.com/v1/models?limit=1000',
    );
    expect(new Headers(firstInit?.headers).get('x-api-key')).toBe(
      'sk-ant-project',
    );
    expect(new Headers(firstInit?.headers).get('anthropic-version')).toBe(
      '2023-06-01',
    );
    expect(
      new Headers(firstInit?.headers).get(
        'anthropic-dangerous-direct-browser-access',
      ),
    ).toBe('true');
    expect(String(fetchModels.mock.calls[1]?.[0])).toBe(
      'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-sonnet-5',
    );
  });

  it('gracefully omits an unreadable Anthropic output-token capability', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          anthropicModel({
            id: 'claude-sonnet-5',
            maxTokens: 'not-a-number',
          }),
        ],
        has_more: false,
      }),
    );

    await expect(
      listAnthropicProviderModels('sk-ant-project', undefined, fetchModels),
    ).resolves.toEqual([
      {
        id: 'claude-sonnet-5',
        label: 'claude-sonnet-5',
        reasoningEfforts: ['low', 'medium', 'high'],
      },
    ]);
  });

  it('rejects malformed Anthropic pagination instead of looping', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse({
        data: [],
        has_more: true,
        last_id: 'same-cursor',
      }),
    );

    await expect(
      listAnthropicProviderModels('sk-ant-project', undefined, fetchModels),
    ).rejects.toThrow('invalid model-list pagination');
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it('redacts provider keys from model API errors', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: 'Invalid x-api-key sk-ant-very-secret-project-key',
          },
        },
        401,
      ),
    );

    const result = listAnthropicProviderModels(
      'sk-ant-very-secret-project-key',
      undefined,
      fetchModels,
    );
    await expect(result).rejects.toThrow('Invalid x-api-key [redacted]');
    await expect(result).rejects.not.toThrow('sk-ant-very-secret-project-key');
  });

  it('explains Anthropic browser-access failures without exposing credentials', async () => {
    const fetchModels = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch'));

    const result = listAnthropicProviderModels(
      'sk-ant-very-secret-project-key',
      undefined,
      fetchModels,
    );

    await expect(result).rejects.toThrow(
      'Anthropic could not be reached from this browser',
    );
    await expect(result).rejects.toThrow('Zero Data Retention');
    await expect(result).rejects.not.toThrow('sk-ant-very-secret-project-key');
  });

  it('routes discovery through the selected provider only', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          anthropicModel({
            id: 'claude-sonnet-5',
            displayName: 'Claude Sonnet 5',
          }),
        ],
        has_more: false,
      }),
    );

    await expect(
      listProviderModels('anthropic', 'sk-ant-project', undefined, fetchModels),
    ).resolves.toMatchObject([{ id: 'claude-sonnet-5' }]);
    expect(String(fetchModels.mock.calls[0]?.[0])).toContain(
      'api.anthropic.com',
    );
  });
});
